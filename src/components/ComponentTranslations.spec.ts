import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ConfirmDialog from './ConfirmDialog.vue'
import CreateGroupDialog from './CreateGroupDialog.vue'
import CreateSessionDialog from './CreateSessionDialog.vue'
import EmptyWorkspace from './EmptyWorkspace.vue'
import HostTrustDialog from './HostTrustDialog.vue'
import ImportDialog from './ImportDialog.vue'
import RecoveryCodesDialog from './RecoveryCodesDialog.vue'
import SecretSetupDialog from './SecretSetupDialog.vue'
import SecretUnlockDialog from './SecretUnlockDialog.vue'
import SessionSidebar from './SessionSidebar.vue'
import TunnelGrid from './TunnelGrid.vue'

describe('translated component copy', () => {
  it('translates confirmation cancellation and pending action copy', () => {
    const wrapper = mount(ConfirmDialog, {
      props: { open: true, title: 'Delete item', message: 'Permanent.', confirmText: 'Delete', busy: true },
    })

    expect(wrapper.findAll('button')[0].text()).toBe('Cancel')
    expect(wrapper.get('[data-testid="confirm-dialog-action"]').text()).toBe('Delete in progress…')
  })

  it('translates group and session creation controls and accessible labels', () => {
    const group = mount(CreateGroupDialog, { props: { open: true } })
    const session = mount(CreateSessionDialog, {
      props: { open: true, groups: [{ id: 'group', name: 'Production' }] },
    })

    expect(group.get('[role="dialog"]').attributes('aria-label')).toBe('New group')
    expect(group.get('input').attributes('aria-label')).toBe('Group name')
    expect(group.get('[data-testid="create-group-action"]').text()).toBe('Create group')
    expect(session.get('[role="dialog"]').attributes('aria-label')).toBe('New session')
    expect(session.get('select').attributes('aria-label')).toBe('Group')
    expect(session.get('[data-testid="create-session-action"]').text()).toBe('Create session')
  })

  it('translates empty-workspace and host-trust copy without changing host details', () => {
    const empty = mount(EmptyWorkspace)
    const trust = mount(HostTrustDialog, {
      props: { open: true, host: 'bastion.example', port: 22, algorithm: 'ssh-ed25519', fingerprint: 'SHA256:abc' },
    })

    expect(empty.text()).toContain('No SSH sessions yet')
    expect(empty.get('button').text()).toContain('New SSH session')
    expect(trust.get('[role="dialog"]').attributes('aria-label')).toBe('Confirm SSH host fingerprint')
    expect(trust.text()).toContain('Trust and connect')
    expect(trust.text()).toContain('bastion.example:22')
    expect(trust.text()).toContain('SHA256:abc')
  })

  it('translates import/export explanatory and form copy', () => {
    const exported = mount(ImportDialog, { props: { open: true, mode: 'export', exportJson: '{"schemaVersion":1}' } })
    const imported = mount(ImportDialog, { props: { open: true, mode: 'import' } })

    expect(exported.get('[role="dialog"]').attributes('aria-label')).toBe('Export configuration')
    expect(exported.text()).toContain('They never include passwords')
    expect(exported.get('textarea').attributes('aria-label')).toBe('Configuration JSON')
    expect(imported.get('textarea').attributes('placeholder')).toBe('Paste JSON configuration')
    expect(imported.text()).toContain('Merge import')
  })

  it('translates recovery, setup, unlock, and recovery-mode credential forms', async () => {
    const codes = mount(RecoveryCodesDialog, { props: { open: true, codes: ['CODE-1'] } })
    const setup = mount(SecretSetupDialog, { props: { open: true } })
    const unlock = mount(SecretUnlockDialog, { props: { open: true } })

    expect(codes.get('[role="dialog"]').attributes('aria-label')).toBe('Save recovery codes')
    expect(codes.get('input').attributes('aria-label')).toBe('I saved the recovery codes')
    expect(setup.get('[role="dialog"]').attributes('aria-label')).toBe('Set up local credentials')
    expect(setup.get('input').attributes('aria-label')).toBe('Master password')
    expect(unlock.get('[role="dialog"]').attributes('aria-label')).toBe('Unlock local credentials')
    expect(unlock.get('input').attributes('aria-label')).toBe('App master password')

    await unlock.get('[data-testid="show-recovery"]').trigger('click')
    expect(unlock.text()).toContain('Recover local credentials')
    expect(unlock.get('input').attributes('aria-label')).toBe('Recovery code')
  })

  it('translates sidebar controls and status accessibility copy', () => {
    const wrapper = mount(SessionSidebar, {
      props: {
        selectedSessionId: '',
        groups: [{ id: 'group', name: 'Production', icon: '▣', sessions: [{ id: 'session', name: 'Bastion', state: 'stopped' }] }],
      },
    })

    expect(wrapper.get('nav').attributes('aria-label')).toBe('SSH sessions')
    expect(wrapper.get('[data-testid="delete-group-group"]').attributes('aria-label')).toBe('Delete group Production')
    expect(wrapper.get('[data-testid="delete-group-group"]').attributes('title')).toBe('Delete group')
    expect(wrapper.get('.session-indicator').attributes('aria-label')).toBe('Stopped')
  })

  it('translates tunnel table, fields, state labels, actions, and diagnostics', () => {
    const wrapper = mount(TunnelGrid, {
      props: {
        rules: [{
          id: 'rule', sessionId: 'session', enabled: true, localPort: 3000, targetHost: 'internal',
          targetPort: 443, note: '', runtimeState: 'conflict',
        }],
      },
    })

    expect(wrapper.get('input[placeholder]').attributes('placeholder')).toBe('Search ports, target hosts, or notes')
    expect(wrapper.findAll('th').map((cell) => cell.text())).toEqual(['Status', 'Toggle', 'Local port', 'Target host', 'Target port', 'Note', 'Actions'])
    expect(wrapper.get('.state').text()).toContain('Port conflict')
    expect(wrapper.get('input[aria-label="Target host"]')).toBeTruthy()
    expect(wrapper.get('[title="Clone this rule"]')).toBeTruthy()
    expect(wrapper.get('[title="Delete rule"]')).toBeTruthy()
    expect(wrapper.get('.diagnostic').text()).toContain('The local port is already in use')
  })
})
