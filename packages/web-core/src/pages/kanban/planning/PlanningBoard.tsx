import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  applyScheduleProposal,
  proposeReschedule,
  validateScheduleState,
} from '../scheduling/contract';
import type { ScheduleState, ScheduleProposal } from '../scheduling/contract';
import './planning-board.css';

export interface PlanningTask {
  id: string;
  status: string;
  sprintId?: string;
  workflow?: string;
  blocker?: string;
  repository?: string;
  prStage?: string;
}
export interface PlanningSnapshot {
  schedule: ScheduleState;
  tasks: PlanningTask[];
  projects: { id: string; name: string }[];
  sprints: { id: string; name: string }[];
  observedAt: string;
  coverage: string;
}
/** Host owns authentication, tenant scoping, durable CAS and provider credentials. */
export interface PlanningHost {
  load: (signal: AbortSignal) => Promise<PlanningSnapshot>;
  onScopeChange: (invalidate: () => void) => () => void;
  apply?: (
    proposal: ScheduleProposal,
    signal: AbortSignal
  ) => Promise<PlanningSnapshot>;
  proposeChat?: (
    message: string,
    revision: number,
    signal: AbortSignal
  ) => Promise<ScheduleProposal>;
}
const day = 86400000;
const offset = (date: string, n: number) =>
  new Date(Date.parse(date + 'T00:00:00Z') + n * day)
    .toISOString()
    .slice(0, 10);
function validate(snapshot: PlanningSnapshot) {
  validateScheduleState(snapshot.schedule);
  const string = (v: unknown, max = 1000) =>
    typeof v === 'string' && v.length <= max;
  if (
    !Array.isArray(snapshot.tasks) ||
    !Array.isArray(snapshot.projects) ||
    !Array.isArray(snapshot.sprints) ||
    !Number.isFinite(Date.parse(snapshot.observedAt)) ||
    !string(snapshot.coverage)
  )
    throw new Error('Invalid snapshot');
  const ids = new Set(snapshot.schedule.items.map((i) => i.id));
  for (const rows of [snapshot.projects, snapshot.sprints]) {
    if (
      rows.length > 5000 ||
      new Set(rows.map((r) => r.id)).size !== rows.length ||
      rows.some((r) => !r || !string(r.id, 200) || !string(r.name))
    )
      throw new Error('Invalid metadata');
  }
  if (
    snapshot.tasks.length > 5000 ||
    new Set(snapshot.tasks.map((t) => t.id)).size !== snapshot.tasks.length ||
    snapshot.tasks.some(
      (t) =>
        !t ||
        !ids.has(t.id) ||
        !string(t.status, 100) ||
        ['sprintId', 'workflow', 'blocker', 'repository', 'prStage'].some(
          (k) =>
            t[k as keyof PlanningTask] !== undefined &&
            !string(t[k as keyof PlanningTask])
        )
    )
  )
    throw new Error('Invalid tasks');
  return structuredClone(snapshot);
}
export function PlanningBoard({ host }: { host: PlanningHost }) {
  const [data, setData] = useState<PlanningSnapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [project, setProject] = useState('');
  const [sprint, setSprint] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [cascade, setCascade] = useState(true);
  const [proposal, setProposal] = useState<ScheduleProposal | null>(null);
  const [chat, setChat] = useState('');
  const [workflow, setWorkflow] = useState('');
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now());
  const control = useRef({
    seq: 0,
    abort: new AbortController(),
    disposed: false,
    busy: false,
  });
  function run<T>(
    action: (signal: AbortSignal) => Promise<T>,
    accept: (value: T) => void
  ) {
    const c = control.current;
    if (c.busy || c.disposed) return;
    c.busy = true;
    const seq = ++c.seq;
    setBusy(true);
    setError('');
    setNotice('');
    const signal = c.abort.signal;
    void Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return action(signal);
      })
      .then((value) => {
        if (!c.disposed && seq === c.seq) accept(value);
      })
      .catch(() => {
        if (!c.disposed && seq === c.seq)
          setError(
            'Request failed or revision changed. Refresh before retrying; no change is confirmed.'
          );
      })
      .finally(() => {
        if (!c.disposed && seq === c.seq) {
          c.busy = false;
          setBusy(false);
        }
      });
  }
  function refresh() {
    setProposal(null);
    setSelected('');
    setData(null);
    run(
      (signal) => host.load(signal),
      (value) => setData(validate(value))
    );
  }
  useLayoutEffect(() => {
    const c = control.current;
    c.disposed = false;
    c.busy = false;
    c.abort = new AbortController();
    const invalidate = () => {
      c.abort.abort();
      c.abort = new AbortController();
      ++c.seq;
      c.busy = false;
      flushSync(() => {
        setData(null);
        setProposal(null);
        setSelected('');
        setChat('');
        setProject('');
        setSprint('');
        setQuery('');
        setWorkflow('');
        setBlockedOnly(false);
        setNotice('');
        setError('');
        setBusy(false);
      });
      refresh();
    };
    const unsubscribe = host.onScopeChange(invalidate);
    setProject('');
    setSprint('');
    setQuery('');
    setWorkflow('');
    setBlockedOnly(false);
    setChat('');
    setNotice('');
    refresh();
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => {
      c.disposed = true;
      ++c.seq;
      c.abort.abort();
      unsubscribe();
      clearInterval(timer);
    };
  }, [host]);
  function preview(id: string, newStart: string, newEnd: string) {
    if (!data) return;
    try {
      setProposal(
        proposeReschedule(
          data.schedule,
          {
            itemId: id,
            startDate: newStart,
            endDate: newEnd,
            shiftDependents: cascade,
          },
          data.schedule.revision
        )
      );
      setError('');
      setNotice('');
    } catch {
      setProposal(null);
      setError('Invalid dates or dependency conflict. Nothing was changed.');
    }
  }
  function move(id: string, date: string) {
    const item = data?.schedule.items.find((x) => x.id === id);
    if (item)
      preview(
        id,
        date,
        offset(
          date,
          Math.round(
            (Date.parse(item.endDate) - Date.parse(item.startDate)) / day
          )
        )
      );
  }
  function edit(id: string) {
    const item = data?.schedule.items.find((x) => x.id === id);
    if (item) {
      setSelected(id);
      setStart(item.startDate);
      setEnd(item.endDate);
    }
  }
  function apply() {
    if (!data || !proposal) return;
    try {
      applyScheduleProposal(data.schedule, proposal);
    } catch {
      setError('Proposal is stale or invalid. Refresh and try again.');
      setProposal(null);
      return;
    }
    if (!host.apply) return;
    run(
      (signal) => host.apply!(proposal, signal),
      (value) => {
        setData(validate(value));
        setProposal(null);
        setSelected('');
        setNotice('Host confirmed the updated schedule.');
      }
    );
  }
  function ask() {
    if (!data || !host.proposeChat || !chat.trim()) return;
    setProposal(null);
    run(
      (signal) =>
        host.proposeChat!(chat.trim(), data.schedule.revision, signal),
      (value) => {
        applyScheduleProposal(data.schedule, value);
        setProposal(value);
        setNotice('Review the proposed changes. Chat has not applied them.');
      }
    );
  }
  const items =
    data?.schedule.items.filter((item) => {
      const meta = data.tasks.find((t) => t.id === item.id);
      return (
        (!workflow || meta?.workflow === workflow) &&
        (!blockedOnly || meta?.status === 'blocked' || !!meta?.blocker) &&
        (!project || item.projectId === project) &&
        (!sprint || meta?.sprintId === sprint) &&
        item.title.toLowerCase().includes(query.toLowerCase())
      );
    }) ?? [];
  const earliest = items.reduce(
    (d, item) => (d < item.startDate ? d : item.startDate),
    items[0]?.startDate ?? new Date().toISOString().slice(0, 10)
  );
  const dates = Array.from({ length: 21 }, (_, i) => offset(earliest, i));
  const stale =
    !!data &&
    (now - Date.parse(data.observedAt) > 120000 ||
      Date.parse(data.observedAt) > now + 30000);
  return (
    <section
      className="plan-board"
      aria-label="Project delivery planner"
      aria-busy={busy}
    >
      <header>
        <div>
          <p className="plan-eyebrow">HOMIE · VIBE KANBAN</p>
          <h1>Plan the work. See the path.</h1>
          <p>
            Projects, sprints, blockers and forecast dates in one workspace.
          </p>
        </div>
        <button onClick={refresh} disabled={busy}>
          Refresh
        </button>
      </header>
      <p className="plan-boundary">
        {host.apply
          ? 'Connected host adapter · acceptance is not completion'
          : 'Read-only integration · schedule persistence is not connected'}
        . Dates are estimates, not promises.
      </p>
      {error && (
        <p role="alert" className="plan-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!data && !error && <p role="status">Loading workspace…</p>}
      {data && (
        <>
          <p className={stale ? 'plan-error' : 'plan-fresh'}>
            {stale ? 'STALE' : 'Observed'} {data.observedAt} · revision{' '}
            {data.schedule.revision} · {data.coverage}
          </p>
          <div className="plan-filters">
            <label>
              Project
              <select
                aria-label="Project"
                value={project}
                onChange={(e) => {
                  setProject(e.target.value);
                  setSelected('');
                }}
              >
                <option value="">All projects</option>
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sprint
              <select
                aria-label="Sprint"
                value={sprint}
                onChange={(e) => {
                  setSprint(e.target.value);
                  setSelected('');
                }}
              >
                <option value="">All sprints</option>
                {data.sprints.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Workflow
              <select
                aria-label="Workflow"
                value={workflow}
                onChange={(e) => setWorkflow(e.target.value)}
              >
                <option value="">All workflows</option>
                {[
                  ...new Set(
                    data.tasks.flatMap((t) => (t.workflow ? [t.workflow] : []))
                  ),
                ].map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={blockedOnly}
                onChange={(e) => setBlockedOnly(e.target.checked)}
              />{' '}
              Blocked only
            </label>
            <label>
              Find task
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                type="search"
              />
            </label>
            <span>
              {items.length} of {data.schedule.items.length} tasks visible
            </span>
          </div>
          <div className="plan-columns">
            {[
              'backlog',
              'in_progress',
              'blocked',
              'in_review',
              'done',
              'other',
            ].map((status) => {
              const tasks = items.filter((i) => {
                const s =
                  data.tasks.find((t) => t.id === i.id)?.status ?? 'other';
                return status === 'other'
                  ? ![
                      'backlog',
                      'in_progress',
                      'blocked',
                      'in_review',
                      'done',
                    ].includes(s)
                  : s === status;
              });
              return (
                <section key={status}>
                  <h2>
                    {status.replaceAll('_', ' ')} <small>{tasks.length}</small>
                  </h2>
                  {tasks.map((i) => {
                    const m = data.tasks.find((t) => t.id === i.id);
                    return (
                      <article
                        key={i.id}
                        draggable={!busy && !stale}
                        onDragStart={(e) =>
                          e.dataTransfer.setData('text/plain', i.id)
                        }
                      >
                        <small>
                          {i.projectId} · {m?.sprintId ?? 'No sprint'}
                        </small>
                        <button
                          className="plan-title"
                          onClick={() => edit(i.id)}
                        >
                          {i.title}
                        </button>
                        <p>
                          {i.startDate} → {i.endDate}
                        </p>
                        {m?.blocker && (
                          <p className="plan-blocker">Blocked: {m.blocker}</p>
                        )}
                        <small>
                          {m?.workflow ?? 'Workflow unassigned'} ·{' '}
                          {m?.repository ?? 'No repository'} ·{' '}
                          {m?.prStage ?? 'PR stage unknown'}
                        </small>
                        <p>Depends on: {i.dependsOn.join(', ') || 'none'}</p>
                      </article>
                    );
                  })}
                </section>
              );
            })}
          </div>
          <h2>
            Delivery timeline{' '}
            <small>
              21-day window · drag a task onto a date, or edit dates below
            </small>
          </h2>
          <div
            className="plan-gantt"
            role="region"
            aria-label="Delivery timeline"
            tabIndex={0}
          >
            <div className="plan-grid">
              <div className="plan-name">Task</div>
              {dates.map((d) => (
                <button
                  className="plan-date"
                  key={d}
                  aria-label={'Move dropped task to ' + d}
                  disabled={busy || stale}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    move(e.dataTransfer.getData('text/plain'), d);
                  }}
                >
                  {d.slice(5)}
                </button>
              ))}
              {items.map((i) => (
                <div className="plan-row" key={i.id}>
                  <button className="plan-name" onClick={() => edit(i.id)}>
                    {i.title}
                  </button>
                  {dates.map((d) => (
                    <div
                      key={d}
                      className={
                        'plan-day ' +
                        (d >= i.startDate && d <= i.endDate ? 'plan-bar' : '')
                      }
                      title={i.title + ' ' + i.startDate + ' to ' + i.endDate}
                    >
                      {d === i.startDate ? '▶' : d === i.endDate ? '◆' : ''}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          {selected && (
            <form
              className="plan-editor"
              onSubmit={(e) => {
                e.preventDefault();
                preview(selected, start, end);
              }}
            >
              <h2>
                Edit forecast:{' '}
                {data.schedule.items.find((i) => i.id === selected)?.title}
              </h2>
              <label>
                Start
                <input
                  aria-label="Start date"
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  required
                />
              </label>
              <label>
                End
                <input
                  aria-label="End date"
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  required
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={cascade}
                  onChange={(e) => setCascade(e.target.checked)}
                />{' '}
                Shift dependent tasks when needed
              </label>
              <button disabled={busy || stale}>Preview date change</button>
              <button type="button" onClick={() => setSelected('')}>
                Close editor
              </button>
            </form>
          )}
          <section className="plan-chat">
            <h2>Adjust the plan in conversation</h2>
            <p>
              {host.proposeChat
                ? 'Your configured model returns a proposed schedule, never a silent change.'
                : 'Model adapter not connected. No prompt will be sent.'}
            </p>
            <label>
              Planning request
              <textarea
                value={chat}
                onChange={(e) => setChat(e.target.value)}
                maxLength={2000}
                placeholder="Move API integration to Monday and show the downstream impact."
              />
            </label>
            <button
              disabled={!host.proposeChat || busy || stale || !chat.trim()}
              onClick={ask}
            >
              Preview suggestion
            </button>
          </section>
          {proposal && (
            <section
              className="plan-proposal"
              aria-label="Schedule change preview"
            >
              <h2>Review changes</h2>
              <p>
                Base revision {proposal.baseRevision}. No change has been
                applied.
              </p>
              <ul>
                {proposal.changes.map((c) => (
                  <li key={c.id}>
                    <strong>
                      {data.schedule.items.find((i) => i.id === c.id)?.title ??
                        c.id}
                    </strong>
                    : {c.before.startDate}–{c.before.endDate} →{' '}
                    {c.after.startDate}–{c.after.endDate}
                  </li>
                ))}
              </ul>
              <button
                disabled={
                  busy || stale || !host.apply || proposal.changes.length === 0
                }
                onClick={apply}
              >
                Apply schedule
              </button>
              <button disabled={busy} onClick={() => setProposal(null)}>
                Cancel
              </button>
            </section>
          )}
        </>
      )}
    </section>
  );
}
export function mountPlanningBoard(element: HTMLElement, host: PlanningHost) {
  const root = createRoot(element);
  root.render(<PlanningBoard host={host} />);
  return () => root.unmount();
}
