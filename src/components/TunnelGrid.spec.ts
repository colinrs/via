import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TunnelGrid from './TunnelGrid.vue'
import type { LocalForwardRule } from '../types/via'
import { withChineseI18n } from '../test/i18n'

const rules: LocalForwardRule[] = Array.from({ length: 100 }, (_, index) => ({
  id: `rule-${index}`,
  sessionId: 'session',
  enabled: true,
  localPort: 3000 + index,
  targetHost: index === 77 ? 'find-me.internal' : `target-${index}.internal`,
  targetPort: 443,
  note: `rule ${index}`,
  runtimeState: 'stopped',
}))

describe('TunnelGrid', () => {
  it('windows a large rule list and keeps search results visible', async () => {
    const wrapper = mount(TunnelGrid, { ...withChineseI18n(), props: { rules } })

    expect(wrapper.findAll('tbody tr')).toHaveLength(32)
    await wrapper.get('input[placeholder]').setValue('find-me')
    expect((wrapper.get('input[aria-label="目标主机"]').element as HTMLInputElement).value).toBe('find-me.internal')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
  })

  it('emits a rule-level toggle without treating ordinary edits as a start request', async () => {
    const wrapper = mount(TunnelGrid, { ...withChineseI18n(), props: { rules: [rules[0]] } })
    await wrapper.get('input[type="checkbox"]').setValue(false)

    expect(wrapper.emitted('toggle')?.[0][0]).toMatchObject({ id: 'rule-0', enabled: false })
    expect(wrapper.emitted('update')).toBeUndefined()
  })

  it('emits the selected rule id from its delete control', async () => {
    const wrapper = mount(TunnelGrid, { ...withChineseI18n(), props: { rules: [rules[0]] } })

    await wrapper.get('[title="删除规则"]').trigger('click')

    expect(wrapper.emitted('remove')).toEqual([['rule-0']])
  })

  it('disables start-all when disconnected and both bulk buttons while busy', () => {
    const disconnected = mount(TunnelGrid, {
      ...withChineseI18n(),
      props: { rules: [rules[0]], sessionConnected: false },
    })
    const toolbarButtons = disconnected.findAll('.toolbar-actions button')
    expect(toolbarButtons[1].attributes('disabled')).toBeDefined()
    expect(toolbarButtons[2].attributes('disabled')).toBeUndefined()

    const busy = mount(TunnelGrid, {
      ...withChineseI18n(),
      props: { rules: [rules[0]], sessionConnected: true, bulkBusy: true },
    })
    const busyButtons = busy.findAll('.toolbar-actions button')
    expect(busyButtons[1].attributes('disabled')).toBeDefined()
    expect(busyButtons[2].attributes('disabled')).toBeDefined()
  })
})
