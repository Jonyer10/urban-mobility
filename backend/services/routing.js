// Servicio de rutas: OSRM público (sin tráfico en vivo) + novedades reportadas por los ciudadanos.
const { cacheGet, cacheSet } = require('./db');

const ROUTE_TTL_MS = 15 * 60 * 1000;
const INCIDENT_RADIUS_M = 250;
const DELAY_PER_INCIDENT_MIN = 6; // Estimación: el servicio público no entrega tráfico en tiempo real

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

// Distancia mínima (metros) de un punto a una polilínea GeoJSON [[lon, lat], ...]
function distanceToPolylineM(point, coords) {
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((point.lat * Math.PI) / 180);
  const toXY = ([lon, lat]) => [(lon - point.lon) * mPerDegLon, (lat - point.lat) * mPerDegLat];
  let min = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = toXY(coords[i]);
    const [bx, by] = toXY(coords[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    min = Math.min(min, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return min;
}

function summarizeSteps(route) {
  const names = [];
  for (const step of route.legs[0].steps) {
    if (step.name && names.at(-1) !== step.name) names.push(step.name);
  }
  return names.slice(0, 8);
}

async function fetchOsrmRoutes(from, to) {
  // Se cachea solo la respuesta de OSRM; las novedades se evalúan siempre con datos frescos
  const cacheKey = `route:${from.lat.toFixed(4)},${from.lon.toFixed(4)}>${to.lat.toFixed(4)},${to.lon.toFixed(4)}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?alternatives=true&overview=full&geometries=geojson&steps=true`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const data = await response.json();
  if (data.code !== 'Ok' || !data.routes?.length) {
    throw new Error('OSRM sin ruta');
  }
  cacheSet(cacheKey, data.routes, ROUTE_TTL_MS);
  return data.routes;
}

// Evalúa rutas alternativas y las penaliza si pasan cerca de novedades activas.
// incidents: [{ id, lat, lon, summary }]
async function getBestRoute(origin, destination, incidents = []) {
  let candidates;
  try {
    const osrmRoutes = await fetchOsrmRoutes(origin, destination);
    candidates = osrmRoutes.map((r, i) => {
      const affecting = incidents.filter(
        (inc) => distanceToPolylineM(inc, r.geometry.coordinates) <= INCIDENT_RADIUS_M
      );
      const baseMin = Math.round(r.duration / 60);
      return {
        name: i === 0 ? 'Ruta principal' : `Alternativa ${i}`,
        distance_km: Number((r.distance / 1000).toFixed(2)),
        base_duration_min: baseMin,
        duration_min: baseMin + affecting.length * DELAY_PER_INCIDENT_MIN,
        via: summarizeSteps(r),
        incidents_on_route: affecting.map((inc) => ({ id: inc.id, summary: inc.summary })),
        source: 'OSRM'
      };
    });
  } catch (error) {
    console.warn('Aviso: ruta no disponible vía OSRM:', error.message);
    const km = haversineKm(origin.lat, origin.lon, destination.lat, destination.lon);
    candidates = [{
      name: 'Ruta estimada',
      distance_km: Number(km.toFixed(2)),
      base_duration_min: Math.round((km / 25) * 60),
      duration_min: Math.round((km / 25) * 60),
      via: [],
      incidents_on_route: [],
      source: 'Estimación en línea recta (sin servicio de rutas)'
    }];
  }

  const best = candidates.reduce((a, b) => (b.duration_min < a.duration_min ? b : a));
  const alerts = [];
  const main = candidates[0];
  if (main.incidents_on_route.length > 0) {
    alerts.push(
      `La ruta principal pasa cerca de ${main.incidents_on_route.length} novedad(es) reportada(s): ${main.incidents_on_route.map((i) => i.summary).join('; ')}. Retraso estimado: ~${main.incidents_on_route.length * DELAY_PER_INCIDENT_MIN} min.`
    );
  }
  if (best !== main) {
    alerts.push(
      `Se recomienda la ${best.name} (${best.via.slice(0, 3).join(' → ')}): ~${best.duration_min} min frente a ~${main.duration_min} min por la ruta principal.`
    );
  }

  return { best, alternatives: candidates, alerts };
}

module.exports = { getBestRoute };
