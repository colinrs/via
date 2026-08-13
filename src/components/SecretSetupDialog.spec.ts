import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SecretSetupDialog from './SecretSetupDialog.vue'

describe('SecretSetupDialog', () => {
  it('does not emit setup until matching nonblank passwords are supplied', async () => {
    const wrapper = mount(SecretSetupDialog, { props: { open: true } })
    const action = wrapper.get('[data-testid="setup-secrets-action"]')

    await wrapper.get('[aria-label="主密码"]').setValue('one')
    await wrapper.get('[aria-label="确认主密码"]').setValue('two')
    expect((action.element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.get('[aria-label="主密码"]').setValue('   ')
    await wrapper.get('[aria-label="确认主密码"]').setValue('   ')
    expect((action.element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.get('[aria-label="主密码"]').setValue('new password')
    await wrapper.get('[aria-label="确认主密码"]').setValue('new password')
    await action.trigger('click')

    expect(wrapper.emitted('setup')).toEqual([['new password']])
  })

  it('clears password fields after setup, close, and every open transition', async () => {
    const wrapper = mount(SecretSetupDialog, { props: { open: true } })
    const password = wrapper.get('[aria-label="主密码"]')
    const confirmation = wrapper.get('[aria-label="确认主密码"]')
    await password.setValue('first password')
    await confirmation.setValue('first password')
    await wrapper.get('[data-testid="setup-secrets-action"]').trigger('click')
    expect((password.element as HTMLInputElement).value).toBe('')
    expect((confirmation.element as HTMLInputElement).value).toBe('')

    await password.setValue('second password')
    await wrapper.get('[data-testid="close-secret-setup"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect((password.element as HTMLInputElement).value).toBe('')

    await password.setValue('stale password')
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    expect((wrapper.get('[aria-label="主密码"]').element as HTMLInputElement).value).toBe('')
  })

  it('marks both setup fields as new password inputs', () => {
    const wrapper = mount(SecretSetupDialog, { props: { open: true } })
    expect(wrapper.get('[aria-label="主密码"]').attributes('autocomplete')).toBe('new-password')
    expect(wrapper.get('[aria-label="确认主密码"]').attributes('autocomplete')).toBe('new-password')
  })
})
