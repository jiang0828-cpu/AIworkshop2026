# Task recurrence and minute estimates

- Task forms offer non-recurring, daily, weekly and monthly labels. These describe the task; they do not create repeated task instances or reset completed tasks.
- Estimated effort is entered and displayed as whole minutes (minimum 1 minute). Existing `estimatedHours` values stay in hours in storage, converted only at the UI boundary. Daily collaboration continues to use minutes.
- Existing tasks and old backups default to `none`; full backups and sync preserve recurrence.
- Local upgrade: `npm run db:migrate:task-recurrence`, followed by `npx prisma generate` and `npm run db:generate-model-metadata`. The upgrade creates a consistent SQLite backup first and can be rerun safely. Fresh databases use `npm run db:migrate`.
- D1 migration: `cloudflare/migrations/0015_task_recurrence.sql`. Apply with the normal deployment migration workflow. No remote migration is performed by local setup.

## Verification (2026-10-15)

- 200 relevant tests passed: recurrence validation and storage, minute conversion, partial updates, SQLite/D1 backup compatibility and daily collaboration regression.
- TypeScript, source ESLint, Next.js production build and Cloudflare build passed. Migration 0015 was also applied successfully to the isolated local D1 verification database.
- Browser checks passed at 1440px, 390px and 320px: frequency selection, rejection of zero/fractional minutes, 1-minute submission, input retained after a simulated error and legacy estimate conversion. The submission check intercepted the write; no test task was added to user data.
- LAN page verified at `http://10.5.2.31:3012/?section=goals`.
- Full-repository checks have unrelated existing failures: `research/scheduler.test.ts` lacks a `retryTransientNews` mock; `eslint .` flags CommonJS imports in `output/generate-prisma-models.cjs`. Those files were not changed for this feature.
