// Orquestador: no contiene lógica de negocio; decide el orden y las condiciones de participación
// de los agentes, y les pasa el resultado del anterior.
//
//   Agente 1 (Analista)  -->  [¿información suficiente?]  --no-->  fin (caso rechazado)
//                                      | sí
//                         Agente 2 (Ubicación y solución)
//                                      |
//                         Agente 3 (Rutas y alertas)
//                              (calcula ruta si hay destino, o si el caso no es una novedad vial;
//                               en otro caso solicita el destino al usuario)
const { createTrace } = require('../services/trace');
const { analystAgent } = require('./analystAgent');
const { locationAgent } = require('./locationAgent');
const { routeAgent } = require('./routeAgent');
const { chatAgentInfo } = require('./chatAgent');

const AGENTS = [analystAgent, locationAgent, routeAgent, chatAgentInfo];

const describeAgents = () =>
  AGENTS.map(({ name, responsibility, inputs, tools, outputs }) => ({ name, responsibility, inputs, tools, outputs }));

class MultiAgentOrchestrator {
  // options: { startLocation?, destinationLocation?, activeIncidents?: [{ id, lat, lon, summary }] }
  // incidentLocation: lugar donde ocurre la novedad; startLocation: desde donde inicia el recorrido del usuario
  static async runWorkflow(userText, imageBase64, incidentLocation, options = {}) {
    const { startLocation, destinationLocation, activeIncidents = [] } = options;
    const trace = createTrace();
    const orchestrator = 'Orquestador';

    // Paso 1: análisis. Condición de continuidad: información suficiente.
    const { analysis, rejected } = await analystAgent.run({ userText, imageBase64 }, trace);
    if (rejected) {
      trace.log({ agent: orchestrator, message: `${orchestrator}: flujo detenido tras el Agente 1 (información insuficiente).` });
      return {
        analysis,
        recommendations: [],
        action_result: 'Caso rechazado por información insuficiente.',
        trace: trace.messages(),
        trace_events: trace.events
      };
    }

    // Paso 2: ubicación, entidad responsable y acción de registro.
    trace.log({ agent: orchestrator, message: `${orchestrator}: se delega la ubicación y la asignación de entidad al Agente 2.` });
    const located = await locationAgent.run({ analysis, incidentLocation, hasDestination: Boolean(destinationLocation) }, trace);

    // Paso 3: rutas y alertas, con los resultados del Agente 2.
    trace.log({ agent: orchestrator, message: `${orchestrator}: se delega el cálculo de rutas al Agente 3.` });
    const planned = await routeAgent.run({
      analysis,
      incident: { ...located.location },
      services: located.services,
      isRoadIncident: located.isRoadIncident,
      startLocation,
      destinationLocation,
      activeIncidents
    }, trace);

    return {
      analysis,
      recommendations: [...located.recommendations, ...planned.recommendations],
      action_result: located.actionResult,
      location: located.location,
      services: located.services,
      route: planned.route,
      start_point: planned.startPoint,
      trace: trace.messages(),
      trace_events: trace.events
    };
  }
}

module.exports = { MultiAgentOrchestrator, describeAgents };
