import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const { invoke, listen } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen }))

import App from './App.vue'

function mountAppWithGroups(groups: Array<{ id: string; name: string }>) {
  invoke.mockImplementation(async (command: string) => {
    if (command === 'load_config') return { schemaVersion: 1, groups, sessions: [], rules: [] }
    return undefined
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
})
