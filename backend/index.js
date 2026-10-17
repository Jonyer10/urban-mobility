const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MultiAgentOrchestrator, describeAgents } = require('./agents/orchestrator');
const { runChatAgent } = require('./agents/chatAgent');
const { createCase, updateCase, getCaseById, listCases, getRecentCases, cacheGet, cacheSet, normalizeKey } = require('./services/db');
const { detectMime } = require('./services/image');

const app = express();
app.use(express.json({ limit: '10mb' })); // Permitir imágenes en Base64
app.use(cors());

const INCIDENT_TTL_MS = 24 * 60 * 60 * 1000;
const CHAT_CACHE_TTL_MS = 10 * 60 * 1000;

// Novedades viales reportadas en las últimas 24 h
function getActiveIncidents() {
  return getRecentCases(INCIDENT_TTL_MS)
    .filter((c) => c.analysis?.affects_road && c.location)
    .map((c) => ({ id: c.id, lat: c.location.lat, lon: c.location.lon, summary: `${c.analysis.summary} (${c.incident_location ?? c.origin_location})` }));
}

// Conserva cada intercambio del chat en el caso (se relee el caso: las herramientas pudieron modificarlo)
function recordChat(caseId, question, response, toolsUsed, cached) {
  const current = getCaseById(caseId);
  updateCase(caseId, {
    chat_history: [...(current.chat_history || []), { at: new Date().toISOString(), question, response, tools_used: toolsUsed, cached }]
  });
}

// Endpoint principal: Procesamiento multimodal y orquestación de agentes (Fases 2, 4, 6, 7)
// incident_location: dónde ocurre la novedad | start_location: desde dónde parte el usuario | destination_location: a dónde va
app.post('/api/process-case', async (req, res) => {
  try {
    const { user_text, image_base64, destination_location, start_location } = req.body;
    const incident_location = req.body.incident_location || req.body.origin_location; // origin_location: compatibilidad

    if (!user_text || !incident_location) {
      return res.status(400).json({ 
        error: "Los campos 'user_text' e 'incident_location' son obligatorios." 
      });
    }

    // Ejecutar el flujo coordinado de agentes y herramientas
    const workflowResult = await MultiAgentOrchestrator.runWorkflow(
      user_text, 
      image_base64, 
      incident_location,
      { startLocation: start_location, destinationLocation: destination_location, activeIncidents: getActiveIncidents() }
    );

    // Crear registro persistente del caso con trazabilidad (Fase 7)
    const newCase = createCase({
      user_text,
      incident_location,
      start_location: start_location || null,
      destination_location: destination_location || null,
      has_image: Boolean(image_base64),
      image_mime: image_base64 ? detectMime(image_base64) : null,
      image_base64: image_base64 || null,
      analysis: workflowResult.analysis,
      recommendations: workflowResult.recommendations,
      action_executed: workflowResult.action_result,
      location: workflowResult.location || null,
      start_point: workflowResult.start_point || null,
      services: workflowResult.services || [],
      route: workflowResult.route || null,
      trace_log: workflowResult.trace,
      trace_events: workflowResult.trace_events || [],
      chat_history: []
    });

    return res.status(201).json({
      case_id: newCase.id,
      has_image: newCase.has_image,
      analysis: newCase.analysis,
      recommendations: newCase.recommendations,
      action_result: newCase.action_executed,
      location: newCase.location,
      services: newCase.services,
      route: newCase.route,
      start_point: newCase.start_point,
      trace: newCase.trace_log,
      trace_events: newCase.trace_events
    });

  } catch (error) {
    console.error("Error al procesar el caso en el servidor:", error);
    return res.status(500).json({ error: "Error interno al procesar la solicitud." });
  }
});

// Endpoint: Chat contextual asociado a un caso previo (Fase 5)
app.post('/api/chat-contextual', async (req, res) => {
  try {
    const { case_id, question } = req.body;

    const urbanCase = getCaseById(Number(case_id));
    if (!urbanCase) {
      return res.status(404).json({ error: "Caso no encontrado en el sistema." });
    }

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: "El campo 'question' es obligatorio." });
    }

    const chatCacheKey = `chat:${urbanCase.id}:${normalizeKey(question)}`;
    const cachedAnswer = cacheGet(chatCacheKey);
    if (cachedAnswer) {
      recordChat(urbanCase.id, question, cachedAnswer, [], true);
      return res.json({ case_id: urbanCase.id, question, response: cachedAnswer, cached: true });
    }

    // Respuesta contextual basada estrictamente en la información verificada del caso (Fase 5)
    const caseContext = JSON.stringify({
      descripcion: urbanCase.user_text,
      ubicacion_de_la_novedad: urbanCase.incident_location ?? urbanCase.origin_location,
      punto_de_partida: urbanCase.start_location,
      destino: urbanCase.destination_location,
      analisis: urbanCase.analysis,
      recomendaciones: urbanCase.recommendations,
      accion: urbanCase.action_executed,
      servicios: urbanCase.services,
      ruta: urbanCase.route && {
        ...urbanCase.route,
        best: { ...urbanCase.route.best, geometry: undefined },
        alternatives: urbanCase.route.alternatives?.map((a) => ({ ...a, geometry: undefined }))
      },
      novedades_activas_en_el_sistema: getActiveIncidents().map((i) => i.summary)
    });

    const prompt = `Eres un asistente de movilidad urbana en Bogotá. Responde en español, breve y práctico.
Usa únicamente los datos del caso y las novedades activas del sistema. No tienes acceso a tráfico en tiempo real: si preguntan por tráfico, retrasos o cierres que no estén en los datos, dilo con claridad y sugiere consultar Waze, Google Maps o @BogotaTransito, en lugar de inventar. Si el usuario no ha indicado destino, pregúntaselo para sugerir rutas.

Datos del caso: ${caseContext}

Dispones de herramientas: buscar_servicios, calcular_ruta, consultar_novedades y actualizar_caso. Úsalas cuando la pregunta lo requiera (por ejemplo, rutas a un destino nuevo o cambiar la urgencia) y no inventes resultados. Usa actualizar_caso solo si el usuario lo pide explícitamente. Informa qué acción ejecutaste.`;

    let responseText;
    let toolsUsed = [];
    try {
      const result = await runChatAgent({ urbanCase, question, systemPrompt: prompt, getActiveIncidents });
      responseText = result.text;
      toolsUsed = result.toolsUsed;
      // Solo se cachean respuestas sin herramientas: con herramientas dependen del estado actual
      if (!toolsUsed.length) cacheSet(chatCacheKey, responseText, CHAT_CACHE_TTL_MS);
    } catch (modelError) {
      console.warn("Aviso: chat sin Gemini, usando respuesta por defecto:", modelError.message);
      responseText = `Caso #${urbanCase.id} (${urbanCase.analysis.category}): la acción ejecutada fue '${urbanCase.action_executed}'. No fue posible consultar al modelo para su pregunta.`;
    }

    recordChat(urbanCase.id, question, responseText, toolsUsed, false);

    return res.json({
      case_id: urbanCase.id,
      question,
      response: responseText,
      tools_used: toolsUsed
    });

  } catch (error) {
    console.error("Error en chat contextual:", error);
    return res.status(500).json({ error: "Error al procesar la consulta en el chat." });
  }
});

// Endpoint: Descripción de los agentes (responsabilidad, entradas, herramientas y salidas)
app.get('/api/agents', (req, res) => res.json(describeAgents()));

// Endpoint: Listado de casos persistidos (más recientes primero)
app.get('/api/cases', (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
  return res.json(listCases(limit).map((c) => ({
    id: c.id,
    created_at: c.createdAt,
    user_text: c.user_text,
    incident_location: c.incident_location ?? c.origin_location,
    category: c.analysis?.category,
    urgency_level: c.analysis?.urgency_level,
    action_executed: c.action_executed
  })));
});

// Endpoint: Recuperar información, resultados y trazabilidad de un caso (Fase 7)
app.get('/api/cases/:id', (req, res) => {
  const caseId = Number.parseInt(req.params.id, 10);
  const urbanCase = getCaseById(caseId);

  if (!urbanCase) {
    return res.status(404).json({ error: "Caso no encontrado." });
  }

  const { image_base64, ...rest } = urbanCase; // la imagen se sirve aparte
  return res.json(rest);
});

// Endpoint: imagen adjunta del caso
app.get('/api/cases/:id/image', (req, res) => {
  const urbanCase = getCaseById(Number.parseInt(req.params.id, 10));
  if (!urbanCase?.image_base64) return res.status(404).json({ error: 'El caso no tiene imagen.' });
  res.type(urbanCase.image_mime || 'image/jpeg').send(Buffer.from(urbanCase.image_base64, 'base64'));
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor backend corriendo exitosamente en el puerto ${PORT}`);
});