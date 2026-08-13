import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ConfirmDialog from './ConfirmDialog.vue'

describe('ConfirmDialog', () => {
  it('emits confirm from the explicit destructive action', async () => {
    const wrapper = mount(ConfirmDialog, { props: { open: true, title: '删除会话', message: '会删除规则', confirmText: '删除' } })
    await wrapper.get('[data-testid="confirm-dialog-action"]').trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })
})
