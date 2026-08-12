import { describe, expect, it, vi } from 'vitest'
import { createViaStore, type ViaBridge } from './via'

describe('ViaStore', () => {
  it('retries startup loading and becomes ready after the backend is available', async () => {
    vi.useFakeTimers()
    try {
      const invoke = vi.fn().mockRejectedValueOnce(new Error('bridge unavailable'))
        .mockResolvedValueOnce({ schemaVersion: 1, groups: [], sessions: [], rules: [] })
      const store = createViaStore({ invoke, listen: vi.fn().mockResolvedValue(() => {}) } as ViaBridge)

      const initialized = store.initialize()
      void initialized.catch(() => undefined)
      expect(store.initializationState).toBe('connecting')

      await vi.advanceTimersByTimeAsync(500)
      await initialized

      expect(store.initializationState).toBe('ready')
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails startup loading after three unavailable backend attempts', async () => {
    vi.useFakeTimers()
    try {
      const invoke = vi.fn().mockRejectedValue(new Error('bridge unavailable'))
      const store = createViaStore({ invoke, listen: vi.fn().mockResolvedValue(() => {}) } as ViaBridge)

      const initialized = store.initialize()
      void initialized.catch(() => undefined)
      expect(store.initializationState).toBe('connecting')

      await vi.advanceTimersByTimeAsync(1_000)
      await expect(initialized).rejects.toThrow('bridge unavailable')

      expect(store.initializationState).toBe('failed')
      expect(invoke).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails initialization when the runtime-state listener cannot be registered', async () => {
    const store = createViaStore({
      invoke: vi.fn().mockResolvedValue({ schemaVersion: 1, groups: [], sessions: [], rules: [] }),
      listen: vi.fn().mockRejectedValue(new Error('listener unavailable')),
    } as ViaBridge)

    const initialized = store.initialize()
    void initialized.catch(() => undefined)

    await expect(initialized).rejects.toThrow('listener unavailable')
    expect(store.initializationState).toBe('failed')
  })

  it('starts enabled rules through the selected session command', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    const store = createViaStore({ invoke, listen: vi.fn().mockResolvedValue(() => {}) } as ViaBridge)
    await store.startEnabledRules('session-1')
    expect(invoke).toHaveBeenCalledWith('start_enabled_rules', { sessionId: 'session-1' })
  })
  it('reconnects a session after a reconnecting runtime update', async () => {
    vi.useFakeTimers()
    let runtimeHandler: ((value: { rules: Array<{ ruleId: string; state: 'reconnecting'; message: null }> }) => void) | undefined
    const invoke = vi.fn().mockImplementation((command: string) => command === 'load_config' ? Promise.resolve({ schemaVersion: 1, groups: [], sessions: [{ id: 's', groupId: 'g', name: 'n', host: 'h', port: 22, user: 'u', auth: { kind: 'password', secretId: null } }], rules: [{ id: 'r', sessionId: 's', enabled: true, localPort: 1, targetHost: 'h', targetPort: 1, note: '', runtimeState: 'stopped' }] }) : Promise.resolve())
    const store = createViaStore({ invoke, listen: vi.fn().mockImplementation((_event, handler) => { runtimeHandler = handler; return Promise.resolve(() => {}) }) } as ViaBridge)
    await store.initialize(); runtimeHandler?.({ rules: [{ ruleId: 'r', state: 'reconnecting', message: null }] })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(invoke).toHaveBeenCalledWith('connect_session', { sessionId: 's' })
    vi.useRealTimers()
  })
})
