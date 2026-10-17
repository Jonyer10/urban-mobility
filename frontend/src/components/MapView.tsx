import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { CaseLocation, RouteResult } from '../types'

const pin = (color: string) =>
  L.divIcon({
    className: '',
    html: `<span style="display:block;width:16px;height:16px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.6)"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })

interface Props {
  location: CaseLocation
  route?: RouteResult | null
  selected?: string
  onSelect?: (name: string) => void
}

export function MapView({ location, route, selected, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!el.current) return
    const map = L.map(el.current).setView([location.lat, location.lon], 15)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map)

    L.marker([location.lat, location.lon], { icon: pin('#f59e0b') }).addTo(map).bindPopup('Novedad')
    const bounds = L.latLngBounds([[location.lat, location.lon]])

    if (route) {
      if (route.origin) {
        L.marker([route.origin.lat, route.origin.lon], { icon: pin('#16a34a') })
          .addTo(map)
          .bindPopup(`Partida: ${route.origin.name}`)
        bounds.extend([route.origin.lat, route.origin.lon])
      }
      const toLatLng = (g: [number, number][]) => g.map(([lon, lat]) => [lat, lon] as [number, number])
      const active = selected ?? route.best.name
      const options = [route.best, ...route.alternatives.filter((a) => a.name !== route.best.name)].filter((o) => o.geometry)

      // Primero las rutas no seleccionadas (atenuadas, clicables) y encima la seleccionada
      options.filter((o) => o.name !== active).forEach((o) => {
        L.polyline(toLatLng(o.geometry!), { color: '#94a3b8', weight: 5, opacity: 0.45, dashArray: '8 10' })
          .addTo(map)
          .bindTooltip(`${o.name} · ~${o.duration_min} min (clic para ver)`, { sticky: true })
          .on('click', () => onSelect?.(o.name))
      })
      const chosen = options.find((o) => o.name === active)
      if (chosen) {
        L.polyline(toLatLng(chosen.geometry!), { color: '#ffffff', weight: 11, opacity: 0.9 }).addTo(map)
        const line = L.polyline(toLatLng(chosen.geometry!), { color: '#4f46e5', weight: 7 })
          .addTo(map)
          .bindTooltip(`${chosen.name} · ~${chosen.duration_min} min`, { sticky: true })
        bounds.extend(line.getBounds())
      }
      if (route.destination) {
        L.marker([route.destination.lat, route.destination.lon], { icon: pin('#dc2626') })
          .addTo(map)
          .bindPopup(`Destino: ${route.destination.name}`)
        bounds.extend([route.destination.lat, route.destination.lon])
      }
    }

    if (bounds.getNorthEast().distanceTo(bounds.getSouthWest()) > 0) {
      map.fitBounds(bounds, { padding: [30, 30] })
    }
    return () => {
      map.remove()
    }
  }, [location, route, selected, onSelect])

  return (
    <div className="map">
      <div ref={el} className="map-canvas" />
      <small>
        <span className="lg" style={{ background: '#f59e0b' }} />Novedad
        {route && <><span className="lg" style={{ background: '#16a34a' }} />Partida<span className="lg" style={{ background: '#dc2626' }} />Destino</>}
      </small>
      <small>
        Novedad: {location.display_name} ({location.lat.toFixed(4)}, {location.lon.toFixed(4)}) · {location.source}
      </small>
      {route && (
        <small>
          Ruta de {route.origin?.name ?? 'partida'} a {route.destination?.name ?? 'destino'}: {route.best.name}, {route.best.distance_km} km, ~{route.best.duration_min} min
        </small>
      )}
    </div>
  )
}
