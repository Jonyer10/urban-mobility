// Agente 1: Analista Multimodal.
// Responsabilidad: interpretar el caso (texto + imagen) y estructurarlo. No consulta datos propios ni mapas.
const { cacheGet, cacheSet, normalizeKey } = require('../services/db');
const { generateContent } = require('../services/gemini');

const ANALYSIS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_TEXT_LENGTH = 5;
const NAME = 'Agente 1 (Analista Multimodal)';

const DEFAULT_ANALYSIS = {
  category: 'Movilidad',
  urgency_level: 'Medio',
  is_valid_case: true,
  affects_road: false,
  missing_info_reason: null
};

const analystAgent = {
  name: NAME,
  responsibility: 'Interpretar texto e imagen del caso y producir un análisis estructurado.',
  inputs: ['user_text', 'image_base64 (opcional)'],
  tools: ['Gemini (modelo multimodal)', 'Caché de análisis (SQLite)'],
  outputs: ['analysis: category, urgency_level, summary, is_valid_case, affects_road'],

  // Devuelve { analysis, rejected }. rejected = true si la información es insuficiente y el flujo debe detenerse.
  async run({ userText, imageBase64 }, trace) {
    trace.log({ agent: NAME, message: `${NAME}: iniciando evaluación de texto${imageBase64 ? ' e imagen' : ''}.` });

    if (!userText || userText.trim().length < MIN_TEXT_LENGTH) {
      trace.log({ agent: NAME, message: `${NAME}: información insuficiente, el caso se rechaza.` });
      return {
        rejected: true,
        analysis: {
          category: 'Desconocida',
          urgency_level: 'Bajo',
          summary: 'La descripción provista es demasiado corta o no válida.',
          is_valid_case: false,
          missing_info_reason: 'Por favor proporcione una descripción más detallada de su necesidad urbana.'
        }
      };
    }

    let analysis = { ...DEFAULT_ANALYSIS, summary: userText };

    const cacheKey = imageBase64 ? null : `analysis:${normalizeKey(userText)}`;
    const cached = cacheKey ? cacheGet(cacheKey) : null;

    if (cached) {
      analysis = { ...analysis, ...cached };
      trace.log({ agent: NAME, kind: 'tool', tool: 'cache_analisis', input: userText, output: cached, message: `${NAME}: análisis reutilizado desde la caché (sin consumir cuota de Gemini).` });
    } else {
      try {
        const contents = [{
          text: `Analiza esta necesidad urbana y responde estrictamente en formato JSON plano (sin bloques de código markdown) con las llaves exactas: "category" (una de: Movilidad, Infraestructura, Seguridad, Salud, Ambiente, Otra), "urgency_level" (Bajo, Medio o Alto), "summary" (una frase corta), "is_valid_case" (booleano), "affects_road" (booleano: true si reporta una novedad en la vía que puede afectar el tránsito, como accidente, hueco, cierre, obra, semáforo dañado o falta de luz). Texto del usuario: ${userText}`
        }];
        if (imageBase64) contents.push({ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } });

        const response = await generateContent({ contents });
        // Expresión regular lineal y segura sin cuantificadores anidados que causen backtracking
        const jsonMatch = response.text.match(/\{[^}]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          analysis = { ...analysis, ...parsed };
          if (cacheKey) cacheSet(cacheKey, parsed, ANALYSIS_TTL_MS);
        }
        trace.log({ agent: NAME, kind: 'tool', tool: 'gemini', input: { texto: userText, con_imagen: Boolean(imageBase64) }, output: analysis, message: `${NAME}: Gemini consultado para analizar el caso.` });
      } catch (modelError) {
        console.warn('Aviso: No se pudo conectar con Gemini o parsear la respuesta, usando análisis por defecto:', modelError.message);
        trace.log({ agent: NAME, kind: 'tool', tool: 'gemini', input: userText, output: modelError.message, message: `${NAME}: Gemini no disponible; se usa el análisis por defecto.` });
      }
    }

    trace.log({ agent: NAME, output: analysis, message: `${NAME}: análisis completado con categoría '${analysis.category}', urgencia ${analysis.urgency_level}.` });
    return { rejected: false, analysis };
  }
};

module.exports = { analystAgent };
