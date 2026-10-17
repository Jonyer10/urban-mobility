import { useEffect, useState } from 'react'
import { listAgents } from '../api'
import type { AgentInfo } from '../types'
import './panels.css'

const list = (v: string[] | string | undefined) => (Array.isArray(v) ? v : v ? [v] : [])

export function AgentsPanel() {
  const [agents, setAgents] = useState<AgentInfo[]>([])

  useEffect(() => {
    listAgents().then(setAgents).catch(() => setAgents([]))
  }, [])

  if (!agents.length) return null
  return (
    <details className="card agents">
      <summary>Agentes del sistema ({agents.length})</summary>
      <div className="agent-grid">
        {agents.map((a, i) => (
          <div className="agent" key={a.name}>
            <span className="agent-n">{i + 1}</span>
            <strong>{a.name}</strong>
            <p>{a.responsibility}</p>
            <small><b>Herramientas:</b> {list(a.tools).join(' · ') || '—'}</small>
            <small><b>Salidas:</b> {list(a.outputs).join(' · ') || '—'}</small>
          </div>
        ))}
      </div>
    </details>
  )
}
