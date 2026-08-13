import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RecoveryCodesDialog from './RecoveryCodesDialog.vue'

describe('RecoveryCodesDialog', () => {
  it('shows one-time recovery codes as selectable text', () => {
    const wrapper = mount(RecoveryCodesDialog, { props: { open: true, codes: ['A1-B2', 'C3-D4'] } })

    expect(wrapper.get('[aria-label="保存恢复码"]').text()).toContain('仅显示一次')
    expect(wrapper.findAll('[data-testid="recovery-code"]').map((item) => item.text())).toEqual(['A1-B2', 'C3-D4'])
    expect(wrapper.get('[data-testid="recovery-codes-list"]').classes()).toContain('selectable')
  })

  it('only closes after explicit acknowledgement', async () => {
    const wrapper = mount(RecoveryCodesDialog, { props: { open: true, codes: ['A1-B2'] } })
    const action = wrapper.get('[data-testid="close-recovery-codes"]')
    expect((action.element as HTMLButtonElement).disabled).toBe(true)
    await action.trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()

    await wrapper.get('[aria-label="我已保存恢复码"]').setValue(true)
    await action.trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect((action.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not render codes while closed and resets acknowledgement when reopened', async () => {
    const wrapper = mount(RecoveryCodesDialog, { props: { open: true, codes: ['A1-B2'] } })
    await wrapper.get('[aria-label="我已保存恢复码"]').setValue(true)
    await wrapper.setProps({ open: false })
    expect(wrapper.text()).not.toContain('A1-B2')

    await wrapper.setProps({ open: true })
    expect((wrapper.get('[aria-label="我已保存恢复码"]').element as HTMLInputElement).checked).toBe(false)
  })
})
