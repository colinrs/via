import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ConfirmDialog from './ConfirmDialog.vue'

describe('ConfirmDialog', () => {
  it('emits confirm from the explicit destructive action', async () => {
    const wrapper = mount(ConfirmDialog, { props: { open: true, title: '删除会话', message: '会删除规则', confirmText: '删除' } })
    await wrapper.get('[data-testid="confirm-dialog-action"]').trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('disables cancellation and repeated confirmation while busy', async () => {
    const wrapper = mount(ConfirmDialog, {
      props: { open: true, title: '删除会话', message: '会删除规则', confirmText: '删除', busy: true },
    })

    const buttons = wrapper.findAll('button')
    expect(wrapper.get('[role="dialog"]').attributes('aria-busy')).toBe('true')
    expect(buttons[0].attributes('disabled')).toBeDefined()
    expect(buttons[1].attributes('disabled')).toBeDefined()
    expect(buttons[1].text()).toBe('删除中…')

    await buttons[0].trigger('click')
    await buttons[1].trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })
})
