// Trazabilidad estructurada: cada evento identifica qué agente o herramienta participó,
// con qué entrada, qué resultado produjo y cuándo.
// kind: 'agent' (decisión o resultado de un agente) | 'tool' (herramienta consultada) | 'action' (cambio ejecutado en el sistema)
const MAX_SUMMARY = 400;

function summarize(value) {
  if (value === undefined || value === null) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value, (k, v) => (k === 'geometry' ? undefined : v));
  return text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY)}…` : text;
}

function createTrace(initialEvents = []) {
  const events = [...initialEvents];

  return {
    events,
    log({ agent, kind = 'agent', tool = null, input, output, message }) {
      const event = { at: new Date().toISOString(), agent, kind, tool, input: summarize(input), output: summarize(output), message };
      events.push(event);
      return event;
    },
    // Lista de mensajes legibles (compatible con el campo `trace` que consume la interfaz)
    messages: () => events.map((e) => e.message)
  };
}

module.exports = { createTrace };
