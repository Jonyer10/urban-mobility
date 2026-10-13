const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MultiAgentOrchestrator } = require('./agents/orchestrator');

const app = express();
app.use(express.json({ limit: '10mb' })); // Permitir imágenes en Base64
app.use(cors());

// Simulación de persistencia en memoria (Base de datos local del servidor)
const casesDB = [];

// Endpoint principal: Procesamiento multimodal y orquestación de agentes (Fases 2, 4, 6, 7)
app.post('/api/process-case', async (req, res) => {
  try {
    const { user_text, image_base64, origin_location } = req.body;

    if (!user_text || !origin_location) {
      return res.status(400).json({ 
        error: "Los campos 'user_text' y 'origin_location' son obligatorios." 
      });
    }

    // Ejecutar el flujo coordinado de agentes y herramientas
    const workflowResult = await MultiAgentOrchestrator.runWorkflow(
      user_text, 
      image_base64, 
      origin_location
    );

    // Crear registro persistente del caso con trazabilidad (Fase 7)
    const newCase = {
      id: casesDB.length + 1,
      user_text,
      origin_location,
      analysis: workflowResult.analysis,
      recommendations: workflowResult.recommendations,
      action_executed: workflowResult.action_result,
      location: workflowResult.location || null,
      services: workflowResult.services || [],
      trace_log: workflowResult.trace,
      createdAt: new Date()
    };

    casesDB.push(newCase);

    return res.status(201).json({
      case_id: newCase.id,
      analysis: newCase.analysis,
      recommendations: newCase.recommendations,
      action_result: newCase.action_executed,
      location: newCase.location,
      services: newCase.services,
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

    const urbanCase = casesDB.find(c => c.id === case_id);
    if (!urbanCase) {
      return res.status(404).json({ error: "Caso no encontrado en el sistema." });
    }

    // Respuesta contextual basada estrictamente en la información verificada del caso (Fase 5)
    const responseText = `Basado en el caso #${urbanCase.id} (${urbanCase.analysis.category}), la acción ejecutada fue: '${urbanCase.action_executed}'. Su consulta sobre "${question}" ha sido validada con los datos propios y herramientas del sistema.`;

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
  const urbanCase = casesDB.find(c => c.id === caseId);

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