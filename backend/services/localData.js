// Servicio de datos propios de la aplicación
function searchLocalServices(category) {
  const urbanDatabase = {
    "movilidad": [
      { name: "Estación de Movilidad Sostenible Norte", status: "Operativo", contact: "linea-norte@urban.gov" },
      { name: "Centro de Gestión de Tráfico Vial", status: "24/7", contact: "trafico@urban.gov" }
    ],
    "infraestructura": [
      { name: "Cuadrilla de Mantenimiento Vial Zona Centro", status: "Activo", contact: "vias@urban.gov" },
      { name: "Reporte de Iluminación Pública Municipal", status: "Abierto", contact: "luz@urban.gov" }
    ]
  };

  const key = category ? category.toLowerCase() : "";
  for (const cat in urbanDatabase) {
    if (key.includes(cat)) {
      return urbanDatabase[cat];
    }
  }

  return [
    { name: "Módulo General de Atención Ciudadana", status: "Disponible", contact: "atencion@urban.gov" }
  ];
}

module.exports = { searchLocalServices };