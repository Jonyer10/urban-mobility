import type { CaseResult, CaseSummary, ToolUsed } from './types'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

async function request<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`)
  return data as T
}

export function processCase(payload: {
  user_text: string
  incident_location: string
  start_location?: string
  destination_location?: string
  image_base64?: string
}) {
  return request<CaseResult>('/api/process-case', payload)
}

export function askChat(caseId: number, question: string) {
  return request<{ response: string; tools_used?: ToolUsed[] }>('/api/chat-contextual', {
    case_id: caseId,
    question,
  })
}

/** Caso persistido en el servidor, con el mismo formato que devuelve process-case. */
export async function getCase(caseId: number): Promise<CaseResult> {
  const res = await fetch(`${API_URL}/api/cases/${caseId}`)
  if (!res.ok) throw new Error(`No se pudo recuperar el caso #${caseId} (${res.status}).`)
  const c = await res.json()
  return {
    case_id: c.id,
    analysis: c.analysis,
    recommendations: c.recommendations ?? [],
    action_result: c.action_executed ?? '',
    location: c.location ?? null,
    services: c.services ?? [],
    route: c.route ?? null,
    trace: c.trace_log ?? [],
    trace_events: c.trace_events,
    chat_history: c.chat_history,
  }
}

/** Historial de casos guardados en la base de datos (más recientes primero). */
export async function listCases(limit = 15): Promise<CaseSummary[]> {
  const res = await fetch(`${API_URL}/api/cases?limit=${limit}`)
  if (!res.ok) throw new Error(`No se pudo cargar el historial (${res.status}).`)
  return res.json()
}

/** Convierte un File a base64 puro (sin el prefijo data:...). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'))
    reader.readAsDataURL(file)
  })
}
