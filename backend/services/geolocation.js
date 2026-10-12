// Servicio externo de mapas o geolocalización
async function getGeolocationData(locationName) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationName)}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'UrbanMobilityApp-StudentProject' }
    });
    
    const data = await response.json();
    if (data && data.length > 0) {
      return {
        lat: Number.parseFloat(data[0].lat),
        lon: Number.parseFloat(data[0].lon),
        display_name: data[0].display_name,
        source: "OpenStreetMap Nominatim",
        status: "success"
      };
    }
  } catch (error) {
    console.error("Error al consultar geolocalización externa:", error);
  }

  return {
    lat: Number.parseFloat("4.6097"),
    lon: Number.parseFloat("-74.0817"),
    display_name: locationName || "Ubicación genérica urbana",
    source: "Fallback Mock Geolocation",
    status: "simulated"
  };
}

module.exports = { getGeolocationData };