// Utilidades de imágenes recibidas en base64 (sin prefijo data:)
function detectMime(b64 = '') {
  if (b64.startsWith('iVBOR')) return 'image/png';
  if (b64.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}

const sizeKb = (b64 = '') => Math.round((b64.length * 3) / 4 / 1024);

module.exports = { detectMime, sizeKb };
