export interface ScheduleItem {
  id: string;
  projectId: string;
  title: string;
  startDate: string;
  endDate: string;
  dependsOn: string[];
}
export interface ScheduleState {
  revision: number;
  items: ScheduleItem[];
}
export interface ScheduleDates {
  startDate: string;
  endDate: string;
}
export interface ScheduleChange {
  id: string;
  before: ScheduleDates;
  after: ScheduleDates;
}
export interface ScheduleProposal {
  baseRevision: number;
  changes: ScheduleChange[];
}
export interface RescheduleRequest extends ScheduleDates {
  itemId: string;
  shiftDependents: boolean;
}
export type ScheduleErrorCode =
  | 'INVALID_STATE'
  | 'INVALID_DATE'
  | 'INVALID_DURATION'
  | 'DUPLICATE_ID'
  | 'MISSING_DEPENDENCY'
  | 'CROSS_PROJECT_DEPENDENCY'
  | 'CYCLE'
  | 'DEPENDENCY_VIOLATION'
  | 'STALE_REVISION'
  | 'INVALID_PROPOSAL'
  | 'ITEM_NOT_FOUND';
export class ScheduleError extends Error {
  readonly code: ScheduleErrorCode;
  constructor(code: ScheduleErrorCode) {
    super(code);
    this.name = 'ScheduleError';
    this.code = code;
  }
}
const DAY = 86_400_000;
const fail = (code: ScheduleErrorCode): never => {
  throw new ScheduleError(code);
};
function object(
  value: unknown,
  keys: string[],
  code: ScheduleErrorCode
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).length !== keys.length ||
    keys.some((k) => !descriptors[k] || !('value' in descriptors[k]))
  )
    return fail(code);
  return Object.fromEntries(keys.map((k) => [k, descriptors[k].value]));
}
function text(value: unknown, limit: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= limit &&
    value.trim().length > 0 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
function day(value: unknown): number {
  if (
    typeof value !== 'string' ||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) ||
    value.startsWith('0000-')
  )
    return fail('INVALID_DATE');
  const ms = Date.parse(value + 'T00:00:00.000Z');
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value)
    return fail('INVALID_DATE');
  return ms / DAY;
}
function date(value: number): string {
  if (!Number.isInteger(value)) return fail('INVALID_DATE');
  const ms = value * DAY;
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15)
    return fail('INVALID_DATE');
  const result = new Date(ms).toISOString().slice(0, 10);
  day(result);
  return result;
}
function dates(value: unknown, code: ScheduleErrorCode): ScheduleDates {
  const v = object(value, ['startDate', 'endDate'], code);
  if (day(v.endDate) < day(v.startDate)) return fail('INVALID_DURATION');
  return { startDate: v.startDate as string, endDate: v.endDate as string };
}
function revision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function inspect(state: ScheduleState): ScheduleItem[] {
  const s = object(state, ['revision', 'items'], 'INVALID_STATE');
  if (!revision(s.revision) || !Array.isArray(s.items) || s.items.length > 1000)
    return fail('INVALID_STATE');
  const byId = new Map<string, ScheduleItem>();
  for (const raw of s.items) {
    const v = object(
      raw,
      ['id', 'projectId', 'title', 'startDate', 'endDate', 'dependsOn'],
      'INVALID_STATE'
    );
    if (
      !text(v.id, 128) ||
      !text(v.projectId, 128) ||
      !text(v.title, 500) ||
      !Array.isArray(v.dependsOn) ||
      v.dependsOn.length > 1000 ||
      v.dependsOn.some((x) => !text(x, 128)) ||
      new Set(v.dependsOn).size !== v.dependsOn.length
    )
      return fail('INVALID_STATE');
    dates({ startDate: v.startDate, endDate: v.endDate }, 'INVALID_STATE');
    if (byId.has(v.id)) return fail('DUPLICATE_ID');
    byId.set(v.id, raw);
  }
  const remaining = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const item of byId.values()) {
    remaining.set(item.id, item.dependsOn.length);
    for (const id of item.dependsOn) {
      const predecessor = byId.get(id);
      if (!predecessor) return fail('MISSING_DEPENDENCY');
      if (predecessor.projectId !== item.projectId)
        return fail('CROSS_PROJECT_DEPENDENCY');
      const list = children.get(id) ?? [];
      list.push(item.id);
      children.set(id, list);
    }
  }
  const queue = [...byId.values()]
    .filter((x) => !x.dependsOn.length)
    .map((x) => x.id);
  const ordered: ScheduleItem[] = [];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    ordered.push(byId.get(id)!);
    for (const child of children.get(id) ?? []) {
      const count = remaining.get(child)! - 1;
      remaining.set(child, count);
      if (!count) queue.push(child);
    }
  }
  if (ordered.length !== byId.size) return fail('CYCLE');
  for (const item of ordered)
    for (const dependency of item.dependsOn) {
      if (day(item.startDate) <= day(byId.get(dependency)!.endDate))
        return fail('DEPENDENCY_VIOLATION');
    }
  return ordered;
}
/** Date-only UTC-day validation. No persistence, network or status semantics. */
export function validateScheduleState(state: ScheduleState): void {
  inspect(state);
}
const clone = (state: ScheduleState): ScheduleState => ({
  revision: state.revision,
  items: state.items.map((x) => ({ ...x, dependsOn: [...x.dependsOn] })),
});
const snapshot = (item: ScheduleItem): ScheduleDates => ({
  startDate: item.startDate,
  endDate: item.endDate,
});
export function proposeReschedule(
  state: ScheduleState,
  request: RescheduleRequest,
  expectedRevision: number
): ScheduleProposal {
  const ordered = inspect(state);
  if (!revision(expectedRevision) || expectedRevision !== state.revision)
    return fail('STALE_REVISION');
  const r = object(
    request,
    ['itemId', 'startDate', 'endDate', 'shiftDependents'],
    'INVALID_PROPOSAL'
  );
  if (!text(r.itemId, 128) || typeof r.shiftDependents !== 'boolean')
    return fail('INVALID_PROPOSAL');
  const nextDates = dates(
    { startDate: r.startDate, endDate: r.endDate },
    'INVALID_PROPOSAL'
  );
  const next = clone(state),
    byId = new Map(next.items.map((x) => [x.id, x]));
  const target = byId.get(r.itemId);
  if (!target) return fail('ITEM_NOT_FOUND');
  Object.assign(target, nextDates);
  // The requested item itself must respect its predecessors; only its descendants may cascade.
  for (const dependency of target.dependsOn)
    if (day(target.startDate) <= day(byId.get(dependency)!.endDate))
      return fail('DEPENDENCY_VIOLATION');
  const affected = new Set([target.id]);
  for (const original of ordered) {
    if (
      original.id === target.id ||
      !original.dependsOn.some((id) => affected.has(id))
    )
      continue;
    affected.add(original.id);
    const item = byId.get(original.id)!;
    const earliest = Math.max(
      ...item.dependsOn.map((id) => day(byId.get(id)!.endDate) + 1)
    );
    if (day(item.startDate) < earliest) {
      if (!r.shiftDependents) return fail('DEPENDENCY_VIOLATION');
      const duration = day(item.endDate) - day(item.startDate);
      item.startDate = date(earliest);
      item.endDate = date(earliest + duration);
    }
  }
  inspect(next);
  return {
    baseRevision: state.revision,
    changes: ordered.flatMap((before) => {
      const after = byId.get(before.id)!;
      return before.startDate === after.startDate &&
        before.endDate === after.endDate
        ? []
        : [{ id: before.id, before: snapshot(before), after: snapshot(after) }];
    }),
  };
}
/** Optimistic local apply; validates evidence, not a distributed lock or authorization grant. */
export function applyScheduleProposal(
  state: ScheduleState,
  proposal: ScheduleProposal
): ScheduleState {
  inspect(state);
  const p = object(proposal, ['baseRevision', 'changes'], 'INVALID_PROPOSAL');
  if (!revision(p.baseRevision) || p.baseRevision !== state.revision)
    return fail('STALE_REVISION');
  if (
    state.revision === Number.MAX_SAFE_INTEGER ||
    !Array.isArray(p.changes) ||
    p.changes.length > 1000
  )
    return fail('INVALID_PROPOSAL');
  const next = clone(state),
    byId = new Map(next.items.map((x) => [x.id, x])),
    seen = new Set<string>();
  for (const raw of p.changes) {
    const c = object(raw, ['id', 'before', 'after'], 'INVALID_PROPOSAL');
    if (!text(c.id, 128) || seen.has(c.id)) return fail('INVALID_PROPOSAL');
    seen.add(c.id);
    const item = byId.get(c.id);
    if (!item) return fail('INVALID_PROPOSAL');
    const before = dates(c.before, 'INVALID_PROPOSAL'),
      after = dates(c.after, 'INVALID_PROPOSAL');
    if (item.startDate !== before.startDate || item.endDate !== before.endDate)
      return fail('INVALID_PROPOSAL');
    Object.assign(item, after);
  }
  inspect(next);
  next.revision++;
  return next;
}
