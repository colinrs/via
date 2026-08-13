# Session Sidebar Tree Design

## Goal

Present SSH sessions as an explicit, collapsible tree beneath their groups in the left sidebar.

## Interaction

- Every group heading is an interactive tree parent with a disclosure arrow, group icon, name, and session count.
- All groups are expanded on initial render.
- Selecting a group heading toggles only that group's expanded state.
- Expanded groups render their sessions as visibly indented children, with a vertical tree connector.
- Selecting a session emits the existing `select` event and ensures its parent group is expanded.
- Empty groups remain visible and can be toggled, although they have no child rows.
- Expansion state is in-memory only and resets to all-expanded after an application restart.

## Scope

The change is isolated to `SessionSidebar.vue` and its component tests. It does not change the persisted group/session model, session creation, selection API, or tunnel state display.

## Visual Rules

- The disclosure arrow rotates between expanded and collapsed states.
- Session rows keep the existing selected treatment and runtime-state indicator.
- Child session rows are indented beneath the group heading; the connector is decorative and does not affect interaction.

## Verification

- Component tests cover the all-expanded initial state, toggling a group, and selecting a session under a collapsed group.
- Existing frontend type checking and test suite remain green.
