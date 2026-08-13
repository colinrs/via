import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import EmptyWorkspace from './EmptyWorkspace.vue'

describe('EmptyWorkspace', () => {
  it('guides a new user to create their first SSH session', () => {
    const wrapper = mount(EmptyWorkspace)

    expect(wrapper.text()).toContain('还没有 SSH 会话')
    expect(wrapper.get('button').text()).toContain('新建 SSH 会话')
  })
})
