# Task 3 report

- Added a per-instance Vue i18n helper with system-language resolution for `zh`, hyphenated Chinese, and underscore Chinese locale variants.
- Added exhaustive typed English and Simplified Chinese catalogs for the current UI plus the forthcoming Settings dialog. Both catalogs share one exact key union.
- Added SSR-safe document-preference application through injected window/document dependencies. It sets root language, theme/font datasets, font scale, the existing CSS color variables, and live system-theme listeners with modern and legacy cleanup support.
- RED: `npm test -- src/i18n/index.spec.ts src/preferences/document.spec.ts` failed because the modules did not exist.
- GREEN: focused tests, full `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check` passed.
