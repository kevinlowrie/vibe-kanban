import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  parseOperatorProjection,
  projectionIsStale,
  type DeploymentStatus,
  type OperatorProjection,
} from './operator-projection';
import './portal-work-board.css';
const statuses: { id: DeploymentStatus; title: string }[] = [
  { id: 'healthy', title: 'Replicas ready' },
  { id: 'degraded', title: 'Replicas degraded' },
  { id: 'unavailable', title: 'Unavailable' },
  { id: 'unknown', title: 'Unknown' },
];
function OperatorDeploymentBoard({
  snapshot,
  invalid,
}: {
  snapshot: OperatorProjection | null;
  invalid: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    const deadline = snapshot ? Date.parse(snapshot.observed_at) + 300_000 : 0;
    const timer =
      deadline > Date.now()
        ? window.setTimeout(update, deadline - Date.now() + 1)
        : undefined;
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [snapshot]);
  const stale = snapshot
    ? projectionIsStale(snapshot, Math.max(now, Date.now()))
    : true;
  return (
    <section
      className="vibe-portal-board"
      aria-label="Operator deployment board"
    >
      <header className="vpb-header">
        <div>
          <p className="vpb-eyebrow">Vibe Kanban · THL operator</p>
          <h2>Customer deployments</h2>
          <p>
            Kubernetes Deployment replica readiness only. Application sign-in
            and agent execution are not checked here.
          </p>
        </div>
      </header>
      {!snapshot && (
        <p role={invalid ? 'alert' : 'status'}>
          {invalid
            ? 'Deployment data is unavailable. Refresh from the operator dashboard.'
            : 'Waiting for an authorized operator snapshot.'}
        </p>
      )}
      {snapshot && (
        <>
          <p className={stale ? 'vpb-error' : 'vpb-scope'} role="status">
            {stale
              ? 'Snapshot is stale. Current deployment readiness is unknown.'
              : 'Recent replica-readiness snapshot'}
          </p>
          <p>
            Observed:{' '}
            <time dateTime={snapshot.observed_at}>{snapshot.observed_at}</time>
          </p>
          <p>Source: {snapshot.provenance}</p>
          {!snapshot.items.length && (
            <p>No deployments were included in this authorized snapshot.</p>
          )}
          <div
            className="vpb-columns"
            role="region"
            aria-label="Deployment readiness columns"
            tabIndex={0}
          >
            {statuses.map((status) => {
              const items = snapshot.items.filter(
                (item) => (stale ? 'unknown' : item.status) === status.id
              );
              return (
                <section
                  key={status.id}
                  className="vpb-column"
                  aria-label={status.title}
                >
                  <h3>
                    {status.title} <span>{items.length}</span>
                  </h3>
                  <ul>
                    {items.map((item) => (
                      <li key={item.deployment_id} className="vpb-card">
                        <h4>{item.display_name}</h4>
                        <p className="vpb-project">
                          Deployment: {item.deployment_id}
                        </p>
                        <p>
                          {stale ? 'Unknown · refresh required' : status.title}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
          <p className="vpb-footnote">
            Only server-authorized deployment summaries appear here. This board
            cannot deploy, modify, or access private customer work.
          </p>
        </>
      )}
    </section>
  );
}
export interface OperatorBoardHandle {
  /** Supply only the server-authorized sanitized /operator/deployments body. False rejects invalid input and clears old data. */
  render: (projection: unknown) => boolean;
  /** Call synchronously BEFORE logout, identity changes, refresh, or authorization failure. */
  clear: () => void;
  dispose: () => void;
}
/** Token-free projection renderer. The host owns authentication, HTTP, race guards and the caller-owned mount. */
export function mountOperatorDeploymentBoard(
  element: HTMLElement
): OperatorBoardHandle {
  const root = createRoot(element);
  let disposed = false;
  const show = (snapshot: OperatorProjection | null, invalid = false) => {
    if (!disposed)
      flushSync(() =>
        root.render(
          <OperatorDeploymentBoard snapshot={snapshot} invalid={invalid} />
        )
      );
  };
  show(null);
  return {
    render(projection) {
      if (disposed) return false;
      try {
        show(parseOperatorProjection(projection));
        return true;
      } catch {
        show(null, true);
        return false;
      }
    },
    clear() {
      show(null);
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        root.unmount();
      }
    },
  };
}
