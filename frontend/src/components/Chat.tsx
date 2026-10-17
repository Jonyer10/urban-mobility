import { Fragment, useEffect, useRef, useState } from 'react'
import { Send, Wrench, Zap } from 'lucide-react'
import { askChat, getCase } from '../api'
import type { CaseResult, ChatRecord, ToolUsed } from '../types'

interface Msg {
  from: 'user' | 'bot'
  text: string
  tools?: ToolUsed[]
}

const ACTIONS = ['actualizar_caso']
const SUGGESTIONS = ['¿Quién atenderá mi caso?', '¿Qué ruta me recomiendas?', 'Cambia la urgencia a Alto']

// Reconstruye la conversación guardada en el servidor
const fromHistory = (history: ChatRecord[] = []): Msg[] =>
  history.flatMap((h) => [
    { from: 'user' as const, text: h.question },
    { from: 'bot' as const, text: h.response, tools: h.tools_used },
  ])

// Formato básico de la respuesta del modelo: **negrita** y viñetas "* "
function renderText(text: string) {
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
    )
  const lines = text
    .replace(/\s+\*\s+(?=\*\*)/g, '\n* ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return lines.map((l, i) =>
    /^[*-]\s+/.test(l) ? <span key={i} className="li">• {inline(l.replace(/^[*-]\s+/, ''))}</span> : <span key={i} className="ln">{inline(l)}</span>,
  )
}

interface Props {
  caseId: number
  history?: ChatRecord[]
  onCaseUpdated?: (updated: CaseResult) => void
}

// Se monta con key={caseId}: el estado inicial se toma del historial guardado
export function Chat({ caseId, history, onCaseUpdated }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>(() => fromHistory(history))
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' })
  }, [msgs])

  const send = async (e: React.FormEvent, preset?: string) => {
    e.preventDefault()
    const q = (preset ?? question).trim()
    if (!q || busy) return
    setQuestion('')
    setBusy(true)
    setMsgs((m) => [...m, { from: 'user', text: q }])
    try {
      const { response, tools_used = [] } = await askChat(caseId, q)
      setMsgs((m) => [...m, { from: 'bot', text: response, tools: tools_used }])
      // Cualquier herramienta deja eventos en la traza del caso; la acción además puede cambiarlo
      if (tools_used.length) onCaseUpdated?.(await getCase(caseId))
    } catch (err) {
      setMsgs((m) => [...m, { from: 'bot', text: (err as Error).message }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2><span className="dot" />Chat del caso #{caseId}</h2>
      {msgs.length > 0 && (
        <div className="chat" ref={box}>
          {msgs.map((m, i) => (
            <Fragment key={i}>
              <p className={m.from}>{m.from === 'bot' ? renderText(m.text) : m.text}</p>
              {m.tools && m.tools.length > 0 && (
                <small className="tools">
                  {m.tools.map((t) => (
                    <span key={t.name} className="tool-pill">
                      {ACTIONS.includes(t.name) ? <Zap size={12} /> : <Wrench size={12} />}
                      {ACTIONS.includes(t.name) ? 'Acción ejecutada' : 'Herramienta'}: {t.name}
                    </span>
                  ))}
                </small>
              )}
            </Fragment>
          ))}
        </div>
      )}
      {msgs.length === 0 && (
        <div className="chips">
          {SUGGESTIONS.map((q) => (
            <button type="button" key={q} className="chip" onClick={(e) => void send(e, q)}>{q}</button>
          ))}
        </div>
      )}
      <form onSubmit={send} className="row">
        <input type="text" value={question} onChange={(e) => setQuestion(e.target.value)}
          placeholder="Pregunta sobre este caso…" />
        <button disabled={busy || !question.trim()}><Send size={15} /> Enviar</button>
      </form>
    </section>
  )
}
