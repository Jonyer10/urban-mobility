import { ArrowRight, CheckCircle2, Clock, Flag, MapPin, Route as RouteIcon, TriangleAlert } from 'lucide-react'
import type { RouteOption, RouteResult } from '../types'
import './panels.css'

function RouteRow({ r, best }: { r: RouteOption; best?: boolean }) {
  return (
    <div className={`route-row${best ? ' best' : ''}`}>
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
    </div>
  )
}

export function RoutePanel({ route }: { route: RouteResult }) {
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
      <RouteRow r={route.best} best />
      {others.length > 0 && (
        <>
          <h3 className="sub">Alternativas</h3>
          {others.map((a) => <RouteRow key={a.name} r={a} />)}
        </>
      )}
    </section>
  )
}
