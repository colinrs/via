import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TunnelGrid from './TunnelGrid.vue'
import type { LocalForwardRule } from '../types/via'

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
    const wrapper = mount(TunnelGrid, { props: { rules } })

    expect(wrapper.findAll('tbody tr')).toHaveLength(32)
    await wrapper.get('input[placeholder]').setValue('find-me')
    expect((wrapper.get('input[aria-label="目标主机"]').element as HTMLInputElement).value).toBe('find-me.internal')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
  })

  it('emits a rule-level toggle without treating ordinary edits as a start request', async () => {
    const wrapper = mount(TunnelGrid, { props: { rules: [rules[0]] } })
    await wrapper.get('input[type="checkbox"]').setValue(false)

    expect(wrapper.emitted('toggle')?.[0][0]).toMatchObject({ id: 'rule-0', enabled: false })
    expect(wrapper.emitted('update')).toBeUndefined()
  })
})
