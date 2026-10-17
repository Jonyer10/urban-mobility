const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { generateContent } = require('./services/gemini');
const { MultiAgentOrchestrator } = require('./agents/orchestrator');
const { createCase, getCaseById, getRecentCases, cacheGet, cacheSet, normalizeKey } = require('./services/db');

const app = express();
app.use(express.json({ limit: '10mb' })); // Permitir imágenes en Base64
app.use(cors());

const INCIDENT_TTL_MS = 24 * 60 * 60 * 1000;
const CHAT_CACHE_TTL_MS = 10 * 60 * 1000;

// Novedades viales reportadas en las últimas 24 h
function getActiveIncidents() {
  return getRecentCases(INCIDENT_TTL_MS)
    .filter((c) => c.analysis?.affects_road && c.location)
    .map((c) => ({ id: c.id, lat: c.location.lat, lon: c.location.lon, summary: `${c.analysis.summary} (${c.origin_location})` }));
}

// Endpoint principal: Procesamiento multimodal y orquestación de agentes (Fases 2, 4, 6, 7)
app.post('/api/process-case', async (req, res) => {
  try {
    const { user_text, image_base64, origin_location, destination_location } = req.body;

    if (!user_text || !origin_location) {
      return res.status(400).json({ 
        error: "Los campos 'user_text' y 'origin_location' son obligatorios." 
      });
    }

    // Ejecutar el flujo coordinado de agentes y herramientas
    const workflowResult = await MultiAgentOrchestrator.runWorkflow(
      user_text, 
      image_base64, 
      origin_location,
      { destinationLocation: destination_location, activeIncidents: getActiveIncidents() }
    );

    // Crear registro persistente del caso con trazabilidad (Fase 7)
    const newCase = createCase({
      user_text,
      origin_location,
      destination_location: destination_location || null,
      analysis: workflowResult.analysis,
      recommendations: workflowResult.recommendations,
      action_executed: workflowResult.action_result,
      location: workflowResult.location || null,
      services: workflowResult.services || [],
      route: workflowResult.route || null,
      trace_log: workflowResult.trace
    });

    return res.status(201).json({
      case_id: newCase.id,
      analysis: newCase.analysis,
      recommendations: newCase.recommendations,
      action_result: newCase.action_executed,
      location: newCase.location,
      services: newCase.services,
      route: newCase.route,
      trace: newCase.trace_log
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
      return res.json({ case_id: urbanCase.id, question, response: cachedAnswer, cached: true });
    }

    // Respuesta contextual basada estrictamente en la información verificada del caso (Fase 5)
    const caseContext = JSON.stringify({
      descripcion: urbanCase.user_text,
      origen: urbanCase.origin_location,
      destino: urbanCase.destination_location,
      analisis: urbanCase.analysis,
      recomendaciones: urbanCase.recommendations,
      accion: urbanCase.action_executed,
      servicios: urbanCase.services,
      ruta: urbanCase.route,
      novedades_activas_en_el_sistema: getActiveIncidents().map((i) => i.summary)
    });

    const prompt = `Eres un asistente de movilidad urbana en Bogotá. Responde en español, breve y práctico.
Usa únicamente los datos del caso y las novedades activas del sistema. No tienes acceso a tráfico en tiempo real: si preguntan por tráfico, retrasos o cierres que no estén en los datos, dilo con claridad y sugiere consultar Waze, Google Maps o @BogotaTransito, en lugar de inventar. Si el usuario no ha indicado destino, pregúntaselo para sugerir rutas.

Datos del caso: ${caseContext}

Pregunta del usuario: ${question}`;

    let responseText;
    try {
      const aiResponse = await generateContent({ contents: prompt, search: true });
      responseText = aiResponse.text;
      cacheSet(chatCacheKey, responseText, CHAT_CACHE_TTL_MS);
    } catch (modelError) {
      console.warn("Aviso: chat sin Gemini, usando respuesta por defecto:", modelError.message);
      responseText = `Caso #${urbanCase.id} (${urbanCase.analysis.category}): la acción ejecutada fue '${urbanCase.action_executed}'. No fue posible consultar al modelo para su pregunta.`;
    }

    return res.json({
      case_id: urbanCase.id,
      question,
      response: responseText
    });

  } catch (error) {
    console.error("Error en chat contextual:", error);
    return res.status(500).json({ error: "Error al procesar la consulta en el chat." });
  }
});

// Endpoint: Recuperar información, resultados y trazabilidad de un caso (Fase 7)
app.get('/api/cases/:id', (req, res) => {
  const caseId = Number.parseInt(req.params.id, 10);
  const urbanCase = getCaseById(caseId);

  if (!urbanCase) {
    return res.status(404).json({ error: "Caso no encontrado." });
  }

  return res.json(urbanCase);
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor backend corriendo exitosamente en el puerto ${PORT}`);
});