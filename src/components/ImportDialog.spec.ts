import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ImportDialog from './ImportDialog.vue'
describe('ImportDialog',()=>{it('never offers exporting credentials',()=>{const wrapper=mount(ImportDialog,{props:{mode:'export',open:true}});expect(wrapper.text()).toContain('不会包含密码');expect(wrapper.text()).not.toMatch(/携带凭据|导出凭据/)})})
