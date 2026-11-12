# Project board proof of concept

The project route now renders a sample Project board instead of the upstream
retirement screen. Its example plan covers Pclip task updates, n8n check results,
task dependencies, and human approval. The page is a fork-local proof of
concept; it does not replace the repository's underlying issue storage or
connect to a live Pclip or n8n deployment.

## Process boundary

The UI consumes one normalized project-process snapshot through
`ProjectBoardProcessApi`. The local adapter returns example data and simulates
check results, status changes, and human approval. Selecting a task shows its
Pclip work and n8n check updates with their request references and timestamps.
Both are represented as API data; the browser does not embed either service's
dashboard or call either service directly.

## API work required to replace the example adapter

The board depends on a project task snapshot containing workflow status,
prerequisites, planned dates, check state, and approval state. The existing
`GET /api/v1/work/{work_id}` response only describes one asynchronous work
request; it cannot supply that project view. The existing `POST /api/v1/work`
does not define workflow transitions or human decisions. The API must add a
tenant-authorized project task read contract and an idempotent action contract
before this screen can use live data. See
[`project-board-contract-map.md`](./project-board-contract-map.md) and the
proposed [`project-board.openapi.yaml`](./project-board.openapi.yaml) for the
boundary and acceptance checks.

The current `thl-pclipd-api` contract is a scaffold. Its `/api/v1/work` submit
and status endpoints can represent asynchronous work, but the project list,
timeline, transition decision, and downstream n8n result shapes are not yet
defined as a deployed wire contract. Do not replace the example adapter with
live calls until those contracts and server-side transition enforcement are
implemented and verified. The project page labels its current data as an
example for this reason.

## Demonstrated boundaries

- Work cannot move to review until its required check has passed.
- Work cannot move to Ready or start until its earlier tasks are finished.
- Work cannot move to finished until the user approves it.
- Work cannot skip a project step.
- Mutations replay an identical request key and reject reuse for a different
  action in the adapter.
- The timeline highlights the selected task among its related work.

The checks are enforced in the local proof-of-concept adapter. They are not a
security boundary for real users until enforced by the authenticated server API.

## Offline request and execution path

On phones and laptops, each interface keeps a user-partitioned IndexedDB cache for
project snapshots, conversations, messages, reviewed memories, artifacts, and
an idempotent request outbox. When offline, the board saves a task action to
that outbox and labels it as saved on this device. It does not claim that a
Kubernetes job has started. Retry delivery must use the same idempotency key;
the portal API must deduplicate it and route accepted work through the
authenticated control plane. Large artifacts remain local until the API
issues an upload grant and confirms durable object storage.

The intended end-to-end route is:

1. A user submits from either client interface. While offline, the app persists
   the request, conversation turn, and stable request key; after reconnect it
   sends them to `portals.thehomelab.net`.
2. The portal API authenticates and authorizes the request, records its task,
   priority, operation ID, and artifact destination, then updates the normalized
   Pclip/n8n event stream. The portal is the only network service the phone and
   web UI call for project state and actions.
3. Client-side pclipd opens an authenticated outbound gRPC connection to its
   assigned cloud Kubernetes Pclip instance via the private mesh/secure
   loopback path. The client deployment needs no public endpoint. pclipd reports
   presence/progress and receives assignments for that instance.
4. The cloud control plane coordinates the desktop/server gang-leader through
   scoped HTTPS MCP calls across the Cloudflare mesh. The gang-leader runs the
   rootless Podman Crustly/OpenCode workers; phones and browsers never call it.
5. Pclip, n8n, and the gang-leader publish normalized progress, approval needs,
   results, and artifact references to the portal backend. `hl-client-ux` and
   `delivery` render the same versioned task/event/artifact contract and catch
   up from the same cursor. The portal stores artifact metadata and provides
   authorized links to the configured object storage.

The portal can distribute a signed client installer preconfigured with endpoint
and public trust information. It must not include private Kubernetes or
service-account keys. On launch, pclipd requires Firebase sign-in; the backend
verifies the ID token, enrolls the device, authorizes the assigned project and
instance, and provisions short-lived scoped credentials. The client stores
refresh material and device keys in the OS credential store. It then opens its
outbound gRPC connection to the assigned application service. It does not
connect to the Kubernetes API, and the phone/web portal never connects directly
to pclipd or the cluster.

This sequence is an architecture contract, not a claim that the local POC is
connected to the MCP gateway, Firebase Pub/Sub, S3-compatible storage, n8n, a
desktop gang-leader, or Kubernetes. The current adapter still supplies example
data. Those components need authenticated contracts, durable server-side
idempotency, delivery/replay semantics, and end-to-end deployment evidence
before this path can be called live. User-channel presence must be modeled as
explicit readiness/lease state; a request remains accepted/awaiting execution
until the required desktop presence and target instance report ready, and a
lease expiry must return it to a retryable state rather than losing it.
