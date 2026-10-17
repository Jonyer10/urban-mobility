// Agente 2: Especialista de Ubicación y Solución.
// Responsabilidad: ubicar la novedad, identificar la entidad responsable y ejecutar la acción de registro.
const { searchLocalServices } = require('../services/localData');
const { getGeolocationData } = require('../services/geolocation');

const NAME = 'Agente 2 (Especialista de Ubicación)';

const locationAgent = {
  name: NAME,
  responsibility: 'Ubicar la novedad, asignar la entidad responsable y definir la acción de registro del caso.',
  inputs: ['analysis (del Agente 1)', 'incident_location', 'destination_location (opcional)'],
  tools: ['buscar_servicios (datos propios)', 'geolocalizacion (OpenStreetMap Nominatim/Overpass)'],
  outputs: ['location', 'services', 'recommendations', 'action_result', 'is_road_incident'],

  async run({ analysis, incidentLocation, hasDestination }, trace) {
    trace.log({ agent: NAME, message: `${NAME}: seleccionando y ejecutando herramientas.` });

    const services = searchLocalServices(analysis.category);
    const entity = services[0];
    trace.log({ agent: NAME, kind: 'tool', tool: 'buscar_servicios', input: analysis.category, output: entity, message: `${NAME}: base de datos propia consultada. Entidad: ${entity.name}.` });

    const geo = await getGeolocationData(incidentLocation);
    trace.log({ agent: NAME, kind: 'tool', tool: 'geolocalizacion', input: incidentLocation, output: { lat: geo.lat, lon: geo.lon, source: geo.source }, message: `${NAME}: ubicación de la novedad geolocalizada (Lat ${geo.lat}, Lon ${geo.lon}) vía ${geo.source}.` });

    const isRoadIncident = analysis.affects_road === true;
    const recommendations = [];
    if (isRoadIncident) {
      recommendations.push(`Su reporte fue registrado y asignado a ${entity.name} (contacto de referencia: ${entity.contact}). No necesita desplazarse hasta allí.`);
    } else if (!hasDestination) {
      recommendations.push(`Derivar la solicitud al recurso propio: ${entity.name} (Contacto: ${entity.contact}).`);
    }
    recommendations.push(`Ubicación de la novedad geolocalizada en: ${geo.display_name}.`);

    const actionResult = `Caso registrado formalmente en el sistema con prioridad ${analysis.urgency_level} y asignado a ${entity.name}.`;
    trace.log({ agent: NAME, kind: 'action', tool: 'registrar_caso', input: { prioridad: analysis.urgency_level, entidad: entity.name }, output: actionResult, message: `${NAME}: acción ejecutada. ${actionResult}` });

    return {
      services,
      isRoadIncident,
      recommendations,
      actionResult,
      geo,
      location: { lat: geo.lat, lon: geo.lon, display_name: geo.display_name, source: geo.source }
    };
  }
};

module.exports = { locationAgent };
