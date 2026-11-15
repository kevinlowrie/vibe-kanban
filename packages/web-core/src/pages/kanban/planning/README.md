# Planning board host integration

This standalone Vibe React module shows projects/sprints, blockers, workflows, repository/PR stage metadata and a date-only forecast Gantt. It is not a deployed customer path. There is no example fallback in the production component, browser persistence, embedded provider key or direct network call.

`mountPlanningBoard(element, host)` mounts and returns a disposer. Host supplies:

- `load(signal)` returning `PlanningSnapshot`; all in-flight data must already be scoped by authenticated server authority.
- `onScopeChange(callback)`: call synchronously when logout, tenant, identity, or permissions change; unsubscribe on disposal.
- Optional `apply(proposal, signal)` implementing server-side authorized atomic compare-and-swap at `baseRevision`, idempotency and durable auditing. Return a fresh authoritative snapshot. Without this adapter Apply is disabled. An adapter returning success is a host assertion, not independently verified receipt.
- Optional `proposeChat(message, revision, signal)` returning a schedule proposal. The host, not this bundle, selects/authorizes the language model. Proposals are validated and previewed, never silently applied. Without this adapter chat is disabled and explicitly labeled disconnected.

Snapshots must describe actual coverage and observation time. After 120 seconds, or invalid future timestamps, applying and drag proposals are disabled. Status and PR stage are metadata; dates do not mark work complete. Date editing and drag-to-date only change forecast dates, not task status/workflow definitions. Full workflow editing, durable task creation and real model integration are subsequent host/backend work, not claimed here.

Dependency scope is currently within one project. Dependencies may cross repositories represented inside that project, but cross-project dependency edges and already inconsistent schedules are rejected by the shared scheduling contract. All dates are inclusive date-only values; no time-of-day or holiday calendar inference. The 21-day Gantt is an initial window, while exact dates remain visible on cards and in the editor. Server authorization/CAS is required even though browser validation also runs.

## Verification

Run `node scripts/build-planning-board.mjs` then `PORTAL_PLAYWRIGHT_MODULE=/path/to/installed/playwright/index.mjs node scripts/test-planning-board-browser.mjs`. Browser tests use explicit synthetic identity-free fixtures and mock host/model/persistence, not real providers or workers. Build output is `dist/planning-board/PlanningBoard.js` plus CSS and must be loaded by the authenticated portal host.

Strict scoped typecheck: `node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --jsx react-jsx --lib ES2022,DOM packages/web-core/src/pages/kanban/planning/PlanningBoard.tsx`.

No new dependencies, no package manifest changes. Root Rust/private-dependency CI and live hosting are separate gates. The loopback fixture test is not a production server.

## Authenticated schedule adapter (source integration candidate)

`createAuthenticatedPlanningHost` in `authenticated-host.ts` pins backend source
`thl-pclipd-api@4e67a25bef329655382b6028af6e20a8b64789dc`:
GET/POST `/api/v1/planning/schedule`, response header
`X-Planning-Contract: planning-schedule/v1`, Firebase bearer and server-owned
`X-Pclip-Domain` membership selection. No tenant query/body override.
The host must supply fresh sessions, synchronous permission/scope invalidation,
and actual scoped metadata through `composeSnapshot`. It must not manufacture
dates or statuses. Missing authoritative schedule (503) stays unavailable.

Writes are disabled by default. Enable only when a separate server-authoritative
capability source confirms `planning.schedule.write` on `schedule-main`; read
success or membership never grants write. That capability source is not supplied
by this backend slice. POST uses an idempotency key preserved for the latest
proposal across uncertain retries; after success/replay the adapter GETs latest
state before rendering, because replay may return a historical revision.
Server limits (500 items, 100 changes, 100 dependencies/item, 256KiB canonical
payload) are stricter than local scheduling validation. Errors remain unavailable,
not successful saves. No automatic retry, provider call or browser storage.

Test: `node scripts/test-planning-authenticated-host.mjs`. These are synthetic
HTTP fixtures, not deployed Firebase acceptance. Backend rollout, authoritative
schedule seed, metadata composition, capability source and portal mount remain
integration gates.

### Capability loader
Backend source b02cf8d1969f97fa1802500ae62eb99ffedd8b3e adds
GET /api/v1/planning/capabilities. Exported loadPlanningCapabilities sends the
fresh host-provided Firebase session to that same-origin path, requires the exact
planning-capabilities/v1 body, and returns explicit read/write booleans.
The host must discard the result after any scope epoch change, including an
identity switch away and back. Pass the scope-bound AbortSignal and never cache
the result as a permission lease. The loader does not install a login listener.
Use only a current authoritative canWriteSchedule to populate PlanningSession.
False is not an error; read permission does not imply write permission.
A true capability does not prove storage, schedule readiness or successful work.
No deployed endpoint or real tenant acceptance is claimed.
