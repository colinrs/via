import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const { invoke, listen } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen }))

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

const session = (id: string, groupId: string) => ({
  id,
  groupId,
  name: `会话 ${id}`,
  host: 'localhost',
  port: 22,
  user: 'root',
  auth: { kind: 'password' as const, secretId: null },
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
