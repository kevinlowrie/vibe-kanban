# Offline-first design decisions

## Decision

Use IndexedDB through Dexie for the browser/PWA copy. Keep the canonical account,
project workflow, dispatch, permissions, and approval state on the authenticated
API. IndexedDB is a recoverable local replica and outbox, never the authority
for whether a Kubernetes task ran. Store chat turns and artifacts locally so a
user can keep working without a network; scope every row by authenticated user
ID and clear that user's rows on sign-out/account removal. Do not copy auth
credentials into the app's offline tables or outbox; use the identity SDK's
supported session persistence. Browser profile storage is not encrypted by
this choice.

Queue commands with a client-generated idempotency key and canonical request
hash. Delivery is at least once; the server must durably deduplicate
(user/tenant, key), reject changed payloads for a reused key, and return a
stable request ID. Pull user-channel events by cursor after reconnect and
persist event + outbox state atomically. Do not promise exactly-once execution.
Persist explicit `approval_required` separately from `complete`. Cache process
timestamps as both source occurrence and local observation time; label cached
status stale while offline. Retain local artifact blobs only within the stated
size cap; upload through short-lived API-issued grants and delete/evict only
after durable remote acknowledgement or user-directed removal.

Use a service worker only for the app shell and immutable build assets. Never
cache authenticated API, OAuth, or user responses in the service worker. The
structured application cache remains in IndexedDB. This repository's proof of
concept currently adds project snapshots and queued board actions; conversation,
message, memory and artifact tables are storage primitives, not yet wired into
its chat screens. A real Pub/Sub transport, Firebase identity adapter, S3
upload service, desktop presence/lease protocol, MCP gateway, n8n adapter, and
Podman gang-leader are still required for end-to-end dispatch.

## Evidence reviewed

These projects informed the choices. They are implementation references, not
claims that any one project is identical to this product.

| Concern                         | Repositories reviewed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Pattern applied                                                                                                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser storage and sync        | [Dexie](https://github.com/dexie/Dexie.js), [RxDB](https://github.com/pubkey/rxdb), [PowerSync](https://github.com/powersync-ja/powersync-js), [ElectricSQL](https://github.com/electric-sql/electric), [TinyBase](https://github.com/tinyplex/tinybase), [Yjs](https://github.com/yjs/yjs), [Automerge](https://github.com/automerge/automerge), [AppFlowy-Collab](https://github.com/AppFlowy-IO/AppFlowy-Collab), [Dync](https://github.com/dync-corp/dync), [WebSqlSync](https://github.com/oren/WebSqlSync), [sqlite-sync](https://github.com/fhellwig/sqlite-sync)                                                                                                                                                                           | Browser-native durable cache, scoped transactions, explicit replication cursor, deterministic replay; avoid putting cloud sync logic in UI components.                                                        |
| Offline user work and artifacts | [Joplin](https://github.com/laurent22/joplin), [TriliumNext Notes](https://github.com/TriliumNext/Trilium), [Logseq](https://github.com/logseq/logseq), [Anytype](https://github.com/anyproto/anytype-ts), [LibreChat](https://github.com/danny-avila/LibreChat), [Open WebUI](https://github.com/open-webui/open-webui), [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm)                                                                                                                                                                                                                                                                                                                                                             | Keep conversation/document metadata with the local account; separate large blobs and sync state; preserve provenance and timestamps.                                                                          |
| Local AI chat and memory        | [Jan](https://github.com/janhq/jan), [Ollama](https://github.com/ollama/ollama), [GPT4All](https://github.com/nomic-ai/gpt4all), [LocalAI](https://github.com/mudler/LocalAI), [LibreChat](https://github.com/danny-avila/LibreChat), [Open WebUI](https://github.com/open-webui/open-webui), [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm), [llm-chat-vault](https://github.com/yourSQLfriend/llm-chat-vault), [local-ai-workspace](https://github.com/yourSQLfriend/local-ai-workspace), [Glaze](https://github.com/glazeai/glaze), [SuperAgent](https://github.com/superagent-ai/superagent), [Vesta](https://github.com/vesta-ai/vesta), [Memo](https://github.com/memo-ai/memo), [RAGMill](https://github.com/ragmill/ragmill) | Keep prompts/conversation history local where useful, use explicit retrieval scope and provenance, and treat generated artifacts as records with durable IDs.                                                 |
| Idempotent offline work queue   | [offline-first-pwa-crdt-sync](https://github.com/alihamzazaka/offline-first-pwa-crdt-sync), [expo-sqlite-offline-sync](https://github.com/luko13/expo-sqlite-offline-sync), [outpost](https://github.com/VitalieCondorache/outpost)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Stable client operation IDs, payload fingerprints, retry after foreground/reconnect, and cursor-based catch-up. These examples motivate server-side duplicate detection and deterministic conflict responses. |

These repositories differ in maturity and platform. The implementation borrows recurring design principles rather than importing a database or replication framework wholesale.

## Local schema and lifecycle

- `cachedProjects`: latest per-user project snapshot, cursor, and observation time.
- `processEvents`: normalized Pclip/n8n/API event projection, source time and
  local observation time.
- `conversations`, `messages`: durable local transcript with stable message IDs
  and request linkage.
- `memories`: user-reviewed items, explicit user/project scope, provenance,
  expiry; no silent promotion of arbitrary conversation text.
- `artifacts`: Blob metadata and content, digest, upload state, remote object ID.
- `outbox`: immutable command intent, request digest, retry schedule, lease,
  idempotency key, API request ID, and lifecycle state.
- `meta`: per-user event cursor and migration metadata.

On reconnect: refresh auth, publish oldest due outbox item using the original
key, record the API receipt, fetch user-channel events after the saved cursor,
apply each event and its outbox transition in one local transaction, then show
completed/failed/approval-needed status. The portal control plane records task intent, priority, process events, and
artifact destination. It coordinates pclipd and n8n state and uses HTTPS MCP
across the Cloudflare mesh to notify/coordinate the desktop gang-leader. The
client-side pclipd maintains the authenticated gRPC connection to its assigned
Kubernetes instance. Neither the phone/web clients nor the client deployment
expose an endpoint to the gang-leader or Kubernetes. The gang-leader runs
rootless Podman Crustly/OpenCode worker containers. If pclipd, its assigned
Kubernetes instance, or the required gang-leader is unavailable, retain the
request as accepted and waiting; do not claim the job has begun. Lease expiry
permits safe redelivery with the same server request identity. Completion,
progress, artifacts, and the next approval action return as normalized events
visible to both client interfaces.

## Gaps before production

1. Add the server-owned idempotency ledger and outbox-to-Pub/Sub publisher.
2. Define authenticated user-channel event schema, cursor retention, replay and
   ordering rules, and event signatures/authorization.
3. Specify desktop presence/heartbeat, work claim lease, disconnect/recovery,
   and idempotent worker command protocol.
4. Define portal-to-gang-leader MCP scopes and allowlisted pclipd-to-instance
   routing; the gang-leader accepts authorized request IDs, never arbitrary
   browser-supplied commands or cluster targets.
5. Add server-side approval actor checks and approval-required/approved events.
6. Add signed upload/download grants, S3 object metadata and retention policy.
7. Wire chat UI to local transactions so user message and outbox request commit
   atomically; currently the primitives exist but are not connected to chat.
8. Add offline account-switch, eviction, quota, retry, replay, duplicate and
   presence-loss integration coverage before calling the flow green.

## Transport decision: pclipd gRPC and portal HTTPS MCP

The phone, browser, and workers have separate trust and transport boundaries.
They do not connect directly to each other or to Kubernetes:

- **Phone/web → `portals.thehomelab.net`:** send user requests and read project,
  task, priority, event, approval, and artifact metadata through the portal's
  authenticated HTTPS API/MCP surface. The portal is the shared user-facing
  control plane. Offline clients persist requests locally and submit them to
  this portal when online; the portal returns a durable request/operation ID.
  Neither client calls a gang-leader, Pclip pod, Kubernetes API, or Pub/Sub.
- **Client-side `pclipd` → its assigned Kubernetes Pclip instance:** pclipd is
  the gRPC client/peer for that instance. It initiates an authenticated,
  encrypted gRPC connection over the private Cloudflare mesh/secure loopback
  path. The connection is outbound from the client deployment; no public
  listener or inbound port is required there. Keep the Kubernetes API and
  worker pods private. Bind pclipd to one assigned instance and verify user,
  device, workload identity, and instance authorization at the service; network
  reachability alone is not authorization. Cloudflare documents gRPC through
  private subnet routing, but not public-hostname Tunnel deployments, and says
  Access does not protect gRPC through its reverse proxy. Verify the selected
  private routing mode with a canary before rollout.
- **Cloud control plane/orchestrator → desktop/server gang-leader:** use
  narrowly scoped HTTPS MCP calls across the Cloudflare mesh. The gang-leader
  establishes its mesh reachability outward; it does not expose Podman sockets
  or a public listener. It accepts an authorized operation ID and
  policy-bounded work specification, then launches rootless Podman
  Crustly/OpenCode workers. It must reject arbitrary shell commands or
  browser-supplied cluster targets.
- **Portal events → both interfaces:** publish normalized, versioned task and
  process events through the portal backend. Both `hl-client-ux` and `delivery`
  consume the same user/project event log, schema, ordering/priority rules,
  artifact references, and cursor. The portal backend owns the canonical
  snapshot; each interface keeps its own offline cache and catches up by
  cursor. Streaming is a latency optimization, not the only copy of progress.
- **Artifacts:** the portal backend issues upload/download grants and stores
  artifact metadata/references; binaries live in the configured object store.
  Both interfaces render the same artifact record and authorization checks.

A normal browser cannot use native gRPC. Keep browser/mobile user interactions
on the portal HTTPS API/MCP endpoint. Do not add gRPC-Web unless a separate
translating proxy is deliberately introduced and Cloudflare, CORS, streaming,
and auth behavior are canary-verified. Native gRPC is specifically the
pclipd-to-assigned-Kubernetes path, not a phone/web-to-cluster path.

### Download, Firebase sign-in, and device credential bootstrap

`portals.thehomelab.net` may distribute a signed pclipd/client installer and
its non-secret bootstrap profile: portal URL, assigned gRPC service identity or
resolver, protocol version, and public CA roots/pins. “Ready to connect” means
preconfigured—not preloaded with reusable K8s keys. Never place a Kubernetes
client certificate/private key, service-account JSON key, Pub/Sub credential,
Cloudflare tunnel token, MCP bearer token, or Firebase refresh token in the
installer, browser bundle, or downloadable config. A client binary can be
copied, so any embedded private credential would be immediately shareable.

On first launch, the client opens the Firebase sign-in flow. After sign-in,
pclipd obtains a current Firebase ID token and sends it over verified TLS to
the portal/device-enrollment service. That server verifies the token using
Firebase verification rules and derives the UID from verified claims; it must
not trust a client-supplied UID. pclipd generates a device key locally in the
OS credential store and proves possession using the existing
[`client-enrollment-v1`](https://github.com/kevinlowrie/homelab/blob/main/docs/contracts/client-enrollment-v1.md)
flow. Enrollment approval binds that device to the verified owner, project,
and assigned-instance policy. Reuse the existing enrollment/proof protocol;
do not invent a competing certificate issuer in this board design.

After approval, the server grants only the client identity needed by the
application gRPC API. It issues no kubeconfig, K8s service-account key, cluster
join token, provider key, Pub/Sub credential, or Cloudflare tunnel token. Keep
native private keys and refresh credentials in the OS credential store, not in
app-owned IndexedDB tables, local config, or logs. Support revocation and
rotation. Before relying on device mTLS, verify that the chosen route preserves
it end to end. The current cloud-client design warns Cloudflare Tunnel can
terminate TLS at the edge; on that route, use the documented device
proof-of-possession / short-lived bearer approach unless end-to-end mTLS is
proven. In either case the gRPC service validates device and current Firebase
user identity, then authorizes each resource/action. Firebase sign-in alone
does not authorize every K8s instance or task.

Where the gRPC service needs Google Cloud API access, keep that service identity
on the cloud workload and use attached workload identity / Workload Identity
Federation for external workloads. Do not distribute Google service-account
keys to client devices. The app talks to the assigned application gRPC service,
never to the Kubernetes API. The local pclipd MCP endpoint, if exposed to a
local UI, binds only to loopback and enforces local origin/auth checks. The
portal UI continues to use the portal's authenticated HTTPS API/MCP endpoint.

For HTTP MCP, satisfy the MCP OAuth protected-resource requirements. Firebase
can remain the user sign-in authority; use a deliberate OIDC/OAuth integration
or token exchange that yields a short-lived token intended for the MCP resource
and requested scopes. Do not assume a Firebase ID token, Cloudflare Access
cookie, or service token can be forwarded to every MCP endpoint. Authenticate
the mesh caller separately and preserve the delegated user identity in a
verifiable, audience-bound claim.

### RPC and MCP shapes

Use resource-oriented operations first, then custom actions for workflow
transitions. The pclipd-to-instance gRPC service can expose `ConnectClient`,
`ReportPresence`, `ReceiveAssignments`, `ReportProgress`, and
`ReportResult`. The portal HTTPS API/MCP surface exposes user operations such as
`submit_request`, `get_operation`, `approve_operation`, and `cancel_operation`;
requests carry an immutable client request ID/idempotency key, project/task
resource names, a target-instance reference chosen from the user's authorized
set, and a versioned typed intent. Submit returns an operation/request resource
as accepted; it does not wait for Crustly work to finish. `GetOperation` is the
recovery path and returns queued, waiting-for-presence, running, approval
required, succeeded, failed, cancelled, or expired state with timestamps,
progress sequence, and artifact references. Use protobuf definitions as the
canonical gRPC contract and keep the proposed OpenAPI schema semantically
aligned; generate both bindings from a shared schema where practical.

Expose the matching MCP tools as narrow verbs such as `submit_request`,
`get_operation`, `approve_operation`, and `cancel_operation`, plus read-only
project and event resources. `submit_request` returns the same operation ID
and accepted state as gRPC. Do not put arbitrary filesystem, shell, Kubernetes
exec, or Podman controls into the general user MCP server. Publish deterministic
tool ordering, versioned JSON Schemas and stable resource URIs. Approval is a
separate, authenticated user action; a tool annotation or model confirmation
alone is not authorization. A disconnected Streamable HTTP/SSE client must
reconnect/catch up using durable event IDs; a dropped stream must never cancel
or duplicate an accepted operation.

### Reliability and authorization rules

- Give every mutating client intent a durable idempotency key before it leaves
  the device. Enforce uniqueness by authenticated principal + tenant + key and
  compare a canonical payload digest. Same key/same intent returns the original
  operation; same key/different intent returns a conflict. Keep the server
  ledger for at least the maximum supported offline retry horizon.
- Apply gRPC deadlines to every call. Retry only transient statuses with
  bounded exponential backoff and jitter; never retry mutation on transport
  status alone without replaying the exact same key and payload. Treat client
  cancellation as cancellation only when an explicit cancel method succeeds.
  Reuse channels/stubs. Configure keepalive only with server agreement; mobile
  apps should not ping aggressively in the background.
- Use TLS everywhere. Authenticate application identity and user identity at
  the service boundary; authorize per project, target K8s instance, and action.
  Bind bearer tokens to the intended resource/audience, use short lifetimes and
  refresh through the identity provider, and never persist refresh/access
  tokens in IndexedDB or the outbox. Cloudflare's network path is not a
  replacement for user authorization. For Streamable HTTP MCP, follow its
  OAuth protected-resource authorization, explicit allowed origins, Host/
  Origin validation, and narrow scopes. Do not forward one resource's token to
  another MCP server; use audience-appropriate delegated credentials.
- Put a transactional API outbox beside the authoritative operation write;
  publish to Pub/Sub asynchronously. Assume Pub/Sub redelivery and duplicate
  publishes. Use a durable subscriber inbox/operation-key check before a
  worker side effect, acknowledge only after the claim/result is durably
  recorded, and use dead-letter handling for exhausted delivery. Consider
  ordering keys by operation or project only where workflow ordering is
  required. Pub/Sub exactly-once is only available to pull subscriptions and
  does not replace application idempotency or cover duplicate publisher
  intents.
- Model online presence as expiring leases: desktop advertises signed-in
  device ID, supported worker profile and current readiness; cloud task remains
  `waiting_for_presence` until a lease is valid. Claim with a server-issued
  fencing/lease token, renew while running, and stop or reconcile on expiry.
  Progress sequence numbers prevent old workers overwriting newer state.
- Keep authorization and approvals server-side. Store only opaque operation
  IDs and safe metadata in logs; redact prompts, file contents, bearer tokens,
  and command arguments. Enforce allowed command templates, working roots,
  resource limits, rootless containers, and artifact allowlists at the
  gang-leader.

This design follows Cloudflare's documented gRPC routing limits and Tunnel
model, gRPC's browser-specific proxy requirement and retry/keepalive guidance,
Google's resource-oriented API and long-running operation patterns, Pub/Sub's
at-least-once defaults, and MCP's Streamable HTTP and OAuth security rules:
[Cloudflare gRPC connections](https://developers.cloudflare.com/network/grpc-connections/),
[Cloudflare Tunnel gRPC](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/use-cases/grpc/),
[Cloudflare Tunnel fundamentals](https://developers.cloudflare.com/tunnel/concepts/),
[gRPC-Web](https://grpc.io/docs/platforms/web/basics/),
[gRPC retries](https://grpc.io/docs/guides/retry/),
[gRPC keepalive](https://grpc.io/docs/guides/keepalive/),
[Google AIP-130 methods](https://google.aip.dev/130),
[Google AIP-151 long-running operations](https://google.aip.dev/151),
[Google Pub/Sub best practices](https://cloud.google.com/pubsub/docs/subscribe-best-practices),
[MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
[MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization),
[Firebase ID token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens),
[Google Workload Identity Federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation).
