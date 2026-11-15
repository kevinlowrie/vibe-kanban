# Planning UI lane
Owner: kanban_build. Base: 37f4c09f. Branch: feat/planning-board-ui-20261115.
Kevin explicitly requested an isolated worktree; root authorized the documented local-ledger fallback. Redis remains unverified and this is not a distributed lock. Existing Antigravity/portal worktrees are untouched.
Owned paths: packages/web-core/src/pages/kanban/planning/** and scripts/*planning-board*. Scheduling contract is owned separately by chain_integration. No package manifests, auth, cloud resources or existing UI files changed.
Acceptance: project/sprint/blocker/workflow filters; date-edit and drag-to-date Gantt proposals; dependent shifts previewed; host CAS apply, explicit disconnected model/persistence; identity invalidation; stale data prevents apply. All fixture demonstrations labeled; no live worker, cloud auth or persistence claim.
