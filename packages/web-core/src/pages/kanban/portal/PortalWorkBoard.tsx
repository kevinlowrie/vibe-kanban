import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  loadPortalWorkViews,
  PortalBoardError,
  type PortalSession,
  type PortalWorkViews,
} from './portal-work-views';
import './portal-work-board.css';

export interface PortalBoardHost {
  /** The portal owns Firebase sign-in, fresh tokens, and server-authorised tenant selection. */
  getSession: () => Promise<PortalSession | null>;
  /** Emit synchronously on logout, identity/tenant change, or permission revocation. */
  onSessionChange: (invalidate: () => void) => () => void;
}
const columns = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'To do' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'in_review', label: 'In review' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'other', label: 'Other status' },
];
function PortalWorkBoard({ host }: { host: PortalBoardHost }) {
  const [views, setViews] = useState<PortalWorkViews | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState('');
  const [search, setSearch] = useState('');
  const current = useRef({
    sequence: 0,
    controller: new AbortController(),
    disposed: false,
  });
  const refresh = useCallback(() => {
    const state = current.current;
    if (state.disposed) return;
    state.controller.abort();
    state.controller = new AbortController();
    const sequence = ++state.sequence;
    setViews(null);
    setError('');
    setLoading(true);
    void loadPortalWorkViews({
      getSession: host.getSession,
      signal: state.controller.signal,
    })
      .then((result) => {
        if (state.disposed || sequence !== state.sequence) return;
        setViews(result);
        setLoading(false);
      })
      .catch((failure: unknown) => {
        if (state.disposed || sequence !== state.sequence) return;
        setError(
          failure instanceof PortalBoardError
            ? failure.message
            : 'Work views are unavailable. Try refreshing.'
        );
        setLoading(false);
      });
  }, [host]);
  useEffect(() => {
    const state = current.current;
    state.disposed = false;
    const unsubscribe = host.onSessionChange(() => {
      // Remove old tenant data before the identity-change callback returns.
      flushSync(() => {
        setProjectId('');
        setSearch('');
        refresh();
      });
    });
    refresh();
    return () => {
      state.disposed = true;
      ++state.sequence;
      state.controller.abort();
      unsubscribe();
    };
  }, [host, refresh]);
  const issues = useMemo(() => {
    if (!views) return [];
    const known = new Set(views.projects.map((project) => project.id));
    return views.issues.filter(
      (issue) =>
        !['done', 'cancelled'].includes(issue.status) &&
        (issue.projectId === null || known.has(issue.projectId)) &&
        (!projectId || issue.projectId === projectId) &&
        issue.title
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase())
    );
  }, [views, projectId, search]);
  return (
    <section
      className="vibe-portal-board"
      aria-label="Workspace work board"
      aria-busy={loading}
    >
      <header className="vpb-header">
        <div>
          <p className="vpb-eyebrow">Vibe Kanban · Portal</p>
          <h2>Workspace work</h2>
          <p>
            Read-only task status. Deployment health is shown separately by your
            operator dashboard.
          </p>
        </div>
        <button type="button" onClick={refresh}>
          Refresh
        </button>
      </header>
      {loading && <p role="status">Loading the selected workspace…</p>}
      {error && (
        <p role="alert" className="vpb-error">
          {error}
        </p>
      )}
      {views && (
        <>
          <p className="vpb-scope">
            Workspace: <strong>{views.tenantId}</strong>
          </p>
          <div className="vpb-filters">
            <label>
              Project
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="">All projects</option>
                {views.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name || project.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Find a task
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search task titles"
              />
            </label>
            <span role="status">
              {issues.length} active {issues.length === 1 ? 'task' : 'tasks'}
            </span>
          </div>
          {!views.projects.length && !issues.length && (
            <p>No projects or active tasks are available in this workspace.</p>
          )}
          {!!views.projects.length && !issues.length && (
            <p>No active tasks match this view.</p>
          )}
          <div
            className="vpb-columns"
            role="region"
            aria-label="Task columns"
            tabIndex={0}
          >
            {columns.map((column) => {
              const tasks = issues.filter((issue) =>
                column.id === 'other'
                  ? !columns.some(
                      (candidate) =>
                        candidate.id !== 'other' &&
                        candidate.id === issue.status
                    )
                  : issue.status === column.id
              );
              if (column.id === 'other' && !tasks.length) return null;
              return (
                <section
                  className="vpb-column"
                  key={column.id}
                  aria-label={column.label}
                >
                  <h3>
                    {column.label} <span>{tasks.length}</span>
                  </h3>
                  <ul>
                    {tasks.map((issue) => {
                      const blocked = views.blocked.find(
                        (item) => item.id === issue.id
                      );
                      const approvals = views.approvals.filter(
                        (item) =>
                          item.issueId === issue.id && item.status === 'pending'
                      );
                      const project = views.projects.find(
                        (item) => item.id === issue.projectId
                      );
                      return (
                        <li className="vpb-card" key={issue.id}>
                          <p className="vpb-project">
                            {project?.name || 'Unassigned project'}
                          </p>
                          <h4>{issue.title || 'Untitled task'}</h4>
                          {column.id === 'other' && (
                            <p>Status: {issue.status || 'Not supplied'}</p>
                          )}
                          {blocked?.reason && (
                            <p className="vpb-blocked">
                              Blocked: {blocked.reason}
                            </p>
                          )}
                          {!!approvals.length && (
                            <p className="vpb-approval">
                              {approvals.length} pending{' '}
                              {approvals.length === 1
                                ? 'approval'
                                : 'approvals'}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
          <p className="vpb-footnote">
            This board cannot start work, approve tasks, or change deployments.
            No task data is saved on this device.
          </p>
        </>
      )}
    </section>
  );
}
/** Mount into the authenticated portal. Load the accompanying portal-board.css. */
export function mountPortalWorkBoard(
  element: HTMLElement,
  host: PortalBoardHost
): () => void {
  if (
    typeof host?.getSession !== 'function' ||
    typeof host?.onSessionChange !== 'function'
  )
    throw new Error(
      'The portal must provide its authenticated session adapter.'
    );
  const root = createRoot(element);
  root.render(<PortalWorkBoard host={host} />);
  return () => root.unmount();
}
