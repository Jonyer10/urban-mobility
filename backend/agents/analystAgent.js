// Agente 1: Analista Multimodal.
// Responsabilidad: interpretar el caso (texto + imagen) y estructurarlo. No consulta datos propios ni mapas.
const { cacheGet, cacheSet, normalizeKey } = require('../services/db');
const { generateContent } = require('../services/gemini');
const { detectMime, sizeKb } = require('../services/image');

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
  outputs: ['analysis: category, urgency_level, summary, is_valid_case, consistency, affects_road'],

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

    const imageMime = imageBase64 ? detectMime(imageBase64) : null;
    if (imageBase64) {
      const info = { tipo: imageMime, tamano_kb: sizeKb(imageBase64) };
      trace.log({ agent: NAME, kind: 'tool', tool: 'imagen', input: info, output: 'Imagen adjunta recibida y enviada a Gemini junto con el texto.', message: `${NAME}: imagen adjunta recibida (${info.tipo}, ${info.tamano_kb} KB).` });
    }

    const cacheKey = imageBase64 ? null : `analysis:${normalizeKey(userText)}`;
    const cached = cacheKey ? cacheGet(cacheKey) : null;

    if (cached) {
      analysis = { ...analysis, ...cached };
      trace.log({ agent: NAME, kind: 'tool', tool: 'cache_analisis', input: userText, output: cached, message: `${NAME}: análisis reutilizado desde la caché (sin consumir cuota de Gemini).` });
    } else {
      try {
        const contents = [{
          text: `Analiza esta necesidad urbana y responde estrictamente en formato JSON plano (sin bloques de código markdown) con las llaves exactas: "category" (una de: Movilidad, Infraestructura, Seguridad, Salud, Ambiente, Otra), "urgency_level" (Bajo, Medio o Alto), "summary" (una frase corta), "is_valid_case" (booleano), "affects_road" (booleano: true si reporta una novedad en la vía que puede afectar el tránsito, como accidente, hueco, cierre, obra, semáforo dañado o falta de luz)${imageBase64 ? ', "image_description" (una frase que describa lo que se ve en la imagen adjunta y si confirma o contradice el texto)' : ''}, "consistency" (una de: coherente, insuficiente, contradictoria, no_corresponde; usa "contradictoria" si el texto se contradice a sí mismo o con la imagen adjunta, "no_corresponde" si el texto o la imagen no describen una necesidad urbana real de movilidad, infraestructura, seguridad, salud o ambiente, e "insuficiente" si falta información para actuar), "missing_info_reason" (frase que explique qué falta o qué no coincide; null si es coherente). Marca "is_valid_case" como false siempre que consistency no sea "coherente". Texto del usuario: ${userText}`
        }];
        if (imageBase64) contents.push({ inlineData: { mimeType: imageMime, data: imageBase64 } });

        const response = await generateContent({ contents });
        // Expresión regular lineal y segura sin cuantificadores anidados que causen backtracking
        const jsonMatch = response.text.match(/\{[^}]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          analysis = { ...analysis, ...parsed };
          if (cacheKey) cacheSet(cacheKey, parsed, ANALYSIS_TTL_MS);
        }
        trace.log({ agent: NAME, kind: 'tool', tool: 'gemini', input: { texto: userText, con_imagen: Boolean(imageBase64), tipo_imagen: imageMime }, output: analysis, message: `${NAME}: Gemini consultado para analizar el caso.` });
      } catch (modelError) {
        console.warn('Aviso: No se pudo conectar con Gemini o parsear la respuesta, usando análisis por defecto:', modelError.message);
        trace.log({ agent: NAME, kind: 'tool', tool: 'gemini', input: userText, output: modelError.message, message: `${NAME}: Gemini no disponible; se usa el análisis por defecto.` });
      }
    }

    // Información insuficiente, contradictoria o que no corresponde con un caso urbano: se detiene el flujo
    const inconsistent = analysis.consistency && analysis.consistency !== 'coherente';
    if (analysis.is_valid_case === false || inconsistent) {
      analysis.is_valid_case = false;
      analysis.missing_info_reason = analysis.missing_info_reason || 'La información proporcionada no permite procesar el caso; revísala e inténtalo de nuevo.';
      trace.log({ agent: NAME, kind: 'action', tool: 'validar_caso', input: { consistency: analysis.consistency ?? null }, output: analysis.missing_info_reason, message: `${NAME}: caso rechazado (${analysis.consistency ?? 'no válido'}). ${analysis.missing_info_reason}` });
      return { rejected: true, analysis };
    }

    trace.log({ agent: NAME, output: analysis, message: `${NAME}: análisis completado con categoría '${analysis.category}', urgencia ${analysis.urgency_level}.` });
    return { rejected: false, analysis };
  }
};

module.exports = { analystAgent };
