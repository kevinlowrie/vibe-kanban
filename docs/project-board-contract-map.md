# Project board API contract map

Status: proposed integration contract for the local Project board proof of
concept. It does not claim that these endpoints exist or that Firebase/GCE
resources have been deployed.

The machine-readable proposal is in
[`project-board.openapi.yaml`](./project-board.openapi.yaml). It describes the
same project read and task action boundary in OpenAPI 3.1.

## Current gap

The scaffold in `thl-pclipd-api` provides `POST /api/v1/work` and
`GET /api/v1/work/{work_id}`. Those operations submit and report one async work
request. They do not provide a project task list, dependency graph, schedule,
review decision, or an API-enforced workflow transition. The board therefore
uses a local adapter with example data.

## Proposed browser-facing contract

### Read a project

`GET /api/v1/projects/{project_id}/tasks`

The response should provide a stable project version and task rows with:

- task ID, plain-language title and description, owner, and workflow state;
- planned start and finish dates, with an explicit timezone;
- prerequisite task IDs;
- Pclip work and n8n check projections, each with a stable request ID, state,
  and last update time;
- check state and last update time;
- approval state and the person or role allowed to approve.

All IDs must be authorized against the signed-in user's server-owned tenant
membership. The browser must not supply or override the tenant scope.

### Request a task action

`POST /api/v1/projects/{project_id}/tasks/{task_id}/actions`

The request must carry `X-Idempotency-Key` and one action from the versioned
action set: `move_to_ready`, `start`, `request_review`, `run_check`, or
`approve_and_finish`. The API evaluates prerequisites and check results using
server-owned state. A successful long-running check returns `202` with a stable
request ID; it does not claim completion until the Pclip/n8n process result is
recorded. A rejected transition returns the standard error envelope and a
stable reason code without changing task state.

Only an authenticated person may request `approve_and_finish`. Pclip and n8n
results enter through authenticated service-side adapters and update normalized
task state; the browser receives those results through the API, never through an
embedded service dashboard or direct connection to either service.

## Mapping from the board

| Board behavior                  | API responsibility                                 | Current proof-of-concept behavior         |
| ------------------------------- | -------------------------------------------------- | ----------------------------------------- |
| Show tasks and project timeline | Return task rows, planned dates, and prerequisites | Example snapshot in local adapter         |
| Move task to Ready              | Confirm every prerequisite is finished             | Enforced by local adapter                 |
| Move task to review             | Confirm required check passed                      | Enforced by local adapter                 |
| Finish task                     | Require explicit user approval                     | Enforced by local adapter                 |
| Show Pclip/n8n progress         | Normalize signed service results into task state   | Simulated response shown as a task update |

## Contract acceptance checks

- Cross-tenant project or task IDs return `404` without revealing ownership.
- A dependent task cannot move to Ready or start while a prerequisite is
  unfinished or missing.
- Review is rejected until the required check has passed.
- Finishing is rejected until an authorized person approves the reviewed task.
- Retrying the same idempotent action returns the original result; reusing the
  key with a different body returns `409`.
- Async acceptance and process completion are distinct states.
- Every response has `X-Request-Id`; error responses use the documented
  redacted envelope.
- API tests use contract-valid Pclip/n8n fakes and do not require live Firebase,
  GCE, or downstream credentials.

## Suggested stacked delivery

The existing `thl-pclipd-api` wiring plan remains the source for its security
and shared-contract foundation. The Project board work fits after that
foundation as the next serial API slices:

1. **Project task read** — extend the planned read-surface change with the
   project task schema, schedule, prerequisites, check state, and approval
   state. Base it on the tenant-safe API and pinned shared contract.
2. **Workflow actions** — add the idempotent action endpoint and enforce
   prerequisite, check, review, and approval rules on the server. Stack it on
   the project task read change.
3. **Process result adapters** — accept authenticated Pclip/n8n status using
   versioned contracts from their owning repos. Do not connect browser code to
   either process service.
4. **Board API client** — replace the local example adapter with the typed API
   client only after slices 1–3 and their contract tests are available. Keep
   the API and UI changes in separate reviewable PRs.
5. **Deployment artifacts** — update Firebase Hosting/API configuration and GCE
   Terraform references to the agreed API origin and project. Review offline
   plans only; resource creation and apply require separate authorization.

The first two API slices belong to the existing single-owner API spine because
they share the same models and policy. Pclip/n8n contract work can proceed in
their owning repositories once the shared schema is pinned. The UI client can
then be reviewed independently against API contract fakes.

## Deployment boundary

The checked `hl-client-ux` design says Firebase resources and edge routes have
not been deployed, and the checked-in service has no Firebase Hosting app
configuration. In `hl-server-side`, the only GCE compute example found is
commented out in `infra/terraform/cloud-providers.tf.example`; existing Pclip
Terraform references concern the Pclip service-token policy, not this browser
API. There is no current Firebase/GCE deployment artifact to wire this board
into.

The API contract and local tests can be developed without initializing Firebase
or GCE. Once the API origin and hosting project are approved, add source-only
Firebase Hosting/API configuration and GCE Terraform references in their owning
repos. Do not initialize Firebase/GCP resources, run cloud apply, change DNS, or
change edge routing as part of this proof of concept.

## Runtime transport and interface synchronization

Phone and web clients only connect to the authenticated portal at
`portals.thehomelab.net`; they never connect directly to the gang-leader,
Pclip pods, Kubernetes, or Pub/Sub. The portal backend owns task requests,
priorities, normalized Pclip/n8n events, approvals, and artifact references.
Both `hl-client-ux` and `delivery` must consume the same versioned user/project
schemas and event cursor, so either interface shows the same task state,
process progress, priority, approval step, and deliverable links. Each UI may
keep a local offline cache, but the portal backend is canonical.

Client-side `pclipd` initiates an authenticated gRPC connection to its assigned
cloud Kubernetes Pclip instance through the private Cloudflare mesh/secure
loopback path. The client deployment opens no public endpoint. Cloud control
plane calls to the desktop/server gang-leader use narrowly scoped HTTPS MCP
across the Cloudflare mesh; the gang-leader then runs the local Podman worker
containers. The phone/web clients do not address that MCP server. Cloudflare
documents gRPC over private subnet routing, not public-hostname Tunnel
deployments, and warns that Access does not protect proxied gRPC. Do not put
the gRPC endpoint behind an Access reverse-proxy hostname and assume user
authentication. Use service-level identity and authorization as well as mesh
reachability.

The portal may offer a signed client installer with endpoint/protocol config
and public trust roots. It must not bundle Kubernetes, service-account,
Cloudflare tunnel, or long-lived client private keys. The client signs in via
Firebase first; the backend verifies the ID token, enrolls the device, checks
project/instance access, and provisions short-lived scoped client credentials.
Store device private keys and refresh credentials in the OS key store. Firebase
authentication proves user identity; the assigned gRPC service still authorizes
each resource/action. The client connects to the application gRPC service, never
the Kubernetes API. See the bootstrap section in
[`offline-first-design.md`](./offline-first-design.md).

The proposed OpenAPI schema describes shared operation semantics. It is not a
deployed transport implementation. Portal HTTPS API/MCP submits user intents
and reads durable state; pclipd gRPC carries client-agent presence, assignment,
progress, and result traffic to its assigned instance. Both client interfaces
must use the same idempotency key semantics, event ordering/cursors, and
artifact authorization. See [`offline-first-design.md`](./offline-first-design.md)
for the RPC shapes and transport security guidance.
