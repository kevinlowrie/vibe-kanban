import { validateScheduleState } from '../scheduling/contract';
import type { ScheduleState, ScheduleProposal } from '../scheduling/contract';
import type { PlanningHost, PlanningSnapshot } from './PlanningBoard';

export interface PlanningSession {
  userId: string;
  pclipDomain: string;
  idToken: string;
  /** Server-authoritative permission for schedule-main, never derived from GET success. */
  canWriteSchedule: boolean;
}
export interface AuthenticatedPlanningOptions {
  getSession(): Promise<PlanningSession | null>;
  onSessionChange(invalidate: () => void): () => void;
  /** Supply actual scoped metadata. Missing metadata must fail, never invent dates/statuses. */
  composeSnapshot(state: ScheduleState, scope: { userId: string; pclipDomain: string }, signal: AbortSignal): Promise<PlanningSnapshot>;
  /** Leave false until the host has a verified server-authoritative write capability source. */
  enableWrites?: boolean;
  fetcher?: typeof fetch;
}
const unavailable = () => new Error('Planning unavailable; refresh before retrying.');
function session(value: PlanningSession | null): PlanningSession {
  if (!value || !value.userId || typeof value.userId !== 'string' ||
      typeof value.pclipDomain !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value.pclipDomain) ||
      typeof value.idToken !== 'string' || !value.idToken || value.idToken.length > 16000 ||
      /\s/.test(value.idToken) || typeof value.canWriteSchedule !== 'boolean') throw unavailable();
  return { ...value };
}
function same(a: PlanningSession, b: PlanningSession) {
  return a.userId === b.userId && a.pclipDomain === b.pclipDomain &&
    a.canWriteSchedule === b.canWriteSchedule;
}
async function body(response: Response): Promise<ScheduleState> {
  if (response.status !== 200 || response.redirected ||
      response.headers.get('X-Planning-Contract') !== 'planning-schedule/v1' ||
      !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) throw unavailable();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1048576) { await reader.cancel(); throw unavailable(); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const state = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  validateScheduleState(state);
  return state;
}
/** Source adapter only. Host owns Firebase SDK, membership, metadata and immediate scope invalidation. */
export function createAuthenticatedPlanningHost(options: AuthenticatedPlanningOptions): PlanningHost {
  let generation = 0;
  // Retain only the latest write key, so retry after an uncertain response is idempotent.
  let pending: { scope: string; proposal: string; key: string } | undefined;
  async function request(signal: AbortSignal, proposal?: ScheduleProposal): Promise<PlanningSnapshot> {
    signal.throwIfAborted();
    const epoch = generation;
    const initial = session(await options.getSession());
    signal.throwIfAborted();
    if (epoch !== generation || (proposal && (!options.enableWrites || !initial.canWriteSchedule))) throw unavailable();
    const serialized = proposal ? JSON.stringify(proposal) : undefined;
    const scope = JSON.stringify([initial.userId, initial.pclipDomain]);
    if (serialized && (!pending || pending.scope !== scope || pending.proposal !== serialized))
      pending = { scope, proposal: serialized, key: crypto.randomUUID() };
    try {
      const response = await (options.fetcher ?? fetch)('/api/v1/planning/schedule', {
        method: proposal ? 'POST' : 'GET',
        headers: { Authorization: 'Bearer ' + initial.idToken, 'X-Pclip-Domain': initial.pclipDomain,
          Accept: 'application/json', ...(proposal ? { 'Content-Type': 'application/json', 'X-Idempotency-Key': pending!.key } : {}) },
        body: serialized, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal,
      });
      let state = await body(response);
      signal.throwIfAborted();
      const current = session(await options.getSession());
      signal.throwIfAborted();
      if (epoch !== generation || !same(initial, current)) throw unavailable();
      // A replay can return the historical committed revision: always GET current state.
      if (proposal) {
        const fresh = session(await options.getSession());
        if (epoch !== generation || !same(initial, fresh)) throw unavailable();
        const committedRevision = state.revision;
        state = await body(await (options.fetcher ?? fetch)('/api/v1/planning/schedule', {
          method: 'GET', headers: { Authorization: 'Bearer ' + fresh.idToken, 'X-Pclip-Domain': fresh.pclipDomain, Accept: 'application/json' },
          credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal,
        }));
        signal.throwIfAborted();
        const latestSession = session(await options.getSession());
        signal.throwIfAborted();
        if (epoch !== generation || !same(initial, latestSession) || state.revision < committedRevision) throw unavailable();
      }
      const authoritative = JSON.stringify(state);
      const result = await options.composeSnapshot(structuredClone(state), { userId: initial.userId, pclipDomain: initial.pclipDomain }, signal);
      signal.throwIfAborted();
      const finalSession = session(await options.getSession());
      signal.throwIfAborted();
      if (epoch !== generation || !same(initial, finalSession) ||
          JSON.stringify(result.schedule) !== authoritative) throw unavailable();
      validateScheduleState(result.schedule);
      return result;
    } catch { throw unavailable(); }
  }
  return {
    load: signal => request(signal),
    onScopeChange: callback => options.onSessionChange(() => { generation++; pending = undefined; callback(); }),
    ...(options.enableWrites ? { apply: (proposal: ScheduleProposal, signal: AbortSignal) => request(signal, proposal) } : {}),
  };
}

export interface PlanningCapabilities {
  contract: 'planning-capabilities/v1';
  canReadSchedule: boolean;
  canWriteSchedule: boolean;
}
/** Advisory authorization response, never schedule readiness or a durable permission lease.
 * Caller must discard on any identity/tenant/permission epoch change. POST reauthorizes.
 */
export async function loadPlanningCapabilities(
  value: PlanningSession, signal: AbortSignal, fetcher: typeof fetch = fetch
): Promise<PlanningCapabilities> {
  const scoped = session(value);
  signal.throwIfAborted();
  try {
    const response = await fetcher('/api/v1/planning/capabilities', {
      method: 'GET', headers: { Authorization: 'Bearer ' + scoped.idToken,
        'X-Pclip-Domain': scoped.pclipDomain, Accept: 'application/json' },
      credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal,
    });
    if (response.status !== 200 || response.redirected || !response.body ||
        !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw unavailable();
    const reader = response.body.getReader();
    const bytes: number[] = [];
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        if (bytes.length + part.value.byteLength > 1024) { await reader.cancel(); throw unavailable(); }
        bytes.push(...part.value);
      }
    } finally { reader.releaseLock(); }
    signal.throwIfAborted();
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)));
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        Object.keys(data).sort().join(',') !== 'canReadSchedule,canWriteSchedule,contract' ||
        data.contract !== 'planning-capabilities/v1' || typeof data.canReadSchedule !== 'boolean' ||
        typeof data.canWriteSchedule !== 'boolean') throw unavailable();
    return { contract: data.contract, canReadSchedule: data.canReadSchedule, canWriteSchedule: data.canWriteSchedule };
  } catch { throw unavailable(); }
}
