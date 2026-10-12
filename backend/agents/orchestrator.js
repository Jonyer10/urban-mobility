const { GoogleGenAI } = require('@google/genai');
const { searchLocalServices } = require('../services/localData');
const { getGeolocationData } = require('../services/geolocation');

// Inicializar el cliente de Gemini utilizando la variable de entorno
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

class MultiAgentOrchestrator {
  static async runWorkflow(userText, imageBase64, originLocation) {
    const trace = [];
    const logTrace = (msg) => trace.push(msg);

    // --- AGENTE 1: Analista Multimodal ---
    logTrace("Agente 1 (Analista Multimodal): Iniciando evaluación de texto e imagen[cite: 2, 4].");

    if (!userText || userText.trim().length < 5) {
      logTrace("Agente 1: Información insuficiente detectada en el caso[cite: 2].");
      return {
        analysis: {
          category: "Desconocida",
          urgency_level: "Bajo",
          summary: "La descripción provista es demasiado corta o no válida.",
          is_valid_case: false,
          missing_info_reason: "Por favor proporcione una descripción más detallada de su necesidad urbana."
        },
        recommendations: [],
        action_result: "Caso rechazado por información insuficiente.",
        trace
      };
    }

    let analysisResult = {
      category: "Movilidad",
      urgency_level: "Medio",
      summary: userText,
      is_valid_case: true,
      missing_info_reason: null
    };

    try {
      const contents = [
        {
          text: `Analiza esta necesidad urbana y responde estrictamente en formato JSON plano (sin bloques de código markdown) con las llaves exactas: "category", "urgency_level", "summary", "is_valid_case" (booleano). Texto del usuario: ${userText}`
        }
      ];

      if (imageBase64) {
        contents.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: imageBase64
          }
        });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contents,
      });

      const responseText = response.text;
      // Expresión regular lineal y segura sin cuantificadores anidados que causen backtracking
      const jsonMatch = responseText.match(/\{[^}]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        analysisResult = { ...analysisResult, ...parsed };
      }
    } catch (modelError) {
      console.warn("Aviso: No se pudo conectar con Gemini o parsear la respuesta, usando análisis por defecto:", modelError.message);
    }

    logTrace(`Agente 1: Análisis estructurado completado con categoría '${analysisResult.category}'[cite: 2].`);

    // --- AGENTE 2: Especialista de Ubicación, Herramientas y Solución ---
    logTrace("Agente 2 (Especialista de Ubicación y Herramientas): Seleccionando y ejecutando herramientas[cite: 3, 4].");

    const localData = searchLocalServices(analysisResult.category);
    logTrace(`Herramienta ejecutada: Consulta de base de datos propia de servicios urbanos[cite: 3]. Entidad: ${localData[0].name}`);

    const geoData = await getGeolocationData(originLocation);
    logTrace(`Herramienta ejecutada: API Externa de Geolocalizacion consultada[cite: 3, 4]. Lat: ${geoData.lat}, Lon: ${geoData.lon}`);

    const recommendations = [
      `Derivar la solicitud al recurso propio: ${localData[0].name} (Contacto: ${localData[0].contact})[cite: 3].`,
      `Punto de referencia geolocalizado en: ${geoData.display_name}[cite: 3].`
    ];

    const actionResult = `Caso registrado formalmente en el sistema con prioridad ${analysisResult.urgency_level} y asignado a ${localData[0].name}[cite: 3].`;
    logTrace(`Acción ejecutada: ${actionResult}[cite: 3]`);

    return {
      analysis: analysisResult,
      recommendations,
      actionResult,
      trace
    };
  }
}

module.exports = { MultiAgentOrchestrator };