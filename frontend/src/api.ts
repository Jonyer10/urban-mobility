import type { CaseResult } from './types'

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
  origin_location: string
  image_base64?: string
}) {
  return request<CaseResult>('/api/process-case', payload)
}

export function askChat(caseId: number, question: string) {
  return request<{ response: string }>('/api/chat-contextual', {
    case_id: caseId,
    question,
  })
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
