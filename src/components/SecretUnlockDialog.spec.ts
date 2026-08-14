import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SecretUnlockDialog from './SecretUnlockDialog.vue'
import { withChineseI18n } from '../test/i18n'

describe('SecretUnlockDialog', () => {
  it('emits a nonblank password from unlock mode and clears it', async () => {
    const wrapper = mount(SecretUnlockDialog, { ...withChineseI18n(), props: { open: true } })
    const password = wrapper.get('[aria-label="应用主密码"]')
    const action = wrapper.get('[data-testid="unlock-secrets-action"]')
    expect((action.element as HTMLButtonElement).disabled).toBe(true)

    await password.setValue('master password')
    await action.trigger('click')

    expect(wrapper.emitted('unlock')).toEqual([['master password']])
    expect((password.element as HTMLInputElement).value).toBe('')
    expect(password.attributes('autocomplete')).toBe('current-password')
  })

  it('emits recovery input only from recovery mode', async () => {
    const wrapper = mount(SecretUnlockDialog, { ...withChineseI18n(), props: { open: true } })
    await wrapper.get('[data-testid="show-recovery"]').trigger('click')
    expect(wrapper.emitted('mode-change')).toEqual([['recovery']])
    await wrapper.get('[aria-label="恢复码"]').setValue('code')
    await wrapper.get('[aria-label="新主密码"]').setValue('new password')
    await wrapper.get('[aria-label="确认新主密码"]').setValue('new password')
    await wrapper.get('[data-testid="recover-secrets-action"]').trigger('click')

    expect(wrapper.emitted('recover')).toEqual([['code', 'new password']])
    expect(wrapper.emitted('unlock')).toBeUndefined()
    expect((wrapper.get('[aria-label="恢复码"]').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('[aria-label="新主密码"]').element as HTMLInputElement).value).toBe('')
  })

  it('requires a code and matching nonblank replacement passwords', async () => {
    const wrapper = mount(SecretUnlockDialog, { ...withChineseI18n(), props: { open: true } })
    await wrapper.get('[data-testid="show-recovery"]').trigger('click')
    const action = wrapper.get('[data-testid="recover-secrets-action"]')

    await wrapper.get('[aria-label="恢复码"]').setValue('code')
    await wrapper.get('[aria-label="新主密码"]').setValue('one')
    await wrapper.get('[aria-label="确认新主密码"]').setValue('two')
    expect((action.element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.get('[aria-label="新主密码"]').setValue('   ')
    await wrapper.get('[aria-label="确认新主密码"]').setValue('   ')
    expect((action.element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.get('[aria-label="新主密码"]').setValue('new password')
    await wrapper.get('[aria-label="确认新主密码"]').setValue('new password')
    expect((action.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('clears every secret when switching modes, closing, or reopening', async () => {
    const wrapper = mount(SecretUnlockDialog, { ...withChineseI18n(), props: { open: true } })
    await wrapper.get('[aria-label="应用主密码"]').setValue('old password')
    await wrapper.get('[data-testid="show-recovery"]').trigger('click')
    await wrapper.get('[aria-label="恢复码"]').setValue('recovery-code')
    await wrapper.get('[aria-label="新主密码"]').setValue('new password')
    await wrapper.get('[data-testid="show-unlock"]').trigger('click')
    expect((wrapper.get('[aria-label="应用主密码"]').element as HTMLInputElement).value).toBe('')

    await wrapper.get('[aria-label="应用主密码"]').setValue('close password')
    await wrapper.get('[data-testid="close-secret-unlock"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect((wrapper.get('[aria-label="应用主密码"]').element as HTMLInputElement).value).toBe('')

    await wrapper.get('[aria-label="应用主密码"]').setValue('stale password')
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    expect((wrapper.get('[aria-label="应用主密码"]').element as HTMLInputElement).value).toBe('')
  })

  it('uses credential-specific autocomplete hints in recovery mode', async () => {
    const wrapper = mount(SecretUnlockDialog, { ...withChineseI18n(), props: { open: true } })
    await wrapper.get('[data-testid="show-recovery"]').trigger('click')
    expect(wrapper.get('[aria-label="恢复码"]').attributes('autocomplete')).toBe('one-time-code')
    expect(wrapper.get('[aria-label="新主密码"]').attributes('autocomplete')).toBe('new-password')
    expect(wrapper.get('[aria-label="确认新主密码"]').attributes('autocomplete')).toBe('new-password')
  })
})
