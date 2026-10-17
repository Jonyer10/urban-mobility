import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, ArrowLeft, ArrowRight, Brain, Camera, Check, Compass, Copy, Database, FileText,
  History, ImagePlus, ListTree, MapPin, MapPinned, MessageSquare, Moon, Plus, Route as RouteIcon,
  Search, Send, Sun, X,
} from 'lucide-react'
import { caseImageUrl, fileToBase64, getCase, listCases, processCase } from './api'
import { AgentsPanel } from './components/AgentsPanel'
import { Chat } from './components/Chat'
import { MapView } from './components/MapView'
import { RoutePanel } from './components/RoutePanel'
import { TracePanel } from './components/TracePanel'
import type { CaseResult, CaseSummary } from './types'
import './index.css'
import './components/panels.css'
import './app.css'

type View = 'form' | 'results' | 'history'
type Tab = 'summary' | 'map' | 'chat' | 'trace'

const PIPELINE = [
  { icon: Brain, label: 'Analizando', sub: 'Agente 1 · texto e imagen' },
  { icon: MapPin, label: 'Ubicando', sub: 'Agente 2 · entidad y mapa' },
  { icon: RouteIcon, label: 'Planeando ruta', sub: 'Agente 3 · rutas y alertas' },
  { icon: Database, label: 'Registrando', sub: 'Trazabilidad y base de datos' },
]
const WIZARD = ['Tu caso', 'Ubicación', 'Confirmar']
const THEME_KEY = 'um-theme'
const EXAMPLES = [
  'Hay un hueco enorme en la vía y es peligroso para motos',
  'El semáforo de la esquina lleva días sin funcionar',
  'La luminaria del parque está apagada y la zona es insegura',
]
const TABS = [
  { id: 'summary' as Tab, label: 'Resumen', icon: FileText },
  { id: 'map' as Tab, label: 'Mapa y ruta', icon: MapPinned },
  { id: 'chat' as Tab, label: 'Chat', icon: MessageSquare },
  { id: 'trace' as Tab, label: 'Trazabilidad', icon: ListTree },
]

export default function App() {
  const [view, setView] = useState<View>('form')
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState<'next' | 'back'>('next')
  const [tab, setTab] = useState<Tab>('summary')
  const [text, setText] = useState('')
  const [origin, setOrigin] = useState('')
  const [wantsRoute, setWantsRoute] = useState(false)
  const [start, setStart] = useState('')
  const [destination, setDestination] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [pipe, setPipe] = useState(0)
  const [error, setError] = useState('')
  const [result, setResult] = useState<CaseResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [filter, setFilter] = useState('')
  const [routeSel, setRouteSel] = useState<number | null>(null)
  const [altSel, setAltSel] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [history, setHistory] = useState<CaseSummary[]>([])
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
    setPipe(0)
    const id = setInterval(() => setPipe((s) => Math.min(s + 1, PIPELINE.length - 1)), 1500)
    return () => clearInterval(id)
  }, [loading])

  useEffect(() => {
    if (!file) return setPreviewUrl('')
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await listCases())
    } catch {
      /* sin conexión: se conserva el historial mostrado */
    }
  }, [])

  useEffect(() => {
    void refreshHistory()
  }, [refreshHistory])

  const go = (n: number) => {
    setDir(n > step ? 'next' : 'back')
    setStep(n)
  }

  const canNext = step === 0 ? text.trim().length >= 5 : step === 1 ? origin.trim().length > 0 : true

  const showResult = (r: CaseResult) => {
    setResult(r)
    setRouteSel(null)
    setAltSel(null)
    setTab('summary')
    setView('results')
  }

  const openCase = async (id: number) => {
    setError('')
    try {
      showResult(await getCase(id))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const newCase = () => {
    setText('')
    setOrigin('')
    setStart('')
    setDestination('')
    setWantsRoute(false)
    setFile(null)
    setStep(0)
    setError('')
    setView('form')
  }

  const submit = async () => {
    setLoading(true)
    setError('')
    try {
      const image_base64 = file ? await fileToBase64(file) : undefined
      const r = await processCase({
        user_text: text,
        incident_location: origin,
        start_location: wantsRoute ? start.trim() || undefined : undefined,
        destination_location: wantsRoute ? destination.trim() || undefined : undefined,
        image_base64,
      })
      showResult(r)
      void refreshHistory()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

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

  const urgency = result?.analysis.urgency_level.toLowerCase() ?? ''
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? history.filter((h) => `${h.user_text} ${h.incident_location} ${h.category ?? ''}`.toLowerCase().includes(q)) : history
  }, [history, filter])
  const tabIndex = TABS.findIndex((t) => t.id === tab)
  const routes = result?.route_history ?? []
  const activeRoute = routeSel !== null && routes[routeSel] ? routes[routeSel].route : result?.route
  const routeNames = activeRoute ? [activeRoute.best.name, ...activeRoute.alternatives.map((a) => a.name)] : []
  const selectedName = altSel && routeNames.includes(altSel) ? altSel : activeRoute?.best.name

  return (
    <>
      <header className="bar">
        <div className="bar-in">
          <div className="brand">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
            Urban Mobility
          </div>
          <nav className="nav" aria-label="Secciones">
            <button type="button" className={view === 'form' ? 'on' : ''} onClick={() => setView('form')}>Nuevo caso</button>
            {result && (
              <button type="button" className={view === 'results' ? 'on' : ''} onClick={() => setView('results')}>Resultado</button>
            )}
            <button type="button" className={view === 'history' ? 'on' : ''}
              onClick={() => { setView('history'); void refreshHistory() }}>
              Historial <span className="count">{history.length}</span>
            </button>
          </nav>
          <button type="button" className="theme-btn" onClick={() => setDark((d) => !d)} aria-label="Cambiar tema">
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      <main className="stage">
        {error && (
          <div className="alert pop" role="alert">
            <AlertCircle size={18} /><span>{error}</span>
            <button type="button" className="ghost" onClick={() => setError('')} aria-label="Cerrar"><X size={16} /></button>
          </div>
        )}

        {loading && (
          <section className="loader pop" aria-live="polite">
            <h2>Procesando tu caso</h2>
            <p>Los agentes están trabajando en tu solicitud…</p>
            <ol className="pipe">
              {PIPELINE.map((p, i) => (
                <li key={p.label} className={i < pipe ? 'done' : i === pipe ? 'active' : ''}>
                  <span className="node">{i < pipe ? <Check size={22} strokeWidth={3} /> : <p.icon size={24} />}</span>
                  <strong>{p.label}</strong>
                  <small>{p.sub}</small>
                </li>
              ))}
            </ol>
            <div className="bar-track"><i style={{ width: `${((pipe + 1) / PIPELINE.length) * 100}%` }} /></div>
          </section>
        )}

        {!loading && view === 'form' && (
          <section className="wiz pop">
            <div className="hero">
              <h1>Reporta una novedad urbana</h1>
              <p>Cuéntanos qué ocurre en tres pasos. Los agentes se encargan del resto.</p>
            </div>

            <ol className="stepper" aria-label="Progreso">
              {WIZARD.map((w, i) => (
                <li key={w} className={i < step ? 'done' : i === step ? 'on' : ''}>
                  <span>{i < step ? <Check size={16} strokeWidth={3} /> : i + 1}</span>{w}
                </li>
              ))}
              <i className="stepper-fill" style={{ width: `${(step / (WIZARD.length - 1)) * 100}%` }} />
            </ol>

            <form className="wiz-card" onSubmit={(e) => { e.preventDefault(); if (step < 2) { if (canNext) go(step + 1) } else void submit() }}>
              <div key={step} className={`pane ${dir}`}>
                {step === 0 && (
                  <>
                    <h2>¿Qué está pasando?</h2>
                    <label className="field">
                      <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canNext) go(1) }}
                        placeholder="Describe el problema con el mayor detalle posible…" />
                      <small className={text.trim().length >= 5 ? 'ok' : ''}>{text.trim().length < 5 ? `Escribe al menos 5 caracteres (${text.trim().length}/5)` : <><Check size={13} /> Listo</>}</small>
                    </label>
                    <div className="chips">
                      {EXAMPLES.map((ex) => (
                        <button type="button" key={ex} className="chip" onClick={() => setText(ex)}>
                          {ex.length > 36 ? ex.slice(0, 36) + '…' : ex}
                        </button>
                      ))}
                    </div>
                    <div className="field">
                      {file ? (
                        <div className="preview">
                          <img src={previewUrl} alt="Vista previa" />
                          <small>{file.name}</small>
                          <button type="button" className="ghost" onClick={() => setFile(null)}>Quitar</button>
                        </div>
                      ) : (
                        <div className={`dropzone${drag ? ' drag' : ''}`}
                          onDragEnter={() => setDrag(true)} onDragLeave={() => setDrag(false)} onDrop={() => setDrag(false)}>
                          <ImagePlus size={26} />
                          <span>Añade una foto o arrástrala aquí <small>(opcional · JPG o PNG)</small></span>
                          <input type="file" accept="image/jpeg,image/png"
                            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                        </div>
                      )}
                    </div>
                  </>
                )}

                {step === 1 && (
                  <>
                    <h2>¿Dónde ocurre?</h2>
                    <label className="field">
                      <span>Ubicación de la novedad</span>
                      <input type="text" autoFocus value={origin} onChange={(e) => setOrigin(e.target.value)}
                        placeholder="Ej.: Calle 77 con carrera 30, Bogotá" />
                    </label>
                    <label className="switch">
                      <input type="checkbox" checked={wantsRoute} onChange={(e) => setWantsRoute(e.target.checked)} />
                      <span className="knob" />
                      <span className="sw-text"><Compass size={18} /> Quiero planear una ruta evitando novedades</span>
                    </label>
                    <div className={`collapse ${wantsRoute ? 'open' : ''}`}>
                      <div className="collapse-in">
                        <label className="field">
                          <span>Punto de partida</span>
                          <input type="text" value={start} onChange={(e) => setStart(e.target.value)}
                            placeholder="Ej.: Portal de las Américas" />
                        </label>
                        <label className="field">
                          <span>Destino</span>
                          <input type="text" value={destination} onChange={(e) => setDestination(e.target.value)}
                            placeholder="Ej.: Calle 100 con Autopista Norte" />
                        </label>
                      </div>
                    </div>
                  </>
                )}

                {step === 2 && (
                  <>
                    <h2>Revisa y envía</h2>
                    <dl className="review">
                      <div><dt>Caso</dt><dd>{text}</dd><button type="button" className="ghost" onClick={() => go(0)}>Editar</button></div>
                      <div><dt>Ubicación</dt><dd>{origin}</dd><button type="button" className="ghost" onClick={() => go(1)}>Editar</button></div>
                      {wantsRoute && (start || destination) && (
                        <div><dt>Ruta</dt><dd>{start || 'Partida no indicada'} <ArrowRight size={13} className="inl" /> {destination || 'Destino no indicado'}</dd><button type="button" className="ghost" onClick={() => go(1)}>Editar</button></div>
                      )}
                      <div><dt>Foto</dt><dd>{file ? file.name : 'Sin imagen'}</dd><button type="button" className="ghost" onClick={() => go(0)}>Editar</button></div>
                    </dl>
                  </>
                )}
              </div>

              <div className="wiz-actions">
                {step > 0 ? <button type="button" className="secondary" onClick={() => go(step - 1)}><ArrowLeft size={16} /> Atrás</button> : <span />}
                <button type="submit" disabled={!canNext}>{step < 2 ? <>Continuar <ArrowRight size={16} /></> : <>Enviar caso <Send size={16} /></>}</button>
              </div>
            </form>
          </section>
        )}

        {!loading && view === 'history' && (
          <section className="hist pop">
            <div className="hist-head">
              <div>
                <h1>Casos guardados</h1>
                <p className="db-line"><Database size={15} /> Se almacenan en la base de datos SQLite: sobreviven al reinicio del servidor.</p>
              </div>
              <button type="button" className="secondary" onClick={() => void refreshHistory()}>Actualizar</button>
            </div>
            {history.length > 3 && (
              <label className="search"><Search size={16} />
                <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar por texto, lugar o categoría…" />
              </label>
            )}
            {shown.length === 0 ? (
              <div className="empty">{history.length === 0 ? 'Aún no hay casos guardados.' : 'Ningún caso coincide con tu búsqueda.'}</div>
            ) : (
              <ul className="hist-list reveal">
                {shown.map((h) => (
                  <li key={h.id}>
                    <button type="button" onClick={() => void openCase(h.id)}>
                      <span className="hid">#{h.id}</span>
                      <span className="htxt"><b>{h.user_text}</b><small>{h.incident_location}</small></span>
                      <span className="hmeta">
                        {h.category && <i className="badge">{h.category}</i>}
                        {h.urgency_level && <i className={`badge ${h.urgency_level.toLowerCase()}`}>{h.urgency_level}</i>}
                        <em>{new Date(h.created_at).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</em>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {!loading && view === 'results' && result && (
          <section className="dash pop">
            <div className="kpis reveal">
              <div className="kpi"><small>Caso</small><strong>#{result.case_id} <span className="saved" title="Guardado en SQLite"><Database size={14} /></span></strong></div>
              <div className="kpi"><small>Categoría</small><strong>{result.analysis.category}</strong></div>
              <div className={`kpi ${urgency}`}><small>Urgencia</small><strong>{result.analysis.urgency_level}</strong></div>
              <div className="kpi grow"><small>Entidad asignada</small><strong>{result.services[0]?.name ?? '—'}</strong></div>
              <div className="kpi"><small>Ruta</small><strong>{result.route ? `${result.route.best.duration_min} min · ${result.route.best.distance_km} km` : 'Sin destino'}</strong></div>
            </div>

            <div className="dtabs" role="tablist" style={{ ['--i' as string]: tabIndex }}>
              {TABS.map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                  <t.icon size={16} />{t.label}
                </button>
              ))}
              <i className="ink" />
            </div>

            <div className="panel">
              {tab === 'summary' && (
                <div className="grid2 reveal">
                  <div className="card">
                    <div className="head">
                      <h2><span className="dot" />Análisis</h2>
                      <button type="button" onClick={copySummary}>{copied ? <><Check size={15} /> Copiado</> : <><Copy size={15} /> Copiar resumen</>}</button>
                    </div>
                    <p className="summary">{result.analysis.summary}</p>
                    {result.has_image && (
                      <figure className="evidence">
                        <a href={caseImageUrl(result.case_id)} target="_blank" rel="noreferrer" title="Abrir imagen completa">
                          <img src={caseImageUrl(result.case_id)} alt="Imagen adjunta del caso" />
                        </a>
                        <figcaption>
                          <b><Camera size={14} /> Evidencia adjunta</b>
                          {result.analysis.image_description && <span>{result.analysis.image_description}</span>}
                        </figcaption>
                      </figure>
                    )}
                    {!result.analysis.is_valid_case && result.analysis.missing_info_reason && (
                      <div className="alert" style={{ marginTop: '.75rem' }}>{result.analysis.missing_info_reason}</div>
                    )}
                    <p className="action"><strong>Acción ejecutada:</strong> {result.action_result}</p>
                    {result.services.length > 0 && (
                      <div className="services">
                        {result.services.map((s) => (
                          <div className="service" key={s.name}><strong>{s.name}</strong><span>{s.status} · {s.contact}</span></div>
                        ))}
                      </div>
                    )}
                  </div>
                  {result.recommendations.length > 0 && (
                    <div className="card">
                      <h2><span className="dot" />Recomendaciones</h2>
                      <ul className="reco">{result.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ul>
                    </div>
                  )}
                </div>
              )}

              {tab === 'map' && (
                <>
                {routes.length > 1 && (
                  <div className="route-picker reveal">
                    <b><RouteIcon size={15} /> Rutas calculadas en este caso ({routes.length})</b>
                    <div>
                      {routes.map((h, i) => {
                        const on = (routeSel ?? routes.length - 1) === i
                        return (
                          <button type="button" key={i} className={on ? 'on' : ''} onClick={() => { setRouteSel(i); setAltSel(null) }}>
                            <span>{h.source === 'chat' ? 'Chat' : 'Registro'} · {new Date(h.at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</span>
                            <strong>{h.route.origin?.name ?? 'Partida'} → {h.route.destination?.name ?? 'Destino'}</strong>
                            <small>{h.route.best.duration_min} min · {h.route.best.distance_km} km</small>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                <div className="grid2 map-grid reveal">
                  {result.location ? (
                    <div className="card"><MapView location={result.location} route={activeRoute} selected={selectedName} onSelect={setAltSel} /></div>
                  ) : (
                    <div className="card empty">Sin ubicación disponible.</div>
                  )}
                  {activeRoute ? (
                    <RoutePanel route={activeRoute} selected={selectedName} onSelect={setAltSel} />
                  ) : (
                    <div className="card empty">
                      <p>No se planeó ninguna ruta.</p>
                      <small>Activa «Quiero planear una ruta» en el paso 2 de un nuevo caso.</small>
                    </div>
                  )}
                </div>
                </>
              )}

              <div hidden={tab !== 'chat'}>
                <Chat
                  key={result.case_id}
                  caseId={result.case_id}
                  history={result.chat_history}
                  onCaseUpdated={(updated) => { setResult(updated); setRouteSel(null); setAltSel(null); void refreshHistory() }}
                />
              </div>

              {tab === 'trace' && (
                <div className="reveal">
                  <div className="card"><h2><span className="dot" />Trazabilidad de agentes y herramientas</h2>
                    <TracePanel events={result.trace_events} fallback={result.trace}
                      imageUrl={result.has_image ? caseImageUrl(result.case_id) : undefined} imageDescription={result.analysis.image_description} />
                  </div>
                  <AgentsPanel />
                </div>
              )}
            </div>

            <div className="dash-foot">
              <button type="button" className="secondary" onClick={() => setView('history')}><History size={16} /> Ver historial</button>
              <button type="button" onClick={newCase}><Plus size={16} /> Nuevo caso</button>
            </div>
          </section>
        )}
      </main>
    </>
  )
}
