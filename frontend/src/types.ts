export interface Analysis {
  category: string
  urgency_level: string
  summary: string
  is_valid_case: boolean
  missing_info_reason: string | null
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

export interface CaseResult {
  case_id: number
  analysis: Analysis
  recommendations: string[]
  action_result: string
  location: CaseLocation | null
  services: LocalService[]
  trace: string[]
}
