// Servicio externo de geolocalización (OpenStreetMap Nominatim) con caché en base de datos.
// Mejoras: sesgo a Colombia/ciudad, resolución de intersecciones ("Calle 85 con Carrera 11"),
// respeto del límite de 1 petición/segundo y varios intentos antes de usar coordenadas de respaldo.
const { cacheGet, cacheSet, normalizeKey } = require('./db');

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const GEO_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = 1100;
const MAX_INTERSECTION_GAP_M = 300;
const DEFAULT_CITY = process.env.DEFAULT_CITY || 'Bogotá';
// Caja aproximada de Bogotá (izquierda, arriba, derecha, abajo); sesga los resultados hacia la ciudad
const VIEWBOX = process.env.GEO_VIEWBOX || '-74.25,4.84,-73.99,4.45';
const FALLBACK = { lat: 4.6097, lon: -74.0817 };

let lastCallAt = 0;
let queue = Promise.resolve();

// Cola serial para no superar 1 petición por segundo (política de uso de Nominatim)
function nominatim(params) {
  const run = async () => {
    const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
    const query = new URLSearchParams({ format: 'jsonv2', countrycodes: 'co', 'accept-language': 'es', ...params });
    const response = await fetch(`${NOMINATIM_URL}?${query}`, {
      headers: { 'User-Agent': 'UrbanMobilityApp-StudentProject' },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
    return response.json();
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

function withCity(text) {
  return normalizeKey(text).includes(normalizeKey(DEFAULT_CITY)) ? text : `${text}, ${DEFAULT_CITY}`;
}

function toResult(item) {
  return {
    lat: Number.parseFloat(item.lat),
    lon: Number.parseFloat(item.lon),
    display_name: item.display_name,
    source: 'OpenStreetMap Nominatim',
    status: 'success'
  };
}

// Interpola puntos cada ~20 m: las vías rectas tienen pocos vértices y falsearían la distancia entre vías
function densify(coords, stepM = 20) {
  const mLat = 111320;
  const mLon = 111320 * Math.cos((FALLBACK.lat * Math.PI) / 180);
  const out = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = coords[i];
    const [bx, by] = coords[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot((bx - ax) * mLon, (by - ay) * mLat) / stepM));
    for (let s = 0; s < steps; s++) out.push([ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps]);
  }
  if (coords.length) out.push(coords.at(-1));
  return out;
}

// Puntos [lon, lat] de la geometría GeoJSON de un resultado
function geometryPoints(item) {
  const g = item.geojson;
  if (!g) return [[Number(item.lon), Number(item.lat)]];
  switch (g.type) {
    case 'Point': return [g.coordinates];
    case 'LineString': return densify(g.coordinates);
    case 'MultiLineString': return g.coordinates.flatMap((line) => densify(line));
    case 'Polygon': return densify(g.coordinates[0]);
    default: return [[Number(item.lon), Number(item.lat)]];
  }
}

// Par de vértices más cercano entre dos vías (aproximación plana, suficiente a escala urbana)
function closestPair(pointsA, pointsB) {
  const mLat = 111320;
  const mLon = 111320 * Math.cos((FALLBACK.lat * Math.PI) / 180);
  let best = { d: Infinity };
  for (const [ax, ay] of pointsA) {
    for (const [bx, by] of pointsB) {
      const d = Math.hypot((ax - bx) * mLon, (ay - by) * mLat);
      if (d < best.d) best = { d, a: [ax, ay], b: [bx, by] };
    }
  }
  return best;
}

const INTERSECTION_RE = /^(.+?)\s+(?:con|y|&|x|esquina con|cruce con|cruzando con)\s+(.+)$/i;

const OVERPASS_URLS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const STREET_PREFIX = '(Avenida |Autopista |Av\\. |Diagonal |Transversal )?';
const OVERPASS_TIMEOUT_MS = 8000;
const OVERPASS_COOLDOWN_MS = 5 * 60 * 1000;
let overpassDisabledUntil = 0;

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&');

// Overpass devuelve directamente los nodos que comparten ambas vías (el cruce real en OSM)
async function overpassIntersection(streetA, streetB) {
  const [south, west, north, east] = [VIEWBOX.split(',')[3], VIEWBOX.split(',')[0], VIEWBOX.split(',')[1], VIEWBOX.split(',')[2]];
  const nameRe = (street) => `^${STREET_PREFIX}${escapeRegex(street)}( |$)`;
  const query = `[out:json][timeout:20];
way["highway"]["name"~"${nameRe(streetA)}",i](${south},${west},${north},${east})->.a;
way["highway"]["name"~"${nameRe(streetB)}",i](${south},${west},${north},${east})->.b;
node(w.a)(w.b);
out;`;

  if (Date.now() < overpassDisabledUntil) return null;

  for (const url of OVERPASS_URLS) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': 'UrbanMobilityApp-StudentProject', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS)
      });
      if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
      const { elements } = await response.json();
      if (!elements?.length) return null;
      // Si las vías se cruzan en varios puntos, se usa el más cercano al centro de los cruces
      const cLat = elements.reduce((s, n) => s + n.lat, 0) / elements.length;
      const cLon = elements.reduce((s, n) => s + n.lon, 0) / elements.length;
      const node = elements.reduce((a, b) => (Math.hypot(b.lat - cLat, b.lon - cLon) < Math.hypot(a.lat - cLat, a.lon - cLon) ? b : a));
      return { lat: node.lat, lon: node.lon, source: 'OpenStreetMap Overpass (cruce exacto)' };
    } catch (error) {
      console.warn(`Aviso: Overpass (${new URL(url).host}) no disponible:`, error.message);
    }
  }
  // Los servidores públicos de Overpass son inestables: se pausa para no frenar cada consulta
  overpassDisabledUntil = Date.now() + OVERPASS_COOLDOWN_MS;
  return null;
}

// En OSM muchas vías principales se llaman "Avenida Carrera 11", por eso se consultan ambas variantes.
async function fetchStreetSegments(street) {
  const variants = /^(avenida|av\.?|autopista|transversal|diagonal)\b/i.test(street) ? [street] : [street, `Avenida ${street}`];
  const segments = [];
  for (const variant of variants) {
    segments.push(...(await nominatim({ q: `${variant}, ${DEFAULT_CITY}`, limit: '40', polygon_geojson: '1', viewbox: VIEWBOX, bounded: '1' })));
  }
  return segments;
}

// "Calle 85 con Carrera 11" -> cruce de ambas vías (Overpass; respaldo: geometrías de Nominatim)
async function resolveIntersection(streetA, streetB) {
  const label = `${streetA} con ${streetB}, ${DEFAULT_CITY}`;

  const exact = await overpassIntersection(streetA, streetB);
  if (exact) return { ...exact, display_name: label, status: 'success' };

  const resultsA = await fetchStreetSegments(streetA);
  if (!resultsA.length) return null;
  const resultsB = await fetchStreetSegments(streetB);
  if (!resultsB.length) return null;

  const pair = closestPair(resultsA.flatMap(geometryPoints), resultsB.flatMap(geometryPoints));
  if (!Number.isFinite(pair.d) || pair.d > MAX_INTERSECTION_GAP_M) return null;

  return {
    lat: (pair.a[1] + pair.b[1]) / 2,
    lon: (pair.a[0] + pair.b[0]) / 2,
    display_name: label,
    source: 'OpenStreetMap Nominatim (intersección calculada)',
    status: 'success'
  };
}

async function geocode(locationName) {
  const text = locationName.trim();

  const match = INTERSECTION_RE.exec(text);
  if (match) {
    try {
      const cross = await resolveIntersection(match[1].trim(), match[2].trim());
      if (cross) return cross;
    } catch (error) {
      console.warn('Aviso: no se pudo calcular la intersección:', error.message);
    }
  }

  // Intentos en orden: texto completo con ciudad, texto original, primera vía de una intersección
  const attempts = [withCity(text), text];
  if (match) attempts.push(withCity(match[1].trim()));

  for (const q of [...new Set(attempts)]) {
    const data = await nominatim({ q, limit: '1', viewbox: VIEWBOX });
    if (data?.length) return toResult(data[0]);
  }
  return null;
}

async function getGeolocationData(locationName) {
  if (!locationName || !locationName.trim()) {
    return { ...FALLBACK, display_name: 'Ubicación genérica urbana', source: 'Fallback Mock Geolocation', status: 'simulated' };
  }

  const cacheKey = `geo:${normalizeKey(locationName)}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return { ...cached, source: `${cached.source} (caché)` };
  }

  try {
    const result = await geocode(locationName);
    if (result) {
      cacheSet(cacheKey, result, GEO_TTL_MS);
      return result;
    }
  } catch (error) {
    console.error('Error al consultar geolocalización externa:', error.message);
  }

  return {
    ...FALLBACK,
    display_name: locationName,
    source: 'Fallback Mock Geolocation',
    status: 'simulated'
  };
}

module.exports = { getGeolocationData };
