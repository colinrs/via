import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SessionSidebar from './SessionSidebar.vue'

const groups = [{
  id: 'group-a', name: '分组 A', icon: '▣',
  sessions: [{ id: 'session-a', name: 'SSH 会话', state: 'stopped' as const }],
}]

describe('SessionSidebar', () => {
  it('renders groups expanded as tree parents initially', () => {
    const wrapper = mount(SessionSidebar, { props: { groups, selectedSessionId: '' } })
    expect(wrapper.get('[data-testid="group-toggle-group-a"]').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('[data-testid="session-child-session-a"]').isVisible()).toBe(true)
  })

  it('hides and restores only the toggled group children', async () => {
    const wrapper = mount(SessionSidebar, { props: { groups, selectedSessionId: '' } })
    const toggle = wrapper.get('[data-testid="group-toggle-group-a"]')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[data-testid="session-child-session-a"]').exists()).toBe(false)
    await toggle.trigger('click')
    expect(wrapper.get('[data-testid="session-child-session-a"]').isVisible()).toBe(true)
  })

  it('reopens the parent when its session becomes selected', async () => {
    const wrapper = mount(SessionSidebar, { props: { groups, selectedSessionId: '' } })
    await wrapper.get('[data-testid="group-toggle-group-a"]').trigger('click')
    await wrapper.setProps({ selectedSessionId: 'session-a' })
    expect(wrapper.get('[data-testid="group-toggle-group-a"]').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('[data-testid="session-child-session-a"]').classes()).toContain('selected')
  })

  it('emits the group id from its delete control without toggling the group', async () => {
    const wrapper = mount(SessionSidebar, { props: { groups, selectedSessionId: '' } })

    await wrapper.get('[data-testid="delete-group-group-a"]').trigger('click')

    expect(wrapper.emitted('deleteGroup')).toEqual([['group-a']])
    expect(wrapper.get('[data-testid="group-toggle-group-a"]').attributes('aria-expanded')).toBe('true')
  })
})
