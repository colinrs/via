import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import HostTrustDialog from './HostTrustDialog.vue'

describe('HostTrustDialog', () => {
  it('shows the full first-use fingerprint and only offers trust or cancel', () => {
    const wrapper = mount(HostTrustDialog, { props: { open: true, host: 'bastion.example', port: 22, algorithm: 'ssh-ed25519', fingerprint: 'SHA256:abc' } })
    expect(wrapper.text()).toContain('bastion.example:22')
    expect(wrapper.text()).toContain('ssh-ed25519')
    expect(wrapper.text()).toContain('SHA256:abc')
    expect(wrapper.text()).toContain('信任并连接')
  })
})
