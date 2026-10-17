// Cliente de Gemini con respaldo entre varios modelos gratuitos.
// Cada modelo tiene su propia cuota diaria gratuita: si uno se agota (429) o no está disponible, se usa el siguiente.
const { GoogleGenAI } = require('@google/genai');

const DEFAULT_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.5-flash'];
const MODELS = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || DEFAULT_MODELS.join(','))
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

// La búsqueda de Google (grounding) no tiene cuota en el plan gratuito; activar solo con facturación
const USE_SEARCH = String(process.env.GEMINI_USE_SEARCH).toLowerCase() === 'true';
const RETRYABLE = /\b(429|503|404|500)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|NOT_FOUND/;
const COOLDOWN_MS = 60 * 60 * 1000;
const exhaustedUntil = new Map();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function generateContent({ contents, config, search = false }) {
  const finalConfig = { ...config };
  if (search && USE_SEARCH) finalConfig.tools = [{ googleSearch: {} }];

  let lastError;
  for (const model of MODELS) {
    if (Date.now() < (exhaustedUntil.get(model) || 0)) continue;
    try {
      return await ai.models.generateContent({ model, contents, config: finalConfig });
    } catch (error) {
      lastError = error;
      if (!RETRYABLE.test(String(error.message))) throw error;
      exhaustedUntil.set(model, Date.now() + COOLDOWN_MS);
      console.warn(`Aviso: modelo '${model}' no disponible (cuota o servicio), probando el siguiente.`);
    }
  }
  throw lastError || new Error('Todos los modelos de Gemini están agotados o no disponibles.');
}

module.exports = { generateContent, MODELS, USE_SEARCH };
