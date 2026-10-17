import { useMemo, useState } from 'react'
import {
  Brain, Building2, Camera, CheckCircle2, Database, ChevronRight, Lightbulb, MapPin, MessageSquare, Route as RouteIcon,
  Sparkles, Workflow, Wrench, Zap, type LucideIcon,
} from 'lucide-react'
import type { TraceEvent } from '../types'
import './trace.css'

const KIND: Record<TraceEvent['kind'], { icon: LucideIcon; label: string }> = {
  agent: { icon: Lightbulb, label: 'Razonamiento' },
  tool: { icon: Wrench, label: 'Herramienta' },
  action: { icon: CheckCircle2, label: 'Acción' },
}

const TOOL_ICON: Record<string, LucideIcon> = {
  gemini: Sparkles,
  imagen: Camera,
  geolocalizacion: MapPin,
  buscar_servicios: Building2,
  calcular_ruta: RouteIcon,
  actualizar_caso: Zap,
  registrar_caso: Database,
}

// Ícono y color por agente (según su nombre)
function agentStyle(name: string): { icon: LucideIcon; color: string } {
  const n = name.toLowerCase()
  if (n.includes('orquest')) return { icon: Workflow, color: '#64748b' }
  if (n.includes('agente 1')) return { icon: Brain, color: '#6366f1' }
  if (n.includes('agente 2')) return { icon: MapPin, color: '#0ea5e9' }
  if (n.includes('agente 3')) return { icon: RouteIcon, color: '#10b981' }
  if (n.includes('chat')) return { icon: MessageSquare, color: '#f59e0b' }
  return { icon: Brain, color: '#6366f1' }
}

const shortAgent = (name: string) => name.split(' (')[0]
const roleOf = (name: string) => name.match(/\(([^)]+)\)/)?.[1] ?? ''
const clean = (msg: string) => msg.replace(/^[^:]+:\s*/, '')

interface Group {
  agent: string
  events: TraceEvent[]
}

function groupByAgent(events: TraceEvent[]): Group[] {
  const map = new Map<string, TraceEvent[]>()
  events.forEach((e) => map.set(e.agent, [...(map.get(e.agent) ?? []), e]))
  return [...map].map(([agent, evs]) => ({ agent, events: evs }))
}

function seconds(evs: TraceEvent[]) {
  const t = evs.map((e) => new Date(e.at).getTime())
  const s = (Math.max(...t) - Math.min(...t)) / 1000
  return s < 0.1 ? '<0.1 s' : `${s.toFixed(1)} s`
}

function ToolChip({ name }: { name: string }) {
  const Icon = TOOL_ICON[name] ?? Wrench
  return <i className="tp-tool"><Icon size={11} />{name}</i>
}

function EventRow({ e }: { e: TraceEvent }) {
  const [open, setOpen] = useState(false)
  const hasIO = Boolean(e.input || e.output)
  const { icon: Icon, label } = KIND[e.kind]
  return (
    <li className={`tp-ev k-${e.kind}`}>
      <button type="button" className="tp-ev-head" disabled={!hasIO} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="tp-ico" title={label}><Icon size={15} /></span>
        <span className="tp-msg">{clean(e.message)}</span>
        {e.tool && <ToolChip name={e.tool} />}
        {hasIO && <ChevronRight size={16} className={`tp-caret${open ? ' open' : ''}`} />}
      </button>
      {hasIO && (
        <div className={`tp-io${open ? ' open' : ''}`}>
          <div>
            {e.input && <p><b>Entrada</b><code>{e.input}</code></p>}
            {e.output && <p><b>Salida</b><code>{e.output}</code></p>}
          </div>
        </div>
      )}
    </li>
  )
}

interface Props {
  events?: TraceEvent[]
  fallback: string[]
  imageUrl?: string
  imageDescription?: string
}

export function TracePanel({ events, fallback, imageUrl, imageDescription }: Props) {
  const groups = useMemo(() => groupByAgent(events ?? []), [events])
  const [openAgents, setOpenAgents] = useState<Set<string>>(new Set())

  // Casos creados antes de la trazabilidad estructurada solo tienen frases
  if (!events?.length) {
    return <ol className="trace">{fallback.map((t, i) => <li key={i}>{t}</li>)}</ol>
  }

  const toolCount = events.filter((e) => e.kind === 'tool').length
  const allOpen = openAgents.size === groups.length
  const toggle = (a: string) =>
    setOpenAgents((s) => {
      const n = new Set(s)
      if (n.has(a)) n.delete(a)
      else n.add(a)
      return n
    })

  return (
    <div className="tp">
      {imageUrl && (
        <div className="tp-evidence">
          <a href={imageUrl} target="_blank" rel="noreferrer" title="Abrir imagen completa"><img src={imageUrl} alt="Imagen adjunta" /></a>
          <div>
            <b><Camera size={14} /> Evidencia analizada por el Agente 1</b>
            <span>{imageDescription || 'La imagen fue enviada a Gemini junto con el texto del caso.'}</span>
          </div>
        </div>
      )}
      <div className="tp-sum">
        <span><Workflow size={14} /><b>{groups.length}</b> agentes</span>
        <span><Lightbulb size={14} /><b>{events.length}</b> pasos</span>
        <span><Wrench size={14} /><b>{toolCount}</b> herramientas</span>
        <button type="button" className="ghost" onClick={() => setOpenAgents(allOpen ? new Set() : new Set(groups.map((g) => g.agent)))}>
          {allOpen ? 'Contraer todo' : 'Expandir todo'}
        </button>
      </div>

      <ol className="tp-agents">
        {groups.map((g, i) => {
          const open = openAgents.has(g.agent)
          const tools = [...new Set(g.events.filter((e) => e.tool).map((e) => e.tool as string))]
          const { icon: AgentIcon, color } = agentStyle(g.agent)
          return (
            <li key={g.agent} className={`tp-agent${open ? ' open' : ''}`} style={{ animationDelay: `${i * 70}ms`, ['--ac' as string]: color }}>
              <button type="button" className="tp-agent-head" aria-expanded={open} onClick={() => toggle(g.agent)}>
                <span className="tp-n"><AgentIcon size={18} /></span>
                <span className="tp-title">
                  <strong>{shortAgent(g.agent)}</strong>
                  {roleOf(g.agent) && <small>{roleOf(g.agent)}</small>}
                </span>
                <span className="tp-meta">
                  {tools.slice(0, 2).map((t) => <ToolChip key={t} name={t} />)}
                  {tools.length > 2 && <i className="tp-tool">+{tools.length - 2}</i>}
                  <em>{g.events.length} pasos · {seconds(g.events)}</em>
                </span>
                <ChevronRight size={18} className={`tp-caret${open ? ' open' : ''}`} />
              </button>
              <div className={`tp-body${open ? ' open' : ''}`}>
                <ul className="tp-evs">
                  {g.events.map((e, k) => <EventRow key={k} e={e} />)}
                </ul>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
