import { Fragment, useEffect, useRef, useState } from 'react'
import { askChat, getCase } from '../api'
import type { CaseResult, ChatRecord, ToolUsed } from '../types'

interface Msg {
  from: 'user' | 'bot'
  text: string
  tools?: ToolUsed[]
}

const ACTIONS = ['actualizar_caso']

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

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    const q = question.trim()
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
                  {m.tools.map((t) => (ACTIONS.includes(t.name) ? '⚙ Acción ejecutada: ' : '🔧 Herramienta: ') + t.name).join(' · ')}
                </small>
              )}
            </Fragment>
          ))}
        </div>
      )}
      <form onSubmit={send} className="row">
        <input type="text" value={question} onChange={(e) => setQuestion(e.target.value)}
          placeholder="Pregunta sobre este caso…" />
        <button disabled={busy || !question.trim()}>Enviar</button>
      </form>
    </section>
  )
}
