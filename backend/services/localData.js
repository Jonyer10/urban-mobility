// Servicio de datos propios de la aplicación.
// Para agregar servicios: añade una categoría (en minúsculas) o un objeto a una existente.
// Cada servicio necesita name, status, contact, lat y lon (usados por el Agente 3 para calcular rutas).
const urbanDatabase = {
  "movilidad": [
    { name: "Estación de Movilidad Sostenible Norte", status: "Operativo", contact: "linea-norte@urban.gov", lat: 4.7110, lon: -74.0721 },
    { name: "Centro de Gestión de Tráfico Vial", status: "24/7", contact: "trafico@urban.gov", lat: 4.6486, lon: -74.1070 }
  ],
  "infraestructura": [
    { name: "Cuadrilla de Mantenimiento Vial Zona Centro", status: "Activo", contact: "vias@urban.gov", lat: 4.5981, lon: -74.0760 },
    { name: "Reporte de Iluminación Pública Municipal", status: "Abierto", contact: "luz@urban.gov", lat: 4.6280, lon: -74.0650 }
  ],
  "seguridad": [
    { name: "Estación de Policía Metropolitana Central", status: "24/7", contact: "seguridad@urban.gov", lat: 4.6020, lon: -74.0700 }
  ],
  "salud": [
    { name: "Centro de Atención Médica de Urgencias", status: "24/7", contact: "salud@urban.gov", lat: 4.6350, lon: -74.0830 }
  ],
  "ambiente": [
    { name: "Unidad de Gestión Ambiental y Residuos", status: "Disponible", contact: "ambiente@urban.gov", lat: 4.6700, lon: -74.0950 }
  ]
};

const DEFAULT_SERVICES = [
  { name: "Módulo General de Atención Ciudadana", status: "Disponible", contact: "atencion@urban.gov", lat: 4.6097, lon: -74.0817 }
];

function searchLocalServices(category) {
  const key = category ? category.toLowerCase() : "";
  for (const cat in urbanDatabase) {
    if (key.includes(cat)) {
      return urbanDatabase[cat];
    }
  }
  return DEFAULT_SERVICES;
}

module.exports = { searchLocalServices, urbanDatabase, DEFAULT_SERVICES };