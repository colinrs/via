# Task 3 report

- Added a per-instance Vue i18n helper with system-language resolution for `zh`, hyphenated Chinese, and underscore Chinese locale variants.
- Added exhaustive typed English and Simplified Chinese catalogs for the current UI plus the forthcoming Settings dialog. Both catalogs share one exact key union.
- Added SSR-safe document-preference application through injected window/document dependencies. It sets root language, theme/font datasets, font scale, the existing CSS color variables, and live system-theme listeners with modern and legacy cleanup support.
- RED: `npm test -- src/i18n/index.spec.ts src/preferences/document.spec.ts` failed because the modules did not exist.
- GREEN: focused tests, full `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check` passed.

## Review fix round 1

- Added parameter-aware `t(key, params)` typing. Placeholder keys are inferred from the English catalog; missing, extra, or interpolation-free parameters fail TypeScript checks. Runtime tests verify group-deletion and tunnel-status substitutions in both languages.
- Completed the remaining current UI catalog surface, including the TunnelGrid Status/Toggle/Actions headers, the dynamic delete-group accessible label, and action-progress copy.
- Root theme application now sets `color: var(--text)` and `background-color: var(--canvas)` alongside token updates, so unstyled inherited text and canvas colors switch correctly in light mode.
- Added explicit-theme zero-listener assertions and legacy `addListener`/`removeListener` live-update, idempotent-cleanup coverage.
- Verification: focused tests (9), full `npm test` (122), `npm run typecheck`, `npm run build`, and `git diff --check` passed.

## Review fix round 2

- Re-inventoried the current UI literals and added semantically exact Create Group/Create Session title and confirmation-action keys, the Recovery Codes checkbox aria label, and text-only New SSH Session/New Group labels. Icons remain presentation-only for the later template migration.
- Added catalog assertions for those exact English and Simplified Chinese strings.
- Strengthened interpolation typing with an `Exact` parameter constraint. Extra keys are rejected for both object literals and variables while JavaScript callers safely ignore unknown values at runtime.
- Verification: focused i18n tests (6), full `npm test` (123), `npm run typecheck`, `npm run build`, and `git diff --check` passed.
