# Operator-first Vibe integration

The initial delivery is `operator-board.js` and `operator-board.css`, a **token-free renderer** for the pinned operator-readonly projection. The portal host owns Firebase, authenticated requests, UID allowlisting, race guards and the mount element. The board never receives a bearer token and makes no requests.

```js
import { mountOperatorDeploymentBoard } from './operator-board.js';
const board = mountOperatorDeploymentBoard(callerOwnedNestedElement);
board.clear(); // before refresh, logout, identity switch or a rejected request
board.render(authorisedDeploymentsBody); // only after the host's current-session guard
board.dispose(); // before removing the mount element
```

`render` validates the exact sanitized body and returns false on invalid data, clearing the previous snapshot. The body is `{observed_at, provenance, stale, items:[{deployment_id,display_name,status}]}`. All strings and arrays are bounded, extra fields and duplicate IDs rejected, and future/malformed timestamps rejected. Status is healthy/degraded/unavailable/unknown. A snapshot expires locally after 300 seconds, with focus and visibility-resume rechecks. Stale rows move to Unknown; historical replica readiness is never shown as current health.

The board explicitly reports **Kubernetes Deployment replica readiness only**, not application sign-in or successful agent execution. Customer names and identifiers come only from the server-authorized projection. Do not manufacture rows for kevinlowrie or Class101.

Host source contract: `hl-client-ux` operator entry at `6809c1059130f7b1b66a1b9e6fbab47e88de1661`, with freshness corrections in progress, and `/api/v1/operator/session` returning `{uid,role:'operator_readonly'}` plus `/api/v1/operator/deployments`. The owning portal will run at `https://thl-pclipd-api.firebaseapp.com/`. The nested mount and rollout are owned by that lane; this source does not claim live integration.

The build also produces a **separate, unactivated future task-view bundle** described below. Do not load that bundle for the operator-first release.

# Vibe board inside the authenticated portal

The portal-only bundle reads projects, active issues, blocked reasons and pending approvals through the Sprint 2 portal work-view contract. It does not use Vibe's separate cloud login or private Rust service. It never offers example actions, stores credentials/data, or registers the POC service worker.

Use Node 22.6 or newer for the scoped TypeScript tests (BillIron uses Node 24). Build with `corepack pnpm install --frozen-lockfile` and `corepack pnpm portal:build`. For the operator release, publish only `dist/portal-board/operator-board.js`, `operator-board.css`, and `manifest.json` together to the existing authenticated portal asset path. The separate `portal-board.js`/CSS task-view pair remains unactivated. The manifest records source identity and content hashes. A dirty-source build is not a release artifact.

The portal host imports `mountPortalWorkBoard` from `portal-board.js`, loads `portal-board.css`, and supplies:

- `getSession(): Promise<{ userId, tenantId, idToken } | null>`: obtain a fresh Firebase ID token from the existing SDK and the currently selected server-authorised tenant. Return null when signed out. The selection narrows the backend scope; it does not grant access.
- `onSessionChange(invalidate): unsubscribe`: synchronously call the listener on sign-out, account change, tenant selection change, or permission revocation. Update the host session snapshot before emitting the event. Include support-context changes. The board clears old data before the listener returns. Always call the mount's returned teardown function when removing the dashboard.

Mount example (host authentication functions must come from the portal, not URL parameters or local storage):

```js
import { mountPortalWorkBoard } from './portal-board.js';
const dispose = mountPortalWorkBoard(document.querySelector('#work-board'), {
  getSession: portalAuth.getCurrentAuthorisedSession,
  onSessionChange: portalAuth.subscribeToScopeChanges,
});
```

The trusted same-origin server must implement all four `GET /api/v1/{projects,issues,blocked,approvals}?tenant_id=...` routes. An optional explicit `supportReason` session field supplies the audited `X-Support-Reason` required for operator support reads. The client sends the Firebase Bearer, JSON Accept, and optional support-reason headers, omits cookies and referrers, rejects redirects, and uses no-store. The server must reverify identity and membership before resolving upstream data. No browser-side filtering is a replacement for server tenant isolation.

The operator dashboard must supply distinct, verified customer scopes. Work-card status is not deployment health. Do not mark kevinlowrie, Class101, or any customer as deployed based on this board. Do not enable a cross-tenant overview without the separate server-authorised operator contract.

This artifact is **not deployed** merely because it builds. The current source dependencies (UX PR 19 and middle PR 30) remain unmerged at initial implementation. The login owner must pin the live route contract and mount before rollout. Authenticated browser/backend acceptance and live cross-tenant rejection are release gates. The future action/replay contract remains separate work; there are no mutation controls in this slice.
