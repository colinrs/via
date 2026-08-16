import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RecoveryCodesDialog from './RecoveryCodesDialog.vue'
import { withChineseI18n } from '../test/i18n'

describe('RecoveryCodesDialog', () => {
  it('shows one-time recovery codes as selectable text', () => {
    const wrapper = mount(RecoveryCodesDialog, {
      ...withChineseI18n(),
      props: { open: true, codes: ['A1-B2', 'C3-D4'] },
    })

    expect(wrapper.get('[aria-label="保存恢复码"]').text()).toContain(
      '仅显示一次'
    )
    expect(
      wrapper
        .findAll('[data-testid="recovery-code"]')
        .map((item) => item.text())
    ).toEqual(['A1-B2', 'C3-D4'])
    expect(
      wrapper.get('[data-testid="recovery-codes-list"]').classes()
    ).toContain('selectable')
  })

  it('only acknowledges after the checked user action and never emits a generic close', async () => {
    const wrapper = mount(RecoveryCodesDialog, {
      ...withChineseI18n(),
      props: { open: true, codes: ['A1-B2'] },
    })
    const action = wrapper.get('[data-testid="close-recovery-codes"]')
    expect((action.element as HTMLButtonElement).disabled).toBe(true)
    await action.trigger('click')
    expect(wrapper.emitted('acknowledge')).toBeUndefined()

    await wrapper.get('[aria-label="我已保存恢复码"]').setValue(true)
    await action.trigger('click')

    expect(wrapper.emitted('acknowledge')).toEqual([[true]])
    expect(wrapper.emitted('close')).toBeUndefined()
    expect((action.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not render codes while closed and resets acknowledgement when reopened', async () => {
    const wrapper = mount(RecoveryCodesDialog, {
      ...withChineseI18n(),
      props: { open: true, codes: ['A1-B2'] },
    })
    await wrapper.get('[aria-label="我已保存恢复码"]').setValue(true)
    await wrapper.setProps({ open: false })
    expect(wrapper.text()).not.toContain('A1-B2')

    await wrapper.setProps({ open: true })
    expect(
      (wrapper.get('[aria-label="我已保存恢复码"]').element as HTMLInputElement)
        .checked
    ).toBe(false)
  })

  it('offers a download action independent of the acknowledgement checkbox', async () => {
    const wrapper = mount(RecoveryCodesDialog, {
      ...withChineseI18n(),
      props: { open: true, codes: ['A1-B2'] },
    })

    const download = wrapper.get('[data-testid="download-recovery-codes"]')
    expect(download.text()).toContain('下载')
    expect((download.element as HTMLButtonElement).disabled).toBe(false)

    await download.trigger('click')
    expect(wrapper.emitted('download')).toHaveLength(1)

    expect(
      (wrapper.get('[data-testid="close-recovery-codes"]').element as HTMLButtonElement)
        .disabled
    ).toBe(true)
  })
})
