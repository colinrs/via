import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ImportDialog from './ImportDialog.vue'
import { withChineseI18n } from '../test/i18n'
describe('ImportDialog',()=>{it('never offers exporting credentials',()=>{const wrapper=mount(ImportDialog,{...withChineseI18n(),props:{mode:'export',open:true}});expect(wrapper.text()).toContain('不会包含密码');expect(wrapper.text()).not.toMatch(/携带凭据|导出凭据/)})
it('fills the textarea with a demo config in import mode', async () => {
  const wrapper = mount(ImportDialog, { ...withChineseI18n(), props: { mode: 'import', open: true } })
  await wrapper.get('button.fill-example').trigger('click')
  expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toContain('"schemaVersion": 1')
})

it('does not show the fill-example button in export mode', () => {
  const wrapper = mount(ImportDialog, { ...withChineseI18n(), props: { mode: 'export', open: true } })
  expect(wrapper.find('button.fill-example').exists()).toBe(false)
})})
