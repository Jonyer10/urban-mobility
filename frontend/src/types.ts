export interface Analysis {
  category: string
  urgency_level: string
  summary: string
  is_valid_case: boolean
  missing_info_reason: string | null
  image_description?: string
}

export interface LocalService {
  name: string
  status: string
  contact: string
}

export interface CaseLocation {
  lat: number
  lon: number
  display_name: string
  source: string
}

export interface RouteOption {
  name: string
  distance_km: number
  duration_min: number
  via: string[]
  source: string
  incidents_on_route: { id: string | number; summary: string }[]
  geometry?: [number, number][] // [lon, lat]
}

export interface RouteResult {
  best: RouteOption
  alternatives: RouteOption[]
  alerts: string[]
  destination?: { name: string; lat: number; lon: number }
  origin?: { name: string; lat: number; lon: number }
}

export interface AgentInfo {
  name: string
  responsibility: string
  inputs?: string[] | string
  tools?: string[] | string
  outputs?: string[] | string
}

export interface ToolUsed {
  name: string
  args: Record<string, unknown>
}

export interface TraceEvent {
  at: string
  agent: string
  kind: 'agent' | 'tool' | 'action'
  tool: string | null
  input: string | null
  output: string | null
  message: string
}

export interface ChatRecord {
  at: string
  question: string
  response: string
  tools_used: ToolUsed[]
}

export interface CaseSummary {
  id: number
  created_at: string
  user_text: string
  incident_location: string
  category?: string
  urgency_level?: string
  action_executed?: string
}

export interface RouteEntry {
  at: string
  source: 'registro' | 'chat'
  route: RouteResult
}

export interface CaseResult {
  case_id: number
  has_image?: boolean
  analysis: Analysis
  recommendations: string[]
  action_result: string
  location: CaseLocation | null
  services: LocalService[]
  route?: RouteResult | null
  route_history?: RouteEntry[]
  trace: string[]
  trace_events?: TraceEvent[]
  chat_history?: ChatRecord[]
}
