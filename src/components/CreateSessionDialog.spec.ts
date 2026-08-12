import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CreateSessionDialog from './CreateSessionDialog.vue'

describe('CreateSessionDialog', () => {
  it('emits the selected group id when the user confirms', async () => {
    const wrapper = mount(CreateSessionDialog, {
      props: { open: true, groups: [{ id: 'ops', name: '运维' }, { id: 'prod', name: '生产' }] },
    })
    await wrapper.get('select[aria-label="所属分组"]').setValue('prod')
    await wrapper.get('[data-testid="create-session-action"]').trigger('click')
    expect(wrapper.emitted('create')).toEqual([['prod']])
  })
})
