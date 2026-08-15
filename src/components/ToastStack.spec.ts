import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ToastStack from './ToastStack.vue'
import type { Toast } from '../stores/toast'

describe('ToastStack', () => {
  it('renders nothing when there are no toasts', () => {
    const wrapper = mount(ToastStack, { props: { toasts: [] } })
    expect(wrapper.find('[data-testid="toast-stack"]').exists()).toBe(false)
  })

  it('renders each toast message with its tone class', () => {
    const toasts: Toast[] = [
      { id: 1, message: 'Save failed', tone: 'error' },
      { id: 2, message: 'Saved', tone: 'success' },
    ]
    const wrapper = mount(ToastStack, { props: { toasts } })
    expect(wrapper.findAll('.toast')).toHaveLength(2)
    expect(wrapper.get('.toast-error').text()).toBe('Save failed')
    expect(wrapper.get('.toast-success').text()).toBe('Saved')
  })
})
