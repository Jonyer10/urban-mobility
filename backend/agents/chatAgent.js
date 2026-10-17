// Agente de chat contextual con herramientas (function calling de Gemini).
// Gemini decide qué herramienta invocar; aquí se ejecutan y se devuelve el resultado al modelo.
const { generateContent } = require('../services/gemini');
const { searchLocalServices } = require('../services/localData');
const { getGeolocationData } = require('../services/geolocation');
const { getBestRoute } = require('../services/routing');
const { getCaseById, updateCase } = require('../services/db');
const { createTrace } = require('../services/trace');

const MAX_STEPS = 4;
const URGENCY_LEVELS = ['Bajo', 'Medio', 'Alto'];
const NAME = 'Agente 4 (Chat Contextual)';
const ACTION_TOOLS = ['actualizar_caso'];

const chatAgentInfo = {
  name: NAME,
  responsibility: 'Responder preguntas de seguimiento sobre el caso y ejecutar acciones sobre él mediante herramientas que Gemini decide invocar.',
  inputs: ['caso guardado', 'pregunta del usuario', 'novedades activas'],
  tools: ['buscar_servicios (datos propios)', 'consultar_novedades (datos propios)', 'calcular_ruta (OSRM + geolocalización)', 'actualizar_caso (acción)'],
  outputs: ['respuesta', 'herramientas usadas', 'cambios persistidos en el caso']
};

// Registra el evento en la traza persistida del caso
function persistEvent(caseId, event) {
  const current = getCaseById(caseId);
  updateCase(caseId, {
    trace_events: [...(current.trace_events || []), event],
    trace_log: [...(current.trace_log || []), event.message]
  });
}

const functionDeclarations = [
  {
    name: 'buscar_servicios',
    description: 'Consulta la base de datos propia de servicios urbanos para una categoría.',
    parameters: {
      type: 'OBJECT',
      properties: {
        categoria: { type: 'STRING', description: 'Movilidad, Infraestructura, Seguridad, Salud, Ambiente u Otra' }
      },
      required: ['categoria']
    }
  },
  {
    name: 'calcular_ruta',
    description: 'Geolocaliza un destino y calcula la mejor ruta desde el punto de partida del usuario (o el indicado en "origen"), considerando novedades viales activas.',
    parameters: {
      type: 'OBJECT',
      properties: {
        destino: { type: 'STRING', description: 'Dirección o lugar de destino en Bogotá' },
        origen: { type: 'STRING', description: 'Opcional: nuevo punto de partida si el usuario lo indica. No es la ubicación de la novedad.' }
      },
      required: ['destino']
    }
  },
  {
    name: 'consultar_novedades',
    description: 'Lista las novedades viales activas reportadas en el sistema en las últimas 24 horas.',
    parameters: { type: 'OBJECT', properties: {} }
  },
  {
    name: 'actualizar_caso',
    description: 'Acción sobre el caso: cambia su urgencia, guarda una nota o fija el destino. Úsala solo si el usuario lo pide.',
    parameters: {
      type: 'OBJECT',
      properties: {
        urgencia: { type: 'STRING', description: 'Bajo, Medio o Alto' },
        nota: { type: 'STRING', description: 'Nota o información adicional a anexar al caso' },
        destino: { type: 'STRING', description: 'Nuevo destino del caso' }
      }
    }
  }
];

function createToolHandlers(caseId, getActiveIncidents) {
  const current = () => getCaseById(caseId);

  return {
    async buscar_servicios({ categoria }) {
      return { servicios: searchLocalServices(categoria) };
    },

    async calcular_ruta({ destino, origen }) {
      const urbanCase = current();
      if (!destino) return { error: 'Falta el destino.' };

      // Punto de partida: el indicado ahora, el del caso, o (si no hay) la ubicación de la novedad
      let startPoint = urbanCase.start_point || (urbanCase.location && {
        name: urbanCase.location.display_name, lat: urbanCase.location.lat, lon: urbanCase.location.lon
      });
      if (origen) {
        const startGeo = await getGeolocationData(origen);
        startPoint = { name: origen, lat: startGeo.lat, lon: startGeo.lon };
      }
      if (!startPoint) return { error: 'El caso no tiene un punto de partida geolocalizado.' };

      const destGeo = await getGeolocationData(destino);
      const destination = { name: destino, lat: destGeo.lat, lon: destGeo.lon };
      const route = await getBestRoute(startPoint, destination, getActiveIncidents());

      // Acción: la ruta calculada queda guardada en el caso
      const newRoute = { ...route, origin: startPoint, destination };
      const previous = urbanCase.route_history ?? (urbanCase.route ? [{ at: urbanCase.createdAt, source: 'registro', route: urbanCase.route }] : []);
      updateCase(caseId, {
        route: newRoute,
        route_history: [...previous, { at: new Date().toISOString(), source: 'chat', route: newRoute }],
        start_point: startPoint,
        ...(origen && { start_location: origen }),
        destination_location: destino
      });

      const { geometry, ...best } = route.best;
      return {
        mejor_ruta: best,
        alternativas: route.alternatives.map(({ geometry: _g, ...a }) => a),
        alertas: route.alerts,
        nota: 'Los tiempos no incluyen tráfico en vivo. La ruta quedó guardada en el caso.'
      };
    },

    async consultar_novedades() {
      return { novedades: getActiveIncidents().map((i) => i.summary) };
    },

    async actualizar_caso({ urgencia, nota, destino }) {
      const urbanCase = current();
      const changes = {};
      const applied = [];

      if (urgencia) {
        const level = URGENCY_LEVELS.find((l) => l.toLowerCase() === String(urgencia).toLowerCase());
        if (!level) return { error: `Urgencia inválida. Use: ${URGENCY_LEVELS.join(', ')}.` };
        changes.analysis = { ...urbanCase.analysis, urgency_level: level };
        applied.push(`urgencia=${level}`);
      }
      if (nota) {
        changes.notes = [...(urbanCase.notes || []), { text: String(nota).slice(0, 500), at: new Date().toISOString() }];
        applied.push('nota agregada');
      }
      if (destino) {
        changes.destination_location = String(destino).slice(0, 200);
        applied.push(`destino=${changes.destination_location}`);
      }
      if (!applied.length) return { error: 'No se indicó ningún cambio.' };

      updateCase(caseId, changes);
      return { ok: true, cambios: applied };
    }
  };
}

// Devuelve { text, toolsUsed: [{ name, args }] }
async function runChatAgent({ urbanCase, question, systemPrompt, getActiveIncidents }) {
  const handlers = createToolHandlers(urbanCase.id, getActiveIncidents);
  const contents = [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nPregunta del usuario: ${question}` }] }];
  const toolsUsed = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await generateContent({
      contents,
      config: { tools: [{ functionDeclarations }] }
    });

    const calls = response.functionCalls || [];
    if (!calls.length) return { text: response.text, toolsUsed };

    contents.push(response.candidates[0].content);
    const responseParts = [];
    for (const call of calls) {
      toolsUsed.push({ name: call.name, args: call.args || {} });
      let result;
      try {
        const handler = handlers[call.name];
        result = handler ? await handler(call.args || {}) : { error: 'Herramienta desconocida.' };
      } catch (error) {
        result = { error: error.message };
      }

      const failed = Boolean(result?.error);
      const kind = ACTION_TOOLS.includes(call.name) && !failed ? 'action' : 'tool';
      const label = kind === 'action' ? 'acción ejecutada' : failed ? 'herramienta con error' : 'herramienta ejecutada';
      const trace = createTrace();
      persistEvent(urbanCase.id, trace.log({
        agent: NAME, kind, tool: call.name, input: call.args || {}, output: result,
        message: `${NAME}: ${label} '${call.name}' con ${JSON.stringify(call.args || {})}.`
      }));
      responseParts.push({ functionResponse: { name: call.name, response: result } });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  // Si se agotan los pasos, se pide una respuesta final sin herramientas
  const final = await generateContent({ contents });
  return { text: final.text, toolsUsed };
}

module.exports = { runChatAgent, chatAgentInfo };
