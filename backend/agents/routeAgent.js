// Agente 3: Planificador de Rutas y Alertas.
// Responsabilidad: calcular la mejor ruta evitando novedades activas y emitir alertas.
const { getGeolocationData } = require('../services/geolocation');
const { getBestRoute } = require('../services/routing');

const NAME = 'Agente 3 (Planificador de Rutas)';

const routeAgent = {
  name: NAME,
  responsibility: 'Calcular la mejor ruta hacia el destino considerando novedades viales activas y generar alertas.',
  inputs: ['ubicación de la novedad y entidad (del Agente 2)', 'start_location (opcional)', 'destination_location (opcional)', 'novedades activas'],
  tools: ['geolocalizacion (partida y destino)', 'calcular_ruta (OSRM)'],
  outputs: ['route (mejor ruta, alternativas, alertas)', 'start_point', 'recommendations'],

  async run({ analysis, incident, services, isRoadIncident, startLocation, destinationLocation, activeIncidents }, trace) {
    trace.log({ agent: NAME, message: `${NAME}: evaluando rutas y novedades en la vía.` });
    const recommendations = [];

    // Destino: el indicado por el usuario; si no hay, el servicio asignado (solo si no es una novedad vial)
    let destination = null;
    if (destinationLocation) {
      const destGeo = await getGeolocationData(destinationLocation);
      destination = { name: destinationLocation, lat: destGeo.lat, lon: destGeo.lon };
      trace.log({ agent: NAME, kind: 'tool', tool: 'geolocalizacion', input: destinationLocation, output: destination, message: `${NAME}: destino '${destinationLocation}' geolocalizado.` });
    } else if (!isRoadIncident) {
      destination = { name: services[0].name, lat: services[0].lat, lon: services[0].lon };
      trace.log({ agent: NAME, message: `${NAME}: sin destino indicado; se usa la entidad asignada (${destination.name}).` });
    }

    const incidentsNearby = [...activeIncidents];
    if (isRoadIncident) {
      incidentsNearby.push({ id: 'nuevo', lat: incident.lat, lon: incident.lon, summary: analysis.summary });
    }
    trace.log({ agent: NAME, message: `${NAME}: ${incidentsNearby.length} novedad(es) activa(s) consideradas en el cálculo.` });

    if (!destination) {
      recommendations.push('Indique su destino para recomendarle la mejor ruta y alertarle de novedades en el camino.');
      trace.log({ agent: NAME, message: `${NAME}: sin destino; se solicita al usuario para calcular rutas.` });
      recommendations.push('Nota: los tiempos no incluyen tráfico en vivo; los retrasos se estiman a partir de las novedades reportadas en el sistema.');
      return { route: null, startPoint: null, recommendations };
    }

    let route = null;
    let startPoint = null;
    try {
      // El recorrido parte del punto de partida indicado; si no hay, desde la ubicación de la novedad
      if (startLocation) {
        const startGeo = await getGeolocationData(startLocation);
        startPoint = { name: startLocation, lat: startGeo.lat, lon: startGeo.lon };
        trace.log({ agent: NAME, kind: 'tool', tool: 'geolocalizacion', input: startLocation, output: startPoint, message: `${NAME}: punto de partida '${startLocation}' geolocalizado.` });
      } else {
        startPoint = { name: incident.display_name, lat: incident.lat, lon: incident.lon };
        trace.log({ agent: NAME, message: `${NAME}: sin punto de partida; se usa la ubicación de la novedad como inicio del recorrido.` });
      }

      route = { ...(await getBestRoute(startPoint, destination, incidentsNearby)), origin: startPoint, destination };
      trace.log({ agent: NAME, kind: 'tool', tool: 'calcular_ruta', input: { desde: startPoint.name, hacia: destination.name }, output: { mejor: route.best.name, minutos: route.best.duration_min, fuente: route.best.source }, message: `${NAME}: servicio de rutas (${route.best.source}). Opciones: ${route.alternatives.map((a) => `${a.name} ~${a.duration_min} min`).join(', ')}.` });

      recommendations.push(`Mejor ruta hacia ${destination.name}: ${route.best.name}, ${route.best.distance_km} km, ~${route.best.duration_min} min${route.best.via.length ? ` (por ${route.best.via.slice(0, 3).join(' → ')})` : ''}.`);
      recommendations.push(...route.alerts);
      route.alerts.forEach((a) => trace.log({ agent: NAME, output: a, message: `${NAME}: alerta emitida: ${a}` }));
    } catch (routeError) {
      trace.log({ agent: NAME, kind: 'tool', tool: 'calcular_ruta', output: routeError.message, message: `${NAME}: no fue posible calcular la ruta (${routeError.message}).` });
    }

    recommendations.push('Nota: los tiempos no incluyen tráfico en vivo; los retrasos se estiman a partir de las novedades reportadas en el sistema.');
    return { route, startPoint, recommendations };
  }
};

module.exports = { routeAgent };
