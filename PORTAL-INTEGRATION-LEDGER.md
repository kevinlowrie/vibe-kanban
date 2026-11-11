# Portal integration delivery ledger

## Ownership and coordination

Single writer: the portal integration lane owner, coordinated by the overall portal sprint owner.
Branch: `feat/portal-read-integration-20261111`; base: `cdac95447acee4b450023f35d644ed5f25e1134a`.
This repository-tracked ledger is the explicitly approved fallback. Redis is not verified and this record provides **no distributed locking**. Stop writes if an overlapping writer is detected. Existing company-spine/auth worktrees are out of scope.

## First delivery slice

Build a deployable, read-only Kanban module for the authenticated portal. The host owns Firebase authentication and tenant selection. The board receives an auth adapter; it never implements login, stores tokens, registers a service worker, or dispatches tasks. All HTTP requests use same-origin portal routes and a fresh host-supplied Firebase ID token. Tenant query scope only narrows access; the gateway remains the membership authority.

Contract inputs: `kevinlowrie/hl-client-ux` PR 19 at `d28cdaec8d4de16503c20610ed8cbd30cad72b74`; `kevinlowrie/hl-middle-mgmt` PR 30 at `96a0c81a06bb790f56c748b1912dbddcdcc8cdbf`. Neither is assumed deployed. Vibe PR 1 provides the existing proof-of-concept context; this slice does not claim its blocked private Rust dependency is solved.

Owned paths: new `packages/web-core/src/pages/kanban/portal/`, scoped build/check scripts, root package scripts, this ledger, and integration documentation. No edits to Firebase/server session code, generated Rust types, existing offline queues, or infrastructure settings.

## Acceptance agreement

- Display real portal project/issue/blocked/approval responses through a typed transport, without example fallback or fabricated workflow state.
- Reject invalid responses and redirects; show safe failures without upstream messages or credentials.
- Clear data on logout, tenant/account switch, auth refusal, refresh, and unmount; cancel/ignore stale responses.
- No unauthenticated requests, browser storage, external service calls, workflow mutation, or cross-project task mixing.
- Bundle the component and CSS for the portal host; independently test desktop/mobile flows, repeated refresh, interrupted loads, and hostile response text.
- Run exact-source checks on BillIron and obtain independent review before publishing. Source, integration, deployment and live acceptance remain separate stages.

## Current state

Implementation starting. Host login owner confirms Firebase ID token adapter, but live backend contract and portal mount are not yet pinned. No deployed acceptance claimed. Independent review is pending; reviewer will be recorded with exact reviewed revision.

## Operator-first priority update

Kevin prioritised the operator account/dashboard. The login owner pinned a sanitized operator deployment projection; implemented a separate token-free renderer and freshness tests. The operator bundle has no auth token API and no HTTP or storage. Its source contract is the operator entry commit `6809c1059130f7b1b66a1b9e6fbab47e88de1661` plus ongoing freshness fixes. The task-view bundle remains future/unactivated. Host owns mounting, real authorization and deployment; no competing edits there.

## Verification checkpoint

Red: both new contract test entrypoints failed with missing implementation at the initial base. Green: 19 unit/security tests; desktop/mobile artifact browser checks; web-core and remote-web TypeScript; repository format completed. Independent reviewer found status-array coercion and insufficient suspended-timer test coverage; string-type guard and array/object/null regressions fixed the former, wall-clock-only focus/visibility tests cover the latter. No live backend/auth acceptance claimed.

The standalone operator slice will be based directly on current `main` (`08064e043c2d78ad123b473257ed867e7ce74768`) rather than merging the private-Rust-dependency-blocked POC PR. Portal modules import no POC/offline/backend internals. Parent PR 1 stays open and unchanged.

Independent pre-commit review cleared the corrected source. Browser artifact QA passed 19 assertions, including wall-clock-only visibility/focus recovery. BillIron validation remains in progress.
