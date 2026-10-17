const { searchLocalServices } = require('../services/localData');
const { getGeolocationData } = require('../services/geolocation');
const { getBestRoute } = require('../services/routing');
const { cacheGet, cacheSet, normalizeKey } = require('../services/db');
const { generateContent } = require('../services/gemini');

const ANALYSIS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

class MultiAgentOrchestrator {
  // options: { destinationLocation?: string, activeIncidents?: [{ id, lat, lon, summary }] }
  static async runWorkflow(userText, imageBase64, originLocation, options = {}) {
    const { destinationLocation, activeIncidents = [] } = options;
    const trace = [];
    const logTrace = (msg) => trace.push(msg);

    // --- AGENTE 1: Analista Multimodal ---
    logTrace("Agente 1 (Analista Multimodal): Iniciando evaluación de texto e imagen.");

    if (!userText || userText.trim().length < 5) {
      logTrace("Agente 1: Información insuficiente detectada en el caso.");
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
      affects_road: false,
      missing_info_reason: null
    };

    const analysisCacheKey = imageBase64 ? null : `analysis:${normalizeKey(userText)}`;
    const cachedAnalysis = analysisCacheKey ? cacheGet(analysisCacheKey) : null;

    if (cachedAnalysis) {
      analysisResult = { ...analysisResult, ...cachedAnalysis };
      logTrace("Agente 1: Análisis reutilizado desde la caché (sin consumir cuota de Gemini).");
    } else try {
      const contents = [
        {
          text: `Analiza esta necesidad urbana y responde estrictamente en formato JSON plano (sin bloques de código markdown) con las llaves exactas: "category" (una de: Movilidad, Infraestructura, Seguridad, Salud, Ambiente, Otra), "urgency_level" (Bajo, Medio o Alto), "summary" (una frase corta), "is_valid_case" (booleano), "affects_road" (booleano: true si reporta una novedad en la vía que puede afectar el tránsito, como accidente, hueco, cierre, obra, semáforo dañado o falta de luz). Texto del usuario: ${userText}`
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

      const response = await generateContent({ contents });

      const responseText = response.text;
      // Expresión regular lineal y segura sin cuantificadores anidados que causen backtracking
      const jsonMatch = responseText.match(/\{[^}]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        analysisResult = { ...analysisResult, ...parsed };
        if (analysisCacheKey) cacheSet(analysisCacheKey, parsed, ANALYSIS_TTL_MS);
      }
    } catch (modelError) {
      console.warn("Aviso: No se pudo conectar con Gemini o parsear la respuesta, usando análisis por defecto:", modelError.message);
    }

    logTrace(`Agente 1: Análisis estructurado completado con categoría '${analysisResult.category}'.`);

    // --- AGENTE 2: Especialista de Ubicación, Herramientas y Solución ---
    logTrace("Agente 2 (Especialista de Ubicación y Herramientas): Seleccionando y ejecutando herramientas.");

    const localData = searchLocalServices(analysisResult.category);
    logTrace(`Herramienta ejecutada: Consulta de base de datos propia de servicios urbanos. Entidad: ${localData[0].name}`);

    const geoData = await getGeolocationData(originLocation);
    logTrace(`Herramienta ejecutada: API Externa de Geolocalizacion consultada. Lat: ${geoData.lat}, Lon: ${geoData.lon}`);

    const isRoadIncident = analysisResult.affects_road === true;
    const recommendations = [];
    if (isRoadIncident) {
      recommendations.push(`Su reporte fue registrado y notificado a ${localData[0].name} (${localData[0].contact}). No necesita desplazarse hasta allí.`);
    } else if (!destinationLocation) {
      recommendations.push(`Derivar la solicitud al recurso propio: ${localData[0].name} (Contacto: ${localData[0].contact}).`);
    }
    recommendations.push(`Punto de referencia geolocalizado en: ${geoData.display_name}.`);

    const actionResult = `Caso registrado formalmente en el sistema con prioridad ${analysisResult.urgency_level} y asignado a ${localData[0].name}.`;
    logTrace(`Acción ejecutada: ${actionResult}`);

    // --- AGENTE 3: Planificador de Rutas y Alertas ---
    logTrace("Agente 3 (Planificador de Rutas y Alertas): Evaluando rutas y novedades en la vía.");

    // Destino: el indicado por el usuario; si no hay, el servicio asignado (solo para casos que no son novedades viales)
    let destination = null;
    if (destinationLocation) {
      const destGeo = await getGeolocationData(destinationLocation);
      destination = { name: destinationLocation, lat: destGeo.lat, lon: destGeo.lon };
      logTrace(`Herramienta ejecutada: Geolocalización del destino '${destinationLocation}'.`);
    } else if (!isRoadIncident) {
      destination = { name: localData[0].name, lat: localData[0].lat, lon: localData[0].lon };
    }

    const incidentsNearby = [...activeIncidents];
    if (isRoadIncident) {
      incidentsNearby.push({ id: 'nuevo', lat: geoData.lat, lon: geoData.lon, summary: analysisResult.summary });
    }
    logTrace(`Agente 3: ${incidentsNearby.length} novedad(es) activa(s) consideradas en el cálculo.`);

    let route = null;
    if (destination) {
      try {
        route = await getBestRoute({ lat: geoData.lat, lon: geoData.lon }, destination, incidentsNearby);
        logTrace(`Herramienta ejecutada: Servicio de rutas (${route.best.source}). Opciones: ${route.alternatives.map((a) => `${a.name} ~${a.duration_min} min`).join(', ')}.`);
        recommendations.push(`Mejor ruta hacia ${destination.name}: ${route.best.name}, ${route.best.distance_km} km, ~${route.best.duration_min} min${route.best.via.length ? ` (por ${route.best.via.slice(0, 3).join(' → ')})` : ''}.`);
        recommendations.push(...route.alerts);
        route.alerts.forEach((a) => logTrace(`Agente 3: Alerta emitida: ${a}`));
      } catch (routeError) {
        logTrace(`Agente 3: No fue posible calcular la ruta (${routeError.message}).`);
      }
    } else {
      recommendations.push("Indique su destino para recomendarle la mejor ruta y alertarle de novedades en el camino.");
      logTrace("Agente 3: Sin destino; se solicita al usuario para calcular rutas.");
    }
    recommendations.push("Nota: los tiempos no incluyen tráfico en vivo; los retrasos se estiman a partir de las novedades reportadas en el sistema.");

    return {
      analysis: analysisResult,
      recommendations,
      action_result: actionResult,
      location: { lat: geoData.lat, lon: geoData.lon, display_name: geoData.display_name, source: geoData.source },
      services: localData,
      route,
      trace
    };
  }
}

module.exports = { MultiAgentOrchestrator };