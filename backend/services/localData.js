// Servicio de datos propios: consulta el catálogo de entidades guardado en la tabla `services` de SQLite.
// Para agregar o editar servicios, modifica esa tabla (la carga inicial viene de seeds/services.json).
const { listServices } = require('./db');

function searchLocalServices(category) {
  const key = category ? category.toLowerCase() : '';
  const all = listServices();
  const matches = all.filter((s) => s.category !== 'general' && key.includes(s.category));
  if (matches.length) return matches;
  return all.filter((s) => s.category === 'general');
}

module.exports = { searchLocalServices };