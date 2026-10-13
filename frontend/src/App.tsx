import { useEffect, useState } from 'react'
import { fileToBase64, processCase } from './api'
import { Chat } from './components/Chat'
import { MapView } from './components/MapView'
import type { CaseResult } from './types'
import './index.css'

const STEPS = [
  'Agente 1: analizando texto e imagen',
  'Consultando datos propios de servicios',
  'Geolocalizando con OpenStreetMap',
  'Registrando acción y trazabilidad',
]
const HISTORY_KEY = 'um-history'
const THEME_KEY = 'um-theme'

interface HistoryItem {
  at: string
  text: string
  result: CaseResult
}

function loadHistory(): HistoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
  } catch {
    return []
  }
}

const EXAMPLES = [
  'Hay un hueco enorme en la vía y es peligroso para motos',
  'El semáforo de la esquina lleva días sin funcionar',
  'La luminaria del parque está apagada y la zona es insegura',
]

export default function App() {
  const [text, setText] = useState('')
  const [origin, setOrigin] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<CaseResult | null>(null)
  const [step, setStep] = useState(0)
  const [copied, setCopied] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory)
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem(THEME_KEY)
    return saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    if (!loading) return
    setStep(0)
    const id = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 1400)
    return () => clearInterval(id)
  }, [loading])

  const copySummary = async () => {
    if (!result) return
    const txt = [
      `Caso #${result.case_id} - ${result.analysis.category} (urgencia ${result.analysis.urgency_level})`,
      result.analysis.summary,
      ...result.recommendations,
      `Acción: ${result.action_result}`,
    ].join('\n')
    try {
      await navigator.clipboard.writeText(txt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('No se pudo copiar al portapapeles.')
    }
  }

  useEffect(() => {
    if (!file) return setPreviewUrl('')
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const image_base64 = file ? await fileToBase64(file) : undefined
      const r = await processCase({ user_text: text, origin_location: origin, image_base64 })
      setResult(r)
      const next = [{ at: new Date().toISOString(), text, result: r }, ...history].slice(0, 8)
      setHistory(next)
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      } catch {
        /* almacenamiento lleno: se ignora */
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const urgency = result?.analysis.urgency_level.toLowerCase() ?? ''

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-row">
          <div className="brand">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
            Urban Mobility
          </div>
          <button type="button" className="theme-btn" onClick={() => setDark((d) => !d)}>
            {dark ? '☀ Claro' : '☾ Oscuro'}
          </button>
          </div>
          <h1>Movilidad y servicios urbanos inteligentes</h1>
          <p>Describe tu necesidad, adjunta una foto y recibe análisis, entidad responsable y ubicación en el mapa.</p>
        </div>
      </header>

      <div className="layout">
        <form className="card fields" onSubmit={submit}>
          <h2><span className="dot" />Nuevo caso</h2>

          <label className="field">
            <span>Describe tu caso</span>
            <textarea required value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Cuéntanos qué ocurre…" />
            <div className="chips">
              {EXAMPLES.map((ex) => (
                <button type="button" key={ex} className="chip" onClick={() => setText(ex)}>
                  {ex.length > 34 ? ex.slice(0, 34) + '…' : ex}
                </button>
              ))}
            </div>
          </label>

          <label className="field">
            <span>Ubicación</span>
            <input type="text" required value={origin} onChange={(e) => setOrigin(e.target.value)}
              placeholder="Ej.: Carrera 7 con calle 72, Bogotá" />
          </label>

          <div className="field">
            <span>Imagen <small>(opcional, JPG o PNG)</small></span>
            {file ? (
              <div className="preview">
                <img src={previewUrl} alt="Vista previa" />
                <small>{file.name}</small>
                <button type="button" className="ghost" onClick={() => setFile(null)}>Quitar</button>
              </div>
            ) : (
              <div className="dropzone">
                Haz clic o arrastra una imagen aquí
                <input type="file" accept="image/jpeg,image/png"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
            )}
          </div>

          <button disabled={loading}>
            {loading && <span className="spinner" />}
            {loading ? 'Analizando caso…' : 'Enviar caso'}
          </button>
        </form>

        {history.length > 0 && (
          <section className="card history-card" style={{ gridColumn: 1 }}>
            <h2><span className="dot" />Casos recientes</h2>
            <div className="history">
              {history.map((h) => (
                <button type="button" key={h.at} onClick={() => { setResult(h.result); setError('') }}>
                  <b>#{h.result.case_id} · {h.text}</b>
                  <span>{new Date(h.at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="stack">
          {error && <div className="alert" role="alert">{error}</div>}

          {loading && (
            <div className="card fade">
              <h2><span className="dot" />Procesando tu caso</h2>
              <ol className="steps">
                {STEPS.map((t, i) => (
                  <li key={t} className={i < step ? 'done' : i === step ? 'active' : ''}>
                    <i>{i < step ? '✓' : ''}</i>{t}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {!result && !error && !loading && (
            <div className="card empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z" /><path d="M9 3v15M15 6v15" />
              </svg>
              <p>Aquí aparecerán el análisis, las recomendaciones y el mapa.</p>
            </div>
          )}

          {result && !loading && (
            <>
              <section className="card fade">
                <div className="head">
                  <h2><span className="dot" />Análisis del caso #{result.case_id}</h2>
                  <button type="button" onClick={copySummary}>{copied ? '¡Copiado!' : 'Copiar resumen'}</button>
                </div>
                <div className="badges">
                  <span className="badge">{result.analysis.category}</span>
                  <span className={`badge ${urgency}`}>Urgencia {result.analysis.urgency_level}</span>
                </div>
                <p className="summary">{result.analysis.summary}</p>
                {!result.analysis.is_valid_case && result.analysis.missing_info_reason && (
                  <div className="alert" style={{ marginTop: '.9rem' }}>{result.analysis.missing_info_reason}</div>
                )}
              </section>

              {result.recommendations.length > 0 && (
                <section className="card">
                  <h2><span className="dot" />Recomendaciones</h2>
                  <ul className="reco">{result.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  <p className="action"><strong>Acción ejecutada:</strong> {result.action_result}</p>
                  {result.services.length > 0 && (
                    <div className="services">
                      {result.services.map((s) => (
                        <div className="service" key={s.name}>
                          <strong>{s.name}</strong>
                          <span>{s.status} · {s.contact}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {result.location && (
                <section className="card">
                  <h2><span className="dot" />Ubicación</h2>
                  <MapView location={result.location} />
                </section>
              )}

              <Chat caseId={result.case_id} />

              <details className="card">
                <summary>Trazabilidad de agentes</summary>
                <ol className="trace">{result.trace.map((t, i) => <li key={i}>{t}</li>)}</ol>
              </details>
            </>
          )}
        </div>
      </div>

      <footer>Urban Mobility · Solución multimodal con agentes de IA</footer>
    </>
  )
}
