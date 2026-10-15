# System scene

The shared scene list now includes System (slot 6, displayed as `系统`) after the existing six scenes. Stable slots, IDs, custom names and ordering are retained. System has its own profile fields and vision; filters, entity editors, task inheritance, daily collaboration, AI context, Markdown, backup and sync use the shared list.

## Upgrade

- Local: `npm run db:migrate:system-scene`. The command makes a consistent SQLite backup before applying `0017_system_scene.sql`. Repeated migration does not duplicate scenes.
- Fresh local setup: `npm run db:migrate` also runs this migration.
- D1: apply `cloudflare/migrations/0017_system_scene.sql` through the normal migration workflow. Only an isolated local D1 database was migrated during verification; no production or remote migration was performed.
- Old four/five/six-scene backups are accepted and missing scenes are added. Six-scene planning snapshots remain readable without rewriting their history. New AI plans validate against the scenes actually supplied in their context.

## Verification

- Strategy integration: 161 tests passed, including SQLite and simulated D1 upgrade, idempotence, rename/order preservation, scene inheritance and full/profile backup restore.
- Execution planning: 18 tests passed. The additional legacy six-scene snapshot assertion passed in a focused rerun.
- Other relevant tests: 89 passed, including profile AI, system profile layout, vision parsing, daily collaboration and delivery-based plan/review drafts.
- TypeScript, source ESLint, Next.js production build and Cloudflare build passed. Cloudflare requires the standard `.next` output directory in this installed OpenNext version.
- Browser: System selected in workbench, self, goals, actions, daily collaboration and situation information filters. Goal/project/action form selection verified without saving test data. Screenshots checked at 1440, 390 and 320px. LAN verified at `http://10.5.2.31:3012/`.

The plan/review screen reads project and task delivery dates and opens editable review drafts; original business records remain the source of truth.
