import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ConfigMenu from './ConfigMenu.vue'

describe('ConfigMenu', () => {
  it('toggles the menu and emits the chosen action, then closes', async () => {
    const wrapper = mount(ConfigMenu)
    expect(wrapper.find('[data-testid="config-menu"]').exists()).toBe(false)

    await wrapper.get('[data-testid="config-button"]').trigger('click')
    expect(
      wrapper.get('[data-testid="config-menu"]').findAll('button')
    ).toHaveLength(4)

    await wrapper.get('[data-testid="config-import"]').trigger('click')
    expect(wrapper.emitted('import')).toHaveLength(1)
    expect(wrapper.find('[data-testid="config-menu"]').exists()).toBe(false)
  })

  it('emits export, unlock, and settings for their menu items', async () => {
    const wrapper = mount(ConfigMenu)
    await wrapper.get('[data-testid="config-button"]').trigger('click')
    await wrapper.get('[data-testid="config-export"]').trigger('click')
    await wrapper.get('[data-testid="config-button"]').trigger('click')
    await wrapper.get('[data-testid="config-unlock"]').trigger('click')
    await wrapper.get('[data-testid="config-button"]').trigger('click')
    await wrapper.get('[data-testid="config-settings"]').trigger('click')

    expect(wrapper.emitted('export')).toHaveLength(1)
    expect(wrapper.emitted('unlock')).toHaveLength(1)
    expect(wrapper.emitted('settings')).toHaveLength(1)
  })

  it('closes on outside click', async () => {
    const wrapper = mount(ConfigMenu, { attachTo: document.body })
    await wrapper.get('[data-testid="config-button"]').trigger('click')
    expect(wrapper.find('[data-testid="config-menu"]').exists()).toBe(true)
    document.body.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="config-menu"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('closes on Escape', async () => {
    const wrapper = mount(ConfigMenu, { attachTo: document.body })
    await wrapper.get('[data-testid="config-button"]').trigger('click')
    expect(wrapper.find('[data-testid="config-menu"]').exists()).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="config-menu"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
