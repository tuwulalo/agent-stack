export type Role = 'system' | 'user' | 'assistant'

export interface Message {
  id: string
  role: Role
  content: string
  createdAt: number
}

export interface Session {
  id: string
  title: string
  model: string
  systemPrompt: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

export interface ServiceState {
  name: string
  shortName: string
  url: string
  pingUrl: string
  status: 'up' | 'down' | 'unknown'
  latencyMs?: number
}
