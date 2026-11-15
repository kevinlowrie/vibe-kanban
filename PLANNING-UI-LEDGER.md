# Planning UI lane
Owner: kanban_build. Base: 37f4c09f. Branch: feat/planning-board-ui-20261115.
Kevin explicitly requested an isolated worktree; root authorized the documented local-ledger fallback. Redis remains unverified and this is not a distributed lock. Existing Antigravity/portal worktrees are untouched.
Owned paths: packages/web-core/src/pages/kanban/planning/** and scripts/*planning-board*. Scheduling contract is owned separately by chain_integration. No package manifests, auth, cloud resources or existing UI files changed.
Acceptance: project/sprint/blocker/workflow filters; date-edit and drag-to-date Gantt proposals; dependent shifts previewed; host CAS apply, explicit disconnected model/persistence; identity invalidation; stale data prevents apply. All fixture demonstrations labeled; no live worker, cloud auth or persistence claim.

## Authenticated adapter increment
Owner remains kanban_build; isolated adapter, test script and build export only.
Backend source pinned to thl-pclipd-api 4e67a25b, no deployment assumed.
Fresh Firebase/domain scope and explicit write grant required; read cannot grant write.
POST historical replay is followed by GET latest state. No synthetic metadata.
Thirteen synthetic HTTP tests pass and strict scoped TypeScript passes.
Independent review pending. Host metadata, authoritative schedule, capability source,
backend rollout and authenticated mount remain release gates.

Independent adapter review approved corrected SHA cab19a307f3ee7b527ffc75a04ed17521cca2346775e201fd22217cc682ddf50.
Final 16 synthetic adapter cases and strict TypeScript independently passed.
Existing 16 browser UI cases also pass with zero page errors.
Composition mutation, scope-invalidation races and historical replay regression
are explicitly tested. Source only; no live authorization or transaction proven.
