import type { TraceEvent } from '../types'

const KIND_LABEL: Record<TraceEvent['kind'], string> = {
  agent: 'Agente',
  tool: 'Herramienta',
  action: 'Acción',
}

// "Agente 2 (Especialista de Ubicación)" -> "Agente 2"
const shortAgent = (name: string) => name.split(' (')[0]

export function TracePanel({ events, fallback }: { events?: TraceEvent[]; fallback: string[] }) {
  // Casos creados antes de la trazabilidad estructurada solo tienen frases
  if (!events?.length) {
    return <ol className="trace">{fallback.map((t, i) => <li key={i}>{t}</li>)}</ol>
  }

  return (
    <ol className="trace">
      {events.map((e, i) => (
        <li key={i} className={`ev ${e.kind}`}>
          <div className="ev-tags">
            <span className="tag agent-tag" title={e.agent}>{shortAgent(e.agent)}</span>
            {e.tool && <span className={`tag ${e.kind}`}>{e.tool}</span>}
            <span className="tag kind">{KIND_LABEL[e.kind]}</span>
            <time>{new Date(e.at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
          </div>
          <p>{e.message.replace(/^[^:]+:\s*/, '')}</p>
          {(e.input || e.output) && (
            <details className="ev-io">
              <summary>Entrada y salida</summary>
              {e.input && <pre><b>Entrada:</b> {e.input}</pre>}
              {e.output && <pre><b>Salida:</b> {e.output}</pre>}
            </details>
          )}
        </li>
      ))}
    </ol>
  )
}
