import type { CaseLocation } from '../types'

export function MapView({ location }: { location: CaseLocation }) {
  const d = 0.01
  const bbox = [location.lon - d, location.lat - d, location.lon + d, location.lat + d].join(',')
  const src =
    `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}` +
    `&layer=mapnik&marker=${location.lat},${location.lon}`
  return (
    <div className="map">
      <iframe title="Mapa del caso" src={src} loading="lazy" />
      <small>
        {location.display_name} ({location.lat.toFixed(4)}, {location.lon.toFixed(4)}) · {location.source}
      </small>
    </div>
  )
}
