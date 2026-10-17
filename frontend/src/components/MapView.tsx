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

export function MapView({ location, route }: { location: CaseLocation; route?: RouteResult | null }) {
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
      route.alternatives.forEach((alt) => {
        if (alt.geometry && alt.name !== route.best.name) {
          L.polyline(toLatLng(alt.geometry), { color: '#94a3b8', weight: 4, opacity: 0.7, dashArray: '6 8' })
            .addTo(map)
            .bindTooltip(`${alt.name} · ~${alt.duration_min} min`)
        }
      })
      if (route.best.geometry) {
        const line = L.polyline(toLatLng(route.best.geometry), { color: '#6366f1', weight: 6 })
          .addTo(map)
          .bindTooltip(`${route.best.name} · ~${route.best.duration_min} min`)
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
  }, [location, route])

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
