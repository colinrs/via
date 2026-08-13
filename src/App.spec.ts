import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const { invoke, listen, open } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  open: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open }))

import App from './App.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function openConfirmDialog(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAllComponents(ConfirmDialog).find((dialog) => dialog.props('open'))!
}

function mountAppWithGroups(groups: Array<{ id: string; name: string }>) {
  invoke.mockImplementation(async (command: string) => {
    if (command === 'load_config') return { schemaVersion: 1, groups, sessions: [], rules: [] }
    return undefined
  })
  listen.mockResolvedValue(() => undefined)

  const wrapper = mount(App)
  return flushPromises().then(() => wrapper)
}

const session = (
  id: string,
  groupId: string,
  auth: { kind: 'password'; secretId: string | null } | { kind: 'private_key'; path: string; passphraseSecretId: string | null } = { kind: 'password', secretId: null },
) => ({
  id,
  groupId,
  name: `会话 ${id}`,
  host: 'localhost',
  port: 22,
  user: 'root',
  auth,
})

const rule = (id: string, sessionId: string, runtimeState: 'stopped' | 'active' = 'stopped') => ({
  id,
  sessionId,
  enabled: runtimeState === 'active',
  localPort: 3000,
  targetHost: 'localhost',
  targetPort: 80,
  note: id,
  runtimeState,
})

function mountAppWithConfig(config: {
  groups: Array<{ id: string; name: string }>
  sessions: ReturnType<typeof session>[]
  rules: ReturnType<typeof rule>[]
}, commandFailures: string | string[] = [], commandHandlers: Record<string, () => Promise<unknown>> = {}) {
  const failures = new Set(Array.isArray(commandFailures) ? commandFailures : [commandFailures])
  invoke.mockImplementation(async (command: string) => {
    if (command === 'load_config') return { schemaVersion: 1, ...config }
    if (commandHandlers[command]) return commandHandlers[command]()
    if (failures.has(command)) throw new Error(`${command} failed`)
    return command === 'secret_store_status' ? { configured: true } : undefined
  })
  listen.mockResolvedValue(() => undefined)

  const wrapper = mount(App)
  return flushPromises().then(() => wrapper)
}

function mountAppWithPendingConfig() {
  invoke.mockImplementation((command: string) => {
    if (command === 'load_config') return new Promise<never>(() => undefined)
    return Promise.resolve(undefined)
  })
  listen.mockResolvedValue(() => undefined)

  return mount(App)
}

function mountAppWithListenerFailure() {
  invoke.mockImplementation(async (command: string) => {
    if (command === 'load_config') return { schemaVersion: 1, groups: [], sessions: [], rules: [] }
    return undefined
  })
  listen.mockRejectedValue(new Error('listener unavailable'))

  const wrapper = mount(App)
  return flushPromises().then(() => wrapper)
}

describe('App', () => {
  it('renders the tunnel management workspace', () => {
    const wrapper = mount(App)

    expect(wrapper.get('[data-testid="via-app"]').text()).toContain('Via')
    expect(wrapper.get('[data-testid="session-sidebar"]')).toBeTruthy()
    expect(wrapper.get('[data-testid="empty-workspace"]')).toBeTruthy()
    expect(wrapper.text()).toContain('还没有 SSH 会话')
  })

  it('creates a session in the group selected in the dialog', async () => {
    const wrapper = await mountAppWithGroups([{ id: 'ops', name: '运维' }, { id: 'prod', name: '生产' }])
    await wrapper.get('.create-session').trigger('click')
    await wrapper.get('select[aria-label="所属分组"]').setValue('prod')
    await wrapper.get('[data-testid="create-session-action"]').trigger('click')
    expect(wrapper.findAll('.session-group')[1].text()).toContain('未命名 SSH 会话')
  })

  it('shows SSH password input when password authentication is selected', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [],
    })

    expect(wrapper.get('[aria-label="SSH 密码"]')).toBeTruthy()
    expect(wrapper.find('[aria-label="私钥文件"]').exists()).toBe(false)
  })

  it('opens the private-key picker and persists an optional passphrase as a secret', async () => {
    open.mockResolvedValue('/Users/me/.ssh/id_ed25519')
    const config = {
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a', { kind: 'private_key' as const, path: '', passphraseSecretId: null })],
      rules: [],
    }
    invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'load_config') return { schemaVersion: 1, ...config }
      if (command === 'secret_store_status') return { configured: true }
      if (command === 'save_session_secret') {
        return {
          schemaVersion: 1,
          ...config,
          sessions: [session('session-a', 'group-a', {
            kind: 'private_key' as const,
            path: '/Users/me/.ssh/id_ed25519',
            passphraseSecretId: 'secret-1',
          })],
        }
      }
      return undefined
    })
    listen.mockResolvedValue(() => undefined)
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.get('[data-testid="choose-private-key"]').trigger('click')
    await flushPromises()
    await wrapper.get('[aria-label="私钥口令"]').setValue('key passphrase')
    await wrapper.get('[data-testid="save-authentication"]').trigger('click')
    await flushPromises()

    expect(open).toHaveBeenCalledWith({ multiple: false, directory: false })
    expect(invoke).toHaveBeenCalledWith('save_session_secret', { sessionId: 'session-a', secret: 'key passphrase' })
  })

  it('offers exactly password and private-key authentication modes', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [],
    })

    const options = wrapper.findAll('select[aria-label="认证方式"] option')
    expect(options.map((option) => option.attributes('value'))).toEqual(['password', 'private_key'])
    expect(options.map((option) => option.text())).toEqual(['密码', '私钥'])
  })

  it('clears both local drafts and old secret IDs whenever authentication kind changes', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a', { kind: 'password', secretId: 'password-secret' })],
      rules: [],
    })
    await wrapper.get('[aria-label="SSH 密码"]').setValue('password draft')

    await wrapper.get('select[aria-label="认证方式"]').setValue('private_key')
    await flushPromises()

    let savedAuth = invoke.mock.calls.filter(([command]) => command === 'save_config').at(-1)![1].config.sessions[0].auth
    expect(savedAuth).toEqual({ kind: 'private_key', path: '', passphraseSecretId: null })
    await wrapper.get('[aria-label="私钥口令"]').setValue('passphrase draft')

    await wrapper.get('select[aria-label="认证方式"]').setValue('password')
    await flushPromises()

    savedAuth = invoke.mock.calls.filter(([command]) => command === 'save_config').at(-1)![1].config.sessions[0].auth
    expect(savedAuth).toEqual({ kind: 'password', secretId: null })
    const secretCallsBeforeSave = invoke.mock.calls.filter(([command]) => command === 'save_session_secret').length
    await wrapper.get('[data-testid="save-authentication"]').trigger('click')
    await flushPromises()
    expect(invoke.mock.calls.filter(([command]) => command === 'save_session_secret')).toHaveLength(secretCallsBeforeSave)
  })

  it('ignores cancelled and non-string private-key picker results', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a', { kind: 'private_key', path: '/old/key', passphraseSecretId: null })],
      rules: [],
    })
    const savesBeforePick = invoke.mock.calls.filter(([command]) => command === 'save_config').length

    open.mockResolvedValueOnce(null).mockResolvedValueOnce(['/unexpected/key'])
    await wrapper.get('[data-testid="choose-private-key"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="choose-private-key"]').trigger('click')
    await flushPromises()

    expect((wrapper.get('[aria-label="私钥文件"]').element as HTMLInputElement).value).toBe('/old/key')
    expect(invoke.mock.calls.filter(([command]) => command === 'save_config')).toHaveLength(savesBeforePick)
  })

  it('blocks authentication saving until a pending private-key selection is persisted', async () => {
    const pendingOpen = deferred<string | null>()
    open.mockReturnValue(pendingOpen.promise)
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a', { kind: 'private_key', path: '/old/key', passphraseSecretId: null })],
      rules: [],
    })
    await wrapper.get('[aria-label="私钥口令"]').setValue('key passphrase')
    const configSavesBeforePick = invoke.mock.calls.filter(([command]) => command === 'save_config').length
    const secretSavesBeforePick = invoke.mock.calls.filter(([command]) => command === 'save_session_secret').length

    await wrapper.get('[data-testid="choose-private-key"]').trigger('click')
    await wrapper.vm.$nextTick()
    const saveButton = wrapper.get('[data-testid="save-authentication"]')
    expect(saveButton.attributes('disabled')).toBeDefined()
    await saveButton.trigger('click')
    await flushPromises()

    expect(invoke.mock.calls.filter(([command]) => command === 'save_config')).toHaveLength(configSavesBeforePick)
    expect(invoke.mock.calls.filter(([command]) => command === 'save_session_secret')).toHaveLength(secretSavesBeforePick)

    pendingOpen.resolve('/new/key')
    await flushPromises()

    const pickerSaves = invoke.mock.calls.filter(([command]) => command === 'save_config').slice(configSavesBeforePick)
    expect(pickerSaves).toHaveLength(1)
    expect(pickerSaves[0][1].config.sessions[0].auth.path).toBe('/new/key')
    expect((wrapper.get('[aria-label="私钥文件"]').element as HTMLInputElement).value).toBe('/new/key')
  })

  it('blocks generic config writes while a private-key picker operation is pending', async () => {
    const pendingOpen = deferred<string | null>()
    open.mockReturnValue(pendingOpen.promise)
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a', { kind: 'private_key', path: '/old/key', passphraseSecretId: null })],
      rules: [],
    })
    const configSavesBeforePick = invoke.mock.calls.filter(([command]) => command === 'save_config').length

    await wrapper.get('[data-testid="choose-private-key"]').trigger('click')
    const hostInput = wrapper.findAll('.editor-fields > label').find((label) => label.text().includes('主机地址'))!.get('input')
    expect(wrapper.get('[data-testid="app-interactions"]').attributes('disabled')).toBeDefined()
    await hostInput.setValue('racing.example.com')
    await hostInput.trigger('change')
    await flushPromises()

    expect(invoke.mock.calls.filter(([command]) => command === 'save_config')).toHaveLength(configSavesBeforePick)

    pendingOpen.resolve('/new/key')
    await flushPromises()
    const pickerSaves = invoke.mock.calls.filter(([command]) => command === 'save_config').slice(configSavesBeforePick)
    expect(pickerSaves).toHaveLength(1)
    expect(pickerSaves[0][1].config.sessions[0].auth.path).toBe('/new/key')
  })

  it('does not start a private-key picker while another config write is pending', async () => {
    const pendingSave = deferred()
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a', { kind: 'private_key', path: '/old/key', passphraseSecretId: null })],
      rules: [],
    }, [], { save_config: () => pendingSave.promise })
    const opensBeforeEdit = open.mock.calls.length
    const hostInput = wrapper.findAll('.editor-fields > label').find((label) => label.text().includes('主机地址'))!.get('input')

    await hostInput.setValue('saved-first.example.com')
    await hostInput.trigger('change')
    await wrapper.get('[data-testid="choose-private-key"]').trigger('click')

    expect(open).toHaveBeenCalledTimes(opensBeforeEdit)
    expect(wrapper.get('[data-testid="choose-private-key"]').attributes('disabled')).toBeDefined()

    pendingSave.resolve()
    await flushPromises()
    expect(wrapper.get('[data-testid="choose-private-key"]').attributes('disabled')).toBeUndefined()
  })

  it('queues ordinary config edits made while an earlier config write is pending', async () => {
    const firstSave = deferred()
    let saveCount = 0
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a', { kind: 'private_key', path: '/old/key', passphraseSecretId: null })],
      rules: [],
    }, [], {
      save_config: () => {
        saveCount += 1
        return saveCount === 1 ? firstSave.promise : Promise.resolve()
      },
    })
    const savesBeforeEdit = invoke.mock.calls.filter(([command]) => command === 'save_config').length
    const editorLabels = wrapper.findAll('.editor-fields > label')
    const hostInput = editorLabels.find((label) => label.text().includes('主机地址'))!.get('input')
    const nameInput = editorLabels.find((label) => label.text().includes('会话名称'))!.get('input')

    await hostInput.setValue('queued.example.com')
    await nameInput.setValue('排队保存')
    expect(invoke.mock.calls.filter(([command]) => command === 'save_config')).toHaveLength(savesBeforeEdit + 1)

    firstSave.resolve()
    await flushPromises()

    const configSaves = invoke.mock.calls.filter(([command]) => command === 'save_config').slice(savesBeforeEdit)
    expect(configSaves).toHaveLength(2)
    expect(configSaves[1][1].config.sessions[0]).toMatchObject({ host: 'queued.example.com', name: '排队保存' })
  })

  it('allows only one private-key picker operation at a time', async () => {
    const pendingOpen = deferred<string | null>()
    open.mockReturnValue(pendingOpen.promise)
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a', { kind: 'private_key', path: '/old/key', passphraseSecretId: null })],
      rules: [],
    })
    const opensBeforePick = open.mock.calls.length

    const chooseButton = wrapper.get('[data-testid="choose-private-key"]')
    await chooseButton.trigger('click')
    await chooseButton.trigger('click')

    expect(open).toHaveBeenCalledTimes(opensBeforePick + 1)
    expect(chooseButton.attributes('disabled')).toBeDefined()

    pendingOpen.resolve('/new/key')
    await flushPromises()
    expect((wrapper.get('[aria-label="私钥文件"]').element as HTMLInputElement).value).toBe('/new/key')
  })

  it('preserves the private-key path and reports a specific error when the picker fails', async () => {
    open.mockRejectedValue(new Error('dialog unavailable'))
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a', { kind: 'private_key', path: '/old/key', passphraseSecretId: null })],
      rules: [],
    })
    const savesBeforePick = invoke.mock.calls.filter(([command]) => command === 'save_config').length

    await wrapper.get('[data-testid="choose-private-key"]').trigger('click')
    await flushPromises()

    expect((wrapper.get('[aria-label="私钥文件"]').element as HTMLInputElement).value).toBe('/old/key')
    expect(invoke.mock.calls.filter(([command]) => command === 'save_config')).toHaveLength(savesBeforePick)
    expect(wrapper.get('.statusbar').text()).toContain('选择私钥文件失败，请重试。')
  })

  it('restores the previous private-key path when picker persistence fails', async () => {
    open.mockResolvedValue('/new/key')
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a', { kind: 'private_key', path: '/old/key', passphraseSecretId: null })],
      rules: [],
    }, 'save_config')

    await wrapper.get('[data-testid="choose-private-key"]').trigger('click')
    await flushPromises()

    expect((wrapper.get('[aria-label="私钥文件"]').element as HTMLInputElement).value).toBe('/old/key')
    expect(wrapper.get('.statusbar').text()).toContain('保存失败，请检查会话和规则填写是否完整。')
  })

  it('persists a selected private-key path before submitting its passphrase', async () => {
    open.mockResolvedValue('/Users/me/.ssh/id_rsa')
    const config = {
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a', { kind: 'private_key' as const, path: '', passphraseSecretId: null })],
      rules: [],
    }
    invoke.mockImplementation(async (command: string) => {
      if (command === 'load_config') return { schemaVersion: 1, ...config }
      if (command === 'secret_store_status') return { configured: true }
      if (command === 'save_session_secret') return { schemaVersion: 1, ...config }
      return undefined
    })
    listen.mockResolvedValue(() => undefined)
    const wrapper = mount(App)
    await flushPromises()
    const callsBeforePick = invoke.mock.calls.length

    await wrapper.get('[data-testid="choose-private-key"]').trigger('click')
    await flushPromises()
    await wrapper.get('[aria-label="私钥口令"]').setValue('passphrase')
    await wrapper.get('[data-testid="save-authentication"]').trigger('click')
    await flushPromises()

    const authCalls = invoke.mock.calls.slice(callsBeforePick).filter(([command]) => command === 'save_config' || command === 'save_session_secret')
    expect(authCalls.map(([command]) => command)).toEqual(['save_config', 'save_config', 'save_session_secret'])
    expect(authCalls[0][1].config.sessions[0].auth.path).toBe('/Users/me/.ssh/id_rsa')
  })

  it('uses trim only to detect blank passwords and submits nonblank whitespace verbatim', async () => {
    const config = {
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a', { kind: 'password' as const, secretId: null })],
      rules: [],
    }
    invoke.mockImplementation(async (command: string) => {
      if (command === 'load_config') return { schemaVersion: 1, ...config }
      if (command === 'secret_store_status') return { configured: true }
      if (command === 'save_session_secret') return {
        schemaVersion: 1,
        ...config,
        sessions: [session('session-a', 'group-a', { kind: 'password', secretId: 'saved-secret' })],
      }
      return undefined
    })
    listen.mockResolvedValue(() => undefined)
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.get('[aria-label="SSH 密码"]').setValue('  valid password  ')
    await wrapper.get('[data-testid="save-authentication"]').trigger('click')
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith('save_session_secret', { sessionId: 'session-a', secret: '  valid password  ' })
    expect((wrapper.get('[aria-label="SSH 密码"]').element as HTMLInputElement).value).toBe('')
  })

  it('persists config but never overwrites an existing secret with a blank draft', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a', { kind: 'password', secretId: 'existing-secret' })],
      rules: [],
    })
    await wrapper.get('[aria-label="SSH 密码"]').setValue('   ')
    const secretCallsBeforeSave = invoke.mock.calls.filter(([command]) => command === 'save_session_secret').length

    await wrapper.get('[data-testid="save-authentication"]').trigger('click')
    await flushPromises()

    expect(invoke.mock.calls.filter(([command]) => command === 'save_session_secret')).toHaveLength(secretCallsBeforeSave)
    const savedAuth = invoke.mock.calls.filter(([command]) => command === 'save_config').at(-1)![1].config.sessions[0].auth
    expect(savedAuth).toEqual({ kind: 'password', secretId: 'existing-secret' })
    expect((wrapper.get('[aria-label="SSH 密码"]').element as HTMLInputElement).value).toBe('')
  })

  it('retains the draft and reports an authentication-specific error when config saving fails', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [],
    }, 'save_config')
    await wrapper.get('[aria-label="SSH 密码"]').setValue('retry config')
    const secretCallsBeforeSave = invoke.mock.calls.filter(([command]) => command === 'save_session_secret').length

    await wrapper.get('[data-testid="save-authentication"]').trigger('click')
    await flushPromises()

    expect((wrapper.get('[aria-label="SSH 密码"]').element as HTMLInputElement).value).toBe('retry config')
    expect(wrapper.get('.statusbar').text()).toContain('保存认证配置失败，请重试。')
    expect(invoke.mock.calls.filter(([command]) => command === 'save_session_secret')).toHaveLength(secretCallsBeforeSave)
  })

  it('retains the password draft for retry and shows a specific error when secret saving fails', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [],
    }, 'save_session_secret')
    await wrapper.get('[aria-label="SSH 密码"]').setValue('retry me')

    await wrapper.get('[data-testid="save-authentication"]').trigger('click')
    await flushPromises()

    expect((wrapper.get('[aria-label="SSH 密码"]').element as HTMLInputElement).value).toBe('retry me')
    expect(wrapper.get('.statusbar').text()).toContain('保存认证凭据失败，请重试。')
  })

  it('submits the captured secret to its originating session when selection changes during config saving', async () => {
    const pendingSave = deferred()
    const config = {
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a'), session('session-b', 'group-a')],
      rules: [],
    }
    const wrapper = await mountAppWithConfig(config, [], {
      save_config: () => pendingSave.promise,
      save_session_secret: async () => ({ schemaVersion: 1, ...config }),
    })
    await wrapper.get('[aria-label="SSH 密码"]').setValue('session-a secret')
    await wrapper.get('[data-testid="save-authentication"]').trigger('click')

    await wrapper.get('[data-testid="session-child-session-b"]').trigger('click')
    await wrapper.get('[aria-label="SSH 密码"]').setValue('session-b draft')
    pendingSave.resolve()
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith('save_session_secret', { sessionId: 'session-a', secret: 'session-a secret' })
    expect((wrapper.get('[aria-label="SSH 密码"]').element as HTMLInputElement).value).toBe('session-b draft')
  })

  it('blocks authentication mode changes while config saving is pending', async () => {
    const pendingSave = deferred()
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [],
    }, [], { save_config: () => pendingSave.promise })
    await wrapper.get('[aria-label="SSH 密码"]').setValue('password secret')
    await wrapper.get('[data-testid="save-authentication"]').trigger('click')
    const selector = wrapper.get('select[aria-label="认证方式"]')
    const configCallsBeforeChange = invoke.mock.calls.filter(([command]) => command === 'save_config').length

    expect(selector.attributes('disabled')).toBeDefined()
    await selector.setValue('private_key')
    pendingSave.resolve()
    await flushPromises()

    expect(invoke.mock.calls.filter(([command]) => command === 'save_config')).toHaveLength(configCallsBeforeChange)
    expect(invoke).toHaveBeenCalledWith('save_session_secret', { sessionId: 'session-a', secret: 'password secret' })
  })

  it('blocks authentication mode changes while secret submission is pending', async () => {
    const pendingSecret = deferred<unknown>()
    const config = {
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [],
    }
    const wrapper = await mountAppWithConfig(config, [], { save_session_secret: () => pendingSecret.promise })
    await wrapper.get('[aria-label="SSH 密码"]').setValue('pending secret')
    await wrapper.get('[data-testid="save-authentication"]').trigger('click')
    await flushPromises()
    const selector = wrapper.get('select[aria-label="认证方式"]')
    const configCallsBeforeChange = invoke.mock.calls.filter(([command]) => command === 'save_config').length

    expect(selector.attributes('disabled')).toBeDefined()
    await selector.setValue('private_key')
    await flushPromises()

    expect(wrapper.get('[aria-label="SSH 密码"]')).toBeTruthy()
    expect(invoke.mock.calls.filter(([command]) => command === 'save_config')).toHaveLength(configCallsBeforeChange)

    pendingSecret.resolve({ schemaVersion: 1, ...config })
    await flushPromises()
    expect(selector.attributes('disabled')).toBeUndefined()
  })

  it('blocks generic persisted edits while secret submission is pending', async () => {
    const pendingSecret = deferred<unknown>()
    const config = {
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [],
    }
    const wrapper = await mountAppWithConfig(config, [], { save_session_secret: () => pendingSecret.promise })
    await wrapper.get('[aria-label="SSH 密码"]').setValue('pending secret')
    await wrapper.get('[data-testid="save-authentication"]').trigger('click')
    await flushPromises()
    const configCallsBeforeEdit = invoke.mock.calls.filter(([command]) => command === 'save_config').length
    const hostInput = wrapper.findAll('.editor-fields > label').find((label) => label.text().includes('主机地址'))!.get('input')

    expect(wrapper.get('[data-testid="app-interactions"]').attributes('disabled')).toBeDefined()
    await hostInput.setValue('racing.example.com')
    await hostInput.trigger('change')
    await flushPromises()

    expect(invoke.mock.calls.filter(([command]) => command === 'save_config')).toHaveLength(configCallsBeforeEdit)

    pendingSecret.resolve({
      schemaVersion: 1,
      ...config,
      sessions: [session('session-a', 'group-a', { kind: 'password', secretId: 'secret-1' })],
    })
    await flushPromises()
    expect(hostInput.element.value).toBe('localhost')
  })

  it('clears secret drafts when a different session is selected and never hydrates saved credentials', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [
        session('session-a', 'group-a', { kind: 'password', secretId: 'secret-a' }),
        session('session-b', 'group-a', { kind: 'password', secretId: 'secret-b' }),
      ],
      rules: [],
    })
    await wrapper.get('[aria-label="SSH 密码"]').setValue('session-a draft')

    await wrapper.get('[data-testid="session-child-session-b"]').trigger('click')
    expect((wrapper.get('[aria-label="SSH 密码"]').element as HTMLInputElement).value).toBe('')
    await wrapper.get('[aria-label="SSH 密码"]').setValue('session-b draft')
    await wrapper.get('[data-testid="session-child-session-a"]').trigger('click')

    expect((wrapper.get('[aria-label="SSH 密码"]').element as HTMLInputElement).value).toBe('')
  })

  it('ignores a private-key picker result when selection changes while the dialog is open', async () => {
    const pendingOpen = deferred<string | null>()
    open.mockReturnValue(pendingOpen.promise)
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [
        session('session-a', 'group-a', { kind: 'private_key', path: '/keys/a', passphraseSecretId: null }),
        session('session-b', 'group-a', { kind: 'private_key', path: '/keys/b', passphraseSecretId: null }),
      ],
      rules: [],
    })
    const savesBeforePick = invoke.mock.calls.filter(([command]) => command === 'save_config').length
    await wrapper.get('[data-testid="choose-private-key"]').trigger('click')

    await wrapper.get('[data-testid="session-child-session-b"]').trigger('click')
    pendingOpen.resolve('/keys/new-a')
    await flushPromises()

    expect((wrapper.get('[aria-label="私钥文件"]').element as HTMLInputElement).value).toBe('/keys/b')
    expect(invoke.mock.calls.filter(([command]) => command === 'save_config')).toHaveLength(savesBeforePick)
  })

  it('keeps generic session field persistence functional beside authentication editing', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [],
    })

    const hostInput = wrapper.findAll('.editor-fields > label').find((label) => label.text().includes('主机地址'))!.get('input')
    await hostInput.setValue('ssh.example.com')
    await hostInput.trigger('change')
    await flushPromises()

    const savedSession = invoke.mock.calls.filter(([command]) => command === 'save_config').at(-1)![1].config.sessions[0]
    expect(savedSession.host).toBe('ssh.example.com')
  })

  it('shows a connecting status while startup retries the local backend', async () => {
    const wrapper = mountAppWithPendingConfig()
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.statusbar').text()).toContain('正在连接本地后端')
  })

  it('shows a failed status when initialization cannot register the runtime listener', async () => {
    const wrapper = await mountAppWithListenerFailure()

    expect(wrapper.get('.statusbar').text()).toContain('无法连接本地后端')
    expect(wrapper.get('.statusbar').text()).not.toContain('无法连接本地后端。')
  })

  it('opens an application confirmation dialog before deleting a forwarding rule', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [rule('rule-a', 'session-a', 'active')],
    })

    await wrapper.get('[title="删除规则"]').trigger('click')

    expect(wrapper.get('[role="dialog"]').text()).toContain('删除转发规则')
    expect(invoke).not.toHaveBeenCalledWith('delete_rule', expect.anything())
  })

  it('stops a running rule best effort and removes it only after backend deletion succeeds', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [rule('rule-a', 'session-a', 'active')],
    })
    await wrapper.get('[title="删除规则"]').trigger('click')
    const callsBeforeConfirm = invoke.mock.calls.length

    await wrapper.get('[data-testid="confirm-dialog-action"]').trigger('click')
    await flushPromises()

    expect(invoke.mock.calls.slice(callsBeforeConfirm).map(([command]) => command)).toEqual(['stop_rule', 'delete_rule'])
    expect(invoke).toHaveBeenCalledWith('stop_rule', { ruleId: 'rule-a' })
    expect(invoke).toHaveBeenCalledWith('delete_rule', { ruleId: 'rule-a' })
    expect(wrapper.find('[title="删除规则"]').exists()).toBe(false)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('retains the rule and confirmation context when backend rule deletion fails', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [rule('rule-a', 'session-a')],
    }, 'delete_rule')
    await wrapper.get('[title="删除规则"]').trigger('click')

    await wrapper.get('[data-testid="confirm-dialog-action"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[title="删除规则"]').exists()).toBe(true)
    expect(wrapper.get('[role="dialog"]').text()).toContain('删除转发规则')
    expect(wrapper.get('.statusbar').text()).toContain('删除规则失败，请重试。')
  })

  it('continues deleting a running rule when its best-effort stop fails', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [rule('rule-a', 'session-a', 'active')],
    }, 'stop_rule')
    await wrapper.get('[title="删除规则"]').trigger('click')

    await wrapper.get('[data-testid="confirm-dialog-action"]').trigger('click')
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith('delete_rule', { ruleId: 'rule-a' })
    expect(wrapper.find('[title="删除规则"]').exists()).toBe(false)
  })

  it('keeps a failed rule deletion pending when cancel and confirm are repeated in flight', async () => {
    const pendingDelete = deferred()
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [rule('rule-a', 'session-a')],
    }, [], { delete_rule: () => pendingDelete.promise })
    await wrapper.get('[title="删除规则"]').trigger('click')
    const deletesBeforeConfirm = invoke.mock.calls.filter(([command]) => command === 'delete_rule').length

    await wrapper.get('[data-testid="confirm-dialog-action"]').trigger('click')
    const dialog = openConfirmDialog(wrapper)
    dialog.vm.$emit('close')
    dialog.vm.$emit('confirm')
    await wrapper.vm.$nextTick()

    expect(dialog.props('busy')).toBe(true)
    expect(invoke.mock.calls.filter(([command]) => command === 'delete_rule')).toHaveLength(deletesBeforeConfirm + 1)

    pendingDelete.reject(new Error('delete failed'))
    await flushPromises()
    expect(wrapper.get('[role="dialog"]').text()).toContain('删除转发规则')
    expect(wrapper.get('[title="删除规则"]')).toBeTruthy()
    expect(wrapper.get('.statusbar').text()).toContain('删除规则失败，请重试。')
  })

  it('confirms a group cascade with exact session and rule counts before deleting', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }, { id: 'group-b', name: '分组 B' }],
      sessions: [session('session-a', 'group-a'), session('session-b', 'group-a'), session('session-c', 'group-b')],
      rules: [rule('rule-a', 'session-a'), rule('rule-b', 'session-a'), rule('rule-c', 'session-c')],
    })

    await wrapper.get('[data-testid="delete-group-group-a"]').trigger('click')

    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.text()).toContain('删除分组')
    expect(dialog.text()).toContain('2 个会话')
    expect(dialog.text()).toContain('2 条转发规则')
    expect(invoke).not.toHaveBeenCalledWith('delete_group', expect.anything())
  })

  it('disconnects affected sessions best effort and removes only the confirmed group cascade', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }, { id: 'group-b', name: '分组 B' }],
      sessions: [session('session-a', 'group-a'), session('session-b', 'group-a'), session('session-c', 'group-b')],
      rules: [rule('rule-a', 'session-a'), rule('rule-c', 'session-c')],
    })
    await wrapper.get('[data-testid="delete-group-group-a"]').trigger('click')
    const callsBeforeConfirm = invoke.mock.calls.length

    await wrapper.get('[data-testid="confirm-dialog-action"]').trigger('click')
    await flushPromises()

    expect(invoke.mock.calls.slice(callsBeforeConfirm).map(([command]) => command)).toEqual([
      'disconnect_session',
      'disconnect_session',
      'delete_group',
    ])
    expect(invoke).toHaveBeenCalledWith('disconnect_session', { sessionId: 'session-a' })
    expect(invoke).toHaveBeenCalledWith('disconnect_session', { sessionId: 'session-b' })
    expect(invoke).toHaveBeenCalledWith('delete_group', { groupId: 'group-a' })
    expect(wrapper.find('[data-testid="group-toggle-group-a"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="group-toggle-group-b"]')).toBeTruthy()
    expect(wrapper.text()).toContain('会话 session-c')
    expect((wrapper.get('input[aria-label="备注"]').element as HTMLInputElement).value).toBe('rule-c')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('preserves the group cascade and pending selection when backend group deletion fails', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }, { id: 'group-b', name: '分组 B' }],
      sessions: [session('session-a', 'group-a'), session('session-b', 'group-b')],
      rules: [rule('rule-a', 'session-a')],
    }, 'delete_group')
    await wrapper.get('[data-testid="delete-group-group-a"]').trigger('click')

    await wrapper.get('[data-testid="confirm-dialog-action"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="group-toggle-group-a"]')).toBeTruthy()
    expect(wrapper.text()).toContain('会话 session-a')
    expect(wrapper.get('.session-header h1').text()).toBe('会话 session-a')
    expect(wrapper.get('[role="dialog"]').text()).toContain('删除分组')
    expect(wrapper.get('.statusbar').text()).toContain('删除分组失败，请重试。')
  })

  it('continues deleting a group when best-effort session disconnects fail', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [],
    }, 'disconnect_session')
    await wrapper.get('[data-testid="delete-group-group-a"]').trigger('click')

    await wrapper.get('[data-testid="confirm-dialog-action"]').trigger('click')
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith('delete_group', { groupId: 'group-a' })
    expect(wrapper.find('[data-testid="group-toggle-group-a"]').exists()).toBe(false)
  })

  it('keeps a failed group deletion pending when cancel and confirm are repeated in flight', async () => {
    const pendingDelete = deferred()
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [rule('rule-a', 'session-a')],
    }, [], { delete_group: () => pendingDelete.promise })
    await wrapper.get('[data-testid="delete-group-group-a"]').trigger('click')
    const deletesBeforeConfirm = invoke.mock.calls.filter(([command]) => command === 'delete_group').length

    await wrapper.get('[data-testid="confirm-dialog-action"]').trigger('click')
    await flushPromises()
    const dialog = openConfirmDialog(wrapper)
    dialog.vm.$emit('close')
    dialog.vm.$emit('confirm')
    await wrapper.vm.$nextTick()

    expect(dialog.props('busy')).toBe(true)
    expect(invoke.mock.calls.filter(([command]) => command === 'delete_group')).toHaveLength(deletesBeforeConfirm + 1)

    pendingDelete.reject(new Error('delete failed'))
    await flushPromises()
    expect(wrapper.get('[role="dialog"]').text()).toContain('删除分组')
    expect(wrapper.get('[data-testid="group-toggle-group-a"]')).toBeTruthy()
    expect(wrapper.get('.statusbar').text()).toContain('删除分组失败，请重试。')
  })

  it('uses current group membership at confirmation so concurrent additions leave no orphans', async () => {
    const newSessionId = '00000000-0000-4000-8000-000000000001'
    const newRuleId = '00000000-0000-4000-8000-000000000002'
    const randomId = vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce(newSessionId)
      .mockReturnValueOnce(newRuleId)
    try {
      const wrapper = await mountAppWithConfig({
        groups: [{ id: 'group-a', name: '分组 A' }],
        sessions: [session('session-a', 'group-a')],
        rules: [],
      })
      await wrapper.get('[data-testid="delete-group-group-a"]').trigger('click')

      await wrapper.get('.create-session').trigger('click')
      await wrapper.get('[data-testid="create-session-action"]').trigger('click')
      await wrapper.get('[data-testid="tunnel-grid"] .primary-button').trigger('click')
      await flushPromises()
      const savedConfigs = invoke.mock.calls
        .filter(([command]) => command === 'save_config')
        .map(([, args]) => args.config)
      const addedRuleId = savedConfigs.at(-1).rules[0].id
      expect(addedRuleId).toBe(newRuleId)
      const runtimeListener = listen.mock.calls.at(-1)![1]
      runtimeListener({ payload: { rules: [{ ruleId: addedRuleId, state: 'active', message: null }] } })
      await wrapper.vm.$nextTick()
      expect(wrapper.get('.statusbar').text()).toContain('1 运行中')

      await wrapper.get('[data-testid="confirm-dialog-action"]').trigger('click')
      await flushPromises()

      expect(invoke).toHaveBeenCalledWith('disconnect_session', { sessionId: newSessionId })
      expect(wrapper.get('[data-testid="empty-workspace"]')).toBeTruthy()
      expect(wrapper.get('.statusbar').text()).toContain('0 运行中')
    } finally {
      randomId.mockRestore()
    }
  })

  it('keeps session deletion as a distinct confirmation and backend operation', async () => {
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [rule('rule-a', 'session-a')],
    })
    const deleteSession = wrapper.findAll('button').find((button) => button.text() === '删除会话')

    await deleteSession!.trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('删除 SSH 会话')

    await wrapper.get('[data-testid="confirm-dialog-action"]').trigger('click')
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith('delete_session', { sessionId: 'session-a' })
    expect(wrapper.get('[data-testid="empty-workspace"]')).toBeTruthy()
  })

  it('keeps a failed session deletion pending when cancel and confirm are repeated in flight', async () => {
    const pendingDelete = deferred()
    const wrapper = await mountAppWithConfig({
      groups: [{ id: 'group-a', name: '分组 A' }],
      sessions: [session('session-a', 'group-a')],
      rules: [],
    }, [], { delete_session: () => pendingDelete.promise })
    const deleteSession = wrapper.findAll('button').find((button) => button.text() === '删除会话')
    await deleteSession!.trigger('click')
    const deletesBeforeConfirm = invoke.mock.calls.filter(([command]) => command === 'delete_session').length

    await wrapper.get('[data-testid="confirm-dialog-action"]').trigger('click')
    await flushPromises()
    const dialog = openConfirmDialog(wrapper)
    dialog.vm.$emit('close')
    dialog.vm.$emit('confirm')
    await wrapper.vm.$nextTick()

    expect(dialog.props('busy')).toBe(true)
    expect(invoke.mock.calls.filter(([command]) => command === 'delete_session')).toHaveLength(deletesBeforeConfirm + 1)

    pendingDelete.reject(new Error('delete failed'))
    await flushPromises()
    expect(wrapper.get('[role="dialog"]').text()).toContain('删除 SSH 会话')
    expect(wrapper.get('.session-header h1').text()).toBe('会话 session-a')
  })
})
