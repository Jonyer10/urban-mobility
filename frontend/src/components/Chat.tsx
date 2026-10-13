import { useEffect, useRef, useState } from 'react'
import { askChat } from '../api'

interface Msg {
  from: 'user' | 'bot'
  text: string
}

export function Chat({ caseId }: { caseId: number }) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMsgs([])
  }, [caseId])

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
      const { response } = await askChat(caseId, q)
      setMsgs((m) => [...m, { from: 'bot', text: response }])
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
            <p key={i} className={m.from}>{m.text}</p>
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
