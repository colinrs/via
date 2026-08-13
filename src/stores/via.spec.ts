import { describe, expect, it, vi } from 'vitest'
import { createViaStore, type ViaBridge } from './via'

describe('ViaStore', () => {
  const emptyConfig = { schemaVersion: 1, groups: [], sessions: [], rules: [] }
  const tenCodes = Array.from({ length: 10 }, (_, index) => `CODE-${index + 1}`)

  it('retries startup loading and becomes ready after the backend is available', async () => {
    vi.useFakeTimers()
    try {
      const invoke = vi.fn().mockRejectedValueOnce(new Error('bridge unavailable'))
        .mockImplementation((command: string) => command === 'load_config'
          ? emptyConfig
          : command === 'secret_store_status' ? { configured: true } : undefined)
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
      invoke: vi.fn().mockImplementation((command: string) => command === 'load_config'
        ? emptyConfig
        : command === 'secret_store_status' ? { configured: true } : undefined),
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

  it('deletes a group through the typed bridge wrapper', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    const store = createViaStore({ invoke, listen: vi.fn().mockResolvedValue(() => {}) } as ViaBridge)

    await store.deleteGroup('group-1')

    expect(invoke).toHaveBeenCalledWith('delete_group', { groupId: 'group-1' })
  })

  it('deletes a rule through the typed bridge wrapper', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    const store = createViaStore({ invoke, listen: vi.fn().mockResolvedValue(() => {}) } as ViaBridge)

    await store.deleteRule('rule-1')

    expect(invoke).toHaveBeenCalledWith('delete_rule', { ruleId: 'rule-1' })
  })

  it('records that initial setup is required after config loading', async () => {
    const invoke = vi.fn().mockImplementation((command: string) => command === 'load_config'
      ? emptyConfig
      : command === 'secret_store_status' ? { configured: false } : undefined)
    const store = createViaStore({ invoke, listen: vi.fn().mockResolvedValue(() => {}) } as ViaBridge)

    await store.initialize()

    expect(store.secretStoreConfigured).toBe(false)
    expect(invoke).toHaveBeenCalledWith('secret_store_status')
  })

  it('fails closed when secret-store status is malformed', async () => {
    const invoke = vi.fn().mockImplementation((command: string) => command === 'load_config'
      ? emptyConfig
      : command === 'secret_store_status' ? {} : undefined)
    const store = createViaStore({ invoke, listen: vi.fn().mockResolvedValue(() => {}) } as ViaBridge)

    await expect(store.initialize()).rejects.toThrow('invalid secret store status')

    expect(store.initializationState).toBe('failed')
    expect(store.secretStoreConfigured).toBeNull()
  })

  it('refreshes configured vault status without inventing recovery codes', async () => {
    const invoke = vi.fn().mockResolvedValue({ configured: true })
    const store = createViaStore({ invoke, listen: vi.fn().mockResolvedValue(() => {}) } as ViaBridge)

    await expect(store.refreshSecretStoreStatus()).resolves.toBeNull()

    expect(store.secretStoreConfigured).toBe(true)
    expect(invoke).toHaveBeenCalledWith('secret_store_status')
  })

  it('initializes the vault and returns its one-time recovery codes', async () => {
    const invoke = vi.fn().mockResolvedValue(tenCodes)
    const store = createViaStore({ invoke, listen: vi.fn().mockResolvedValue(() => {}) } as ViaBridge)

    await expect(store.initializeSecrets('new password')).resolves.toEqual(tenCodes)

    expect(store.secretStoreConfigured).toBe(true)
    expect(invoke).toHaveBeenCalledWith('initialize_secrets', { masterPassword: 'new password' })
    expect(JSON.stringify(store)).not.toContain('new password')
  })

  it('returns optional migration recovery codes when unlocking the vault', async () => {
    const invoke = vi.fn().mockResolvedValue(tenCodes)
    const store = createViaStore({ invoke, listen: vi.fn().mockResolvedValue(() => {}) } as ViaBridge)

    await expect(store.unlockSecrets('master password')).resolves.toEqual(tenCodes)

    expect(invoke).toHaveBeenCalledWith('unlock_secrets', { masterPassword: 'master password' })
    expect(JSON.stringify(store)).not.toContain('master password')
  })

  it('sends recovery credentials without retaining them in global state', async () => {
    const invoke = vi.fn().mockResolvedValue(tenCodes)
    const store = createViaStore({ invoke, listen: vi.fn().mockResolvedValue(() => {}) } as ViaBridge)

    await expect(store.recoverSecrets('old-code', 'new password')).resolves.toEqual(tenCodes)

    expect(store.secretStoreConfigured).toBe(true)
    expect(invoke).toHaveBeenCalledWith('recover_secrets', { recoveryCode: 'old-code', newMasterPassword: 'new password' })
    expect(JSON.stringify(store)).not.toContain('old-code')
    expect(JSON.stringify(store)).not.toContain('new password')
  })

  it('rejects malformed recovery-code results without marking setup complete', async () => {
    const invoke = vi.fn().mockResolvedValue(['ONLY-ONE'])
    const store = createViaStore({ invoke, listen: vi.fn().mockResolvedValue(() => {}) } as ViaBridge)

    await expect(store.initializeSecrets('new password')).rejects.toThrow('invalid recovery codes')

    expect(store.secretStoreConfigured).toBeNull()
  })

  it('accepts only null or ten unique nonblank codes from unlock', async () => {
    const invalidResults: unknown[] = [undefined, ['ONE'], [...tenCodes.slice(0, 9), tenCodes[0]], [...tenCodes.slice(0, 9), '   ']]
    for (const result of invalidResults) {
      const store = createViaStore({
        invoke: vi.fn().mockResolvedValue(result),
        listen: vi.fn().mockResolvedValue(() => {}),
      } as ViaBridge)
      await expect(store.unlockSecrets('master password')).rejects.toThrow('invalid recovery codes')
    }

    const store = createViaStore({
      invoke: vi.fn().mockResolvedValue(null),
      listen: vi.fn().mockResolvedValue(() => {}),
    } as ViaBridge)
    await expect(store.unlockSecrets('master password')).resolves.toBeNull()
  })

  it('replaces local configuration after atomically saving a session secret', async () => {
    const initialConfig = {
      schemaVersion: 1,
      groups: [{ id: 'group-old', name: 'Old' }],
      sessions: [{ id: 'session-old', groupId: 'group-old', name: 'Old', host: 'old.example', port: 22, user: 'old', auth: { kind: 'password' as const, secretId: null } }],
      rules: [],
    }
    const persistedConfig = {
      schemaVersion: 1,
      groups: [{ id: 'group-new', name: 'New' }],
      sessions: [{ id: 'session-1', groupId: 'group-new', name: 'Server', host: 'new.example', port: 22, user: 'via', auth: { kind: 'password' as const, secretId: 'secret-1' } }],
      rules: [{ id: 'rule-1', sessionId: 'session-1', enabled: true, localPort: 8080, targetHost: 'localhost', targetPort: 80, note: '', runtimeState: 'stopped' as const }],
    }
    const invoke = vi.fn().mockImplementation((command: string) => command === 'load_config'
      ? initialConfig
      : command === 'secret_store_status' ? { configured: true } : persistedConfig)
    const store = createViaStore({ invoke, listen: vi.fn().mockResolvedValue(() => {}) } as ViaBridge)
    await store.initialize()

    await store.saveSessionSecret('session-1', 'ssh password')

    expect(invoke).toHaveBeenCalledWith('save_session_secret', { sessionId: 'session-1', secret: 'ssh password' })
    expect(store.groups).toEqual(persistedConfig.groups)
    expect(store.sessions).toEqual(persistedConfig.sessions)
    expect(store.rules).toEqual(persistedConfig.rules)
    expect(JSON.stringify(store)).not.toContain('ssh password')
  })

  it('reconnects a session after a reconnecting runtime update', async () => {
    vi.useFakeTimers()
    let runtimeHandler: ((value: { rules: Array<{ ruleId: string; state: 'reconnecting'; message: null }> }) => void) | undefined
    const invoke = vi.fn().mockImplementation((command: string) => command === 'load_config'
      ? Promise.resolve({ schemaVersion: 1, groups: [], sessions: [{ id: 's', groupId: 'g', name: 'n', host: 'h', port: 22, user: 'u', auth: { kind: 'password', secretId: null } }], rules: [{ id: 'r', sessionId: 's', enabled: true, localPort: 1, targetHost: 'h', targetPort: 1, note: '', runtimeState: 'stopped' }] })
      : command === 'secret_store_status' ? Promise.resolve({ configured: true }) : Promise.resolve())
    const store = createViaStore({ invoke, listen: vi.fn().mockImplementation((_event, handler) => { runtimeHandler = handler; return Promise.resolve(() => {}) }) } as ViaBridge)
    await store.initialize(); runtimeHandler?.({ rules: [{ ruleId: 'r', state: 'reconnecting', message: null }] })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(invoke).toHaveBeenCalledWith('connect_session', { sessionId: 's' })
    vi.useRealTimers()
  })
})
