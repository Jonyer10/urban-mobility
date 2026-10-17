import { ArrowRight, CheckCircle2, Clock, Flag, MapPin, Route as RouteIcon, TriangleAlert } from 'lucide-react'
import type { RouteOption, RouteResult } from '../types'
import './panels.css'

interface RowProps {
  r: RouteOption
  best?: boolean
  selected: boolean
  dimmed: boolean
  onSelect: () => void
}

function RouteRow({ r, best, selected, dimmed, onSelect }: RowProps) {
  return (
    <button type="button" aria-pressed={selected} onClick={onSelect}
      className={`route-row${best ? ' best' : ''}${selected ? ' sel' : ''}${dimmed ? ' dim' : ''}`}>
      <div className="route-head">
        <strong>{r.name}</strong>
        {best && <span className="badge bajo">Recomendada</span>}
      </div>
      <div className="route-meta">
        <span><RouteIcon size={13} /> {r.distance_km} km</span>
        <span><Clock size={13} /> ~{r.duration_min} min</span>
        {r.via.length > 0 && <span>vía {r.via.slice(0, 3).join(', ')}</span>}
      </div>
      {r.incidents_on_route.length > 0 ? (
        <ul className="route-inc">
          {r.incidents_on_route.map((i) => <li key={i.id}><TriangleAlert size={14} /> {i.summary}</li>)}
        </ul>
      ) : (
        <small className="ok"><CheckCircle2 size={14} /> Sin novedades activas en este trayecto</small>
      )}
      {!selected && <small className="route-hint">Clic para ver en el mapa</small>}
    </button>
  )
}

export function RoutePanel({ route, selected, onSelect }: { route: RouteResult; selected?: string; onSelect?: (name: string) => void }) {
  const active = selected ?? route.best.name
  const others = route.alternatives.filter((a) => a.name !== route.best.name)
  return (
    <section className="card fade">
      <h2><span className="dot" />Ruta y alertas</h2>
      {route.alerts.length > 0 && (
        <ul className="alerts">
          {route.alerts.map((a, i) => <li key={i}><TriangleAlert size={16} /><span>{a}</span></li>)}
        </ul>
      )}
      <p className="route-trip">
        <MapPin size={15} /> {route.origin?.name ?? 'Partida'} <ArrowRight size={14} /> <Flag size={15} /> {route.destination?.name ?? 'Destino'}
      </p>
      <RouteRow r={route.best} best selected={active === route.best.name} dimmed={active !== route.best.name} onSelect={() => onSelect?.(route.best.name)} />
      {others.length > 0 && (
        <>
          <h3 className="sub">Alternativas</h3>
          {others.map((a) => <RouteRow key={a.name} r={a} selected={active === a.name} dimmed={active !== a.name} onSelect={() => onSelect?.(a.name)} />)}
        </>
      )}
    </section>
  )
}
