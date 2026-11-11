/** Portal work-view v1 client. The gateway, never the browser, authorises tenant scope. */
export interface PortalSession {
  userId: string;
  tenantId: string;
  idToken: string;
  /** Explicit operator support purpose, when the gateway requires audited support reads. */
  supportReason?: string;
}
export interface PortalProject {
  id: string;
  name: string;
  status: string;
}
export interface PortalIssue {
  id: string;
  title: string;
  status: string;
  projectId: string | null;
  updatedAt: string | null;
}
export interface PortalBlocked {
  id: string;
  title: string;
  reason: string;
  updatedAt: string | null;
}
export interface PortalApproval {
  id: string;
  status: string;
  type: string | null;
  issueId: string | null;
  updatedAt: string | null;
}
export interface PortalWorkViews {
  userId: string;
  tenantId: string;
  projects: PortalProject[];
  issues: PortalIssue[];
  blocked: PortalBlocked[];
  approvals: PortalApproval[];
}
export interface PortalTransportOptions {
  /** Return the current Firebase identity and a server-authorised selected tenant. Do not cache tokens. */
  getSession: () => Promise<PortalSession | null>;
  signal?: AbortSignal;
  /** Dependency injection for contract tests only; production uses the browser fetch. */
  fetcher?: typeof fetch;
}
export class PortalBoardError extends Error {
  readonly code: 'signed_out' | 'forbidden' | 'session_changed' | 'unavailable';
  constructor(code: PortalBoardError['code']) {
    super(
      {
        signed_out: 'Sign in to view your work.',
        forbidden: 'You do not have access to this workspace.',
        session_changed:
          'Your session changed. Refresh to view the selected workspace.',
        unavailable: 'Work views are unavailable. Try refreshing.',
      }[code]
    );
    this.name = 'PortalBoardError';
    this.code = code;
  }
}
const unavailable = () => new PortalBoardError('unavailable');
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw unavailable();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 4000, nonempty = false): string {
  if (typeof value !== 'string' || value.length > max || (nonempty && !value))
    throw unavailable();
  return value;
}
const id = (value: unknown) => text(value, 200, true);
const optional = (value: unknown) => (value === null ? null : text(value));
function rows<T extends { id: string }>(
  body: unknown,
  key: string,
  convert: (item: Record<string, unknown>) => T
): T[] {
  const items = row(body)[key];
  if (!Array.isArray(items) || items.length > 5000) throw unavailable();
  const result = items.map((item) => convert(row(item)));
  if (new Set(result.map((item) => item.id)).size !== result.length)
    throw unavailable();
  return result;
}
function validateSession(value: PortalSession | null): PortalSession {
  if (!value) throw new PortalBoardError('signed_out');
  if (
    typeof value.userId !== 'string' ||
    !value.userId ||
    value.userId.length > 200 ||
    typeof value.tenantId !== 'string' ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(value.tenantId) ||
    typeof value.idToken !== 'string' ||
    !value.idToken ||
    value.idToken.length > 16000 ||
    /\s/.test(value.idToken)
  )
    throw new PortalBoardError('session_changed');
  if (
    value.supportReason !== undefined &&
    (typeof value.supportReason !== 'string' ||
      !/^[ -~]{1,200}$/.test(value.supportReason) ||
      value.supportReason.trim() !== value.supportReason)
  )
    throw new PortalBoardError('session_changed');
  // Copy the identity so a host cannot accidentally mutate the in-flight scope.
  return {
    userId: value.userId,
    tenantId: value.tenantId,
    idToken: value.idToken,
    supportReason: value.supportReason,
  };
}
async function readJson(response: Response): Promise<unknown> {
  if (response.redirected || !response.ok || response.status !== 200) {
    if (response.status === 401) throw new PortalBoardError('signed_out');
    if (response.status === 403) throw new PortalBoardError('forbidden');
    throw unavailable();
  }
  if (
    !/^application\/json(?:;|$)/i.test(
      response.headers.get('content-type') ?? ''
    ) ||
    !response.body
  )
    throw unavailable();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1_048_576) {
        void reader.cancel().catch(() => undefined);
        throw unavailable();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  ) as unknown;
}
async function readPortalWorkViews(
  options: PortalTransportOptions
): Promise<PortalWorkViews> {
  options.signal?.throwIfAborted();
  try {
    const session = validateSession(await options.getSession());
    options.signal?.throwIfAborted();
    const fetcher = options.fetcher ?? globalThis.fetch;
    const read = async (resource: string) =>
      readJson(
        await fetcher(
          `/api/v1/${resource}?tenant_id=${encodeURIComponent(session.tenantId)}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${session.idToken}`,
              Accept: 'application/json',
              ...(session.supportReason
                ? { 'X-Support-Reason': session.supportReason }
                : {}),
            },
            redirect: 'error',
            credentials: 'omit',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
            signal: options.signal,
          }
        )
      );
    const [projects, issues, blocked, approvals] = await Promise.all(
      ['projects', 'issues', 'blocked', 'approvals'].map(read)
    );
    const current = await options.getSession();
    options.signal?.throwIfAborted();
    if (
      !current ||
      current.userId !== session.userId ||
      current.tenantId !== session.tenantId ||
      current.supportReason !== session.supportReason
    )
      throw new PortalBoardError('session_changed');
    return parsePortalWorkProjection({
      userId: session.userId,
      tenantId: session.tenantId,
      projects: row(projects).projects,
      issues: row(issues).issues,
      blocked: row(blocked).blocked,
      approvals: row(approvals).approvals,
    });
  } catch (error) {
    if (options.signal?.aborted) options.signal.throwIfAborted();
    if (error instanceof PortalBoardError) throw error;
    throw unavailable();
  }
}

/** Copy a server-authorised data projection. Authentication stays in the host. */
export function parsePortalWorkProjection(input: unknown): PortalWorkViews {
  const value = row(input);
  if (
    Object.keys(value).sort().join(',') !==
    'approvals,blocked,issues,projects,tenantId,userId'
  )
    throw unavailable();
  const tenantId = text(value.tenantId, 64, true);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(tenantId)) throw unavailable();
  return {
    userId: id(value.userId),
    tenantId: tenantId,
    projects: rows(value, 'projects', (item) => ({
      id: id(item.id),
      name: text(item.name),
      status: text(item.status, 100),
    })),
    issues: rows(value, 'issues', (item) => ({
      id: id(item.id),
      title: text(item.title),
      status: text(item.status, 100),
      projectId: optional(item.projectId),
      updatedAt: optional(item.updatedAt),
    })),
    blocked: rows(value, 'blocked', (item) => ({
      id: id(item.id),
      title: text(item.title),
      reason: text(item.reason),
      updatedAt: optional(item.updatedAt),
    })),
    approvals: rows(value, 'approvals', (item) => ({
      id: id(item.id),
      status: text(item.status, 100),
      type: optional(item.type),
      issueId: optional(item.issueId),
      updatedAt: optional(item.updatedAt),
    })),
  };
}

export interface PortalProjectionOptions {
  /** Host checks its current identity and tenant before and after fetching. No tokens. */
  loadViews: (signal: AbortSignal) => Promise<unknown>;
  signal?: AbortSignal;
}

/** Bound a host's authenticated data read, including one that ignores abort. */
export async function loadPortalWorkProjection(
  options: PortalProjectionOptions
): Promise<PortalWorkViews> {
  return withPortalDeadline(options.signal, async (signal) => {
    const result = await options.loadViews(signal);
    signal.throwIfAborted();
    return parsePortalWorkProjection(result);
  });
}

/** Bound SDK token retrieval, all reads, body streams and the final identity check. */
export async function loadPortalWorkViews(
  options: PortalTransportOptions
): Promise<PortalWorkViews> {
  return withPortalDeadline(options.signal, (signal) =>
    readPortalWorkViews({ ...options, signal })
  );
}

async function withPortalDeadline<T>(
  signal: AbortSignal | undefined,
  read: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(new DOMException('Request timed out', 'TimeoutError')),
    15_000
  );
  let stopWaiting: (() => void) | undefined;
  try {
    // Install before invoking host code: a provider may synchronously invalidate scope.
    const aborted = new Promise<never>((_, reject) => {
      const rejectAbort = () => reject(controller.signal.reason);
      stopWaiting = () =>
        controller.signal.removeEventListener('abort', rejectAbort);
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
      if (controller.signal.aborted) rejectAbort();
    });
    return await Promise.race([aborted, read(controller.signal)]);
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted();
    if (error instanceof PortalBoardError) throw error;
    throw unavailable();
  } finally {
    clearTimeout(timer);
    stopWaiting?.();
    signal?.removeEventListener('abort', onAbort);
    controller.abort();
  }
}
