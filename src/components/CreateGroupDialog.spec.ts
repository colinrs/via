import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CreateGroupDialog from './CreateGroupDialog.vue'
import { withChineseI18n } from '../test/i18n'

describe('CreateGroupDialog', () => {
  it('requires a non-blank name and emits the normalized name', async () => {
    const wrapper = mount(CreateGroupDialog, {
      ...withChineseI18n(),
      props: { open: true },
    })
    const action = wrapper.get('[data-testid="create-group-action"]')
    expect((action.element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.get('input[aria-label="分组名称"]').setValue('  生产环境  ')
    await action.trigger('click')
    expect(wrapper.emitted('create')?.[0]).toEqual(['生产环境'])
  })
})
