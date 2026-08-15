import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { createI18n } from '../i18n'
import type { AppPreferences } from '../stores/via'
import SettingsDialog from './SettingsDialog.vue'

const defaults: AppPreferences = {
  language: 'system',
  fontSize: 'medium',
  theme: 'system',
}

const { t } = createI18n('en')

function mountDialog(overrides: Partial<InstanceType<typeof SettingsDialog>['$props']> = {}) {
  return mount(SettingsDialog, {
    attachTo: document.body,
    props: {
      open: true,
      preferences: defaults,
      saving: false,
      masterPasswordChanging: false,
      masterPasswordConfigured: true,
      masterPasswordChangedToken: 0,
      t,
      ...overrides,
    },
  })
}

describe('SettingsDialog', () => {
  it('uses the isolated injected fallback when no explicit translator is passed', () => {
    const wrapper = mount(SettingsDialog, {
      props: {
        open: true,
        preferences: defaults,
        masterPasswordConfigured: false,
      },
    })

    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('Settings')
  })

  it('emits a complete canonical preference after each select changes', async () => {
    const wrapper = mountDialog()

    await wrapper.get('[aria-label="Font size"]').setValue('large')
    await wrapper.get('[aria-label="Language"]').setValue('zh-CN')

    expect(wrapper.emitted('updatePreferences')).toEqual([
      [{ language: 'system', fontSize: 'large', theme: 'system' }],
      [{ language: 'zh-CN', fontSize: 'medium', theme: 'system' }],
    ])
  })

  it('requires nonblank matching passwords before emitting a change request', async () => {
    const wrapper = mountDialog()
    const action = wrapper.get('[data-testid="change-master-password"]')

    await wrapper.get('[aria-label="Current master password"]').setValue('old')
    await wrapper.get('[aria-label="New master password"]').setValue('new')
    await wrapper.get('[aria-label="Confirm new master password"]').setValue('different')
    expect(action.attributes('disabled')).toBeDefined()

    await wrapper.get('[aria-label="Confirm new master password"]').setValue('new')
    expect(action.attributes('disabled')).toBeUndefined()
    await action.trigger('click')

    expect(wrapper.emitted('changeMasterPassword')).toEqual([['old', 'new']])
    expect((wrapper.get('[aria-label="Current master password"]').element as HTMLInputElement).value).toBe('old')
  })

  it('retains password fields on failure and clears them only after the success token changes', async () => {
    const wrapper = mountDialog()
    await wrapper.get('[aria-label="Current master password"]').setValue('old')
    await wrapper.get('[aria-label="New master password"]').setValue('new')
    await wrapper.get('[aria-label="Confirm new master password"]').setValue('new')
    await wrapper.get('[data-testid="change-master-password"]').trigger('click')

    await wrapper.setProps({ masterPasswordError: t('settings.changePasswordFailed') })
    expect(wrapper.text()).toContain('Could not change the master password.')
    expect((wrapper.get('[aria-label="New master password"]').element as HTMLInputElement).value).toBe('new')

    await wrapper.setProps({ masterPasswordError: '', masterPasswordChangedToken: 1 })
    expect((wrapper.get('[aria-label="Current master password"]').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('[aria-label="New master password"]').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('[aria-label="Confirm new master password"]').element as HTMLInputElement).value).toBe('')
  })

  it('clears password fields on close and every open transition', async () => {
    const wrapper = mountDialog()
    await wrapper.get('[aria-label="Current master password"]').setValue('secret')
    await wrapper.get('[data-testid="close-settings"]').trigger('click')

    expect(wrapper.emitted('close')).toEqual([[]])
    expect((wrapper.get('[aria-label="Current master password"]').element as HTMLInputElement).value).toBe('')

    await wrapper.get('[aria-label="Current master password"]').setValue('another secret')
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    expect((wrapper.get('[aria-label="Current master password"]').element as HTMLInputElement).value).toBe('')
  })

  it('hides master-password controls when no credential store is configured', () => {
    const wrapper = mountDialog({ masterPasswordConfigured: false })

    expect(wrapper.find('[data-testid="change-master-password"]').exists()).toBe(false)
  })
})
