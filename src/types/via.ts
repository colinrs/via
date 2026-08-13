export type Id = string

export type TunnelState =
  | 'stopped'
  | 'starting'
  | 'active'
  | 'reconnecting'
  | 'conflict'
  | 'failed'

export interface PasswordAuthConfig {
  kind: 'password'
  secretId: Id | null
}

export interface PrivateKeyAuthConfig {
  kind: 'private_key'
  path: string
  passphraseSecretId: Id | null
}

export type AuthConfig = PasswordAuthConfig | PrivateKeyAuthConfig

export interface Group {
  id: Id
  name: string
}

export interface SessionConfig {
  id: Id
  groupId: Id
  name: string
  host: string
  port: number
  user: string
  auth: AuthConfig
}

export interface LocalForwardRule {
  id: Id
  sessionId: Id
  enabled: boolean
  localPort: number
  targetHost: string
  targetPort: number
  note: string
  runtimeState: TunnelState
}

const tunnelStates = new Set<TunnelState>([
  'stopped',
  'starting',
  'active',
  'reconnecting',
  'conflict',
  'failed',
])

export function isTunnelState(value: string): value is TunnelState {
  return tunnelStates.has(value as TunnelState)
}
