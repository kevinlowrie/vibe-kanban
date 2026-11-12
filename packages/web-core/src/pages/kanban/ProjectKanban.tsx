import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRightIcon, SpinnerGapIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { LoginRequiredPrompt } from '@/shared/dialogs/shared/LoginRequiredPrompt';
import { useUserOrganizations } from '@/shared/hooks/useUserOrganizations';
import { useOrganizationProjects } from '@/shared/hooks/useOrganizationProjects';
import { useOrganizationStore } from '@/shared/stores/useOrganizationStore';
import { useAuth } from '@/shared/hooks/auth/useAuth';
import { useCurrentKanbanRouteState } from '@/shared/hooks/useCurrentKanbanRouteState';
import {
  buildKanbanIssueComposerKey,
  closeKanbanIssueComposer,
} from '@/shared/stores/useKanbanIssueComposerStore';
import { ProjectProvider } from '@/shared/providers/remote/ProjectProvider';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import type { ProjectStatus } from 'shared/remote-types';

function getNextVisibleStatus(
  statuses: ProjectStatus[],
  current: ProjectStatus
): ProjectStatus | undefined {
  return statuses.find(
    (status) =>
      status.sort_order > current.sort_order ||
      (status.sort_order === current.sort_order && status.id > current.id)
  );
}

function useFindProjectById(projectId: string | undefined) {
  const { isLoaded: authLoaded, userId } = useAuth();
  const { data: orgsData, isLoading: orgsLoading } = useUserOrganizations();
  const selectedOrgId = useOrganizationStore((state) => state.selectedOrgId);
  const organizations = orgsData?.organizations ?? [];
  const orgIdToUse = selectedOrgId ?? organizations[0]?.id ?? null;
  const { data: projects = [], isLoading: projectsLoading } =
    useOrganizationProjects(orgIdToUse);
  const project = useMemo(
    () => projects.find((candidate) => candidate.id === projectId),
    [projectId, projects]
  );
  return {
    project,
    userId,
    organizationId: project?.organization_id ?? selectedOrgId,
    isLoading: !authLoaded || orgsLoading || projectsLoading,
  };
}

export function ProjectKanban() {
  const { projectId, hostId } = useCurrentKanbanRouteState();
  const { t } = useTranslation('common');
  const { isSignedIn, isLoaded: authLoaded } = useAuth();
  const issueComposerKey = useMemo(
    () => (projectId ? buildKanbanIssueComposerKey(hostId, projectId) : null),
    [hostId, projectId]
  );
  const previousIssueComposerKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const previousKey = previousIssueComposerKeyRef.current;
    if (previousKey && previousKey !== issueComposerKey) {
      closeKanbanIssueComposer(previousKey);
    }
    previousIssueComposerKeyRef.current = issueComposerKey;
  }, [issueComposerKey]);

  const { project, userId, organizationId, isLoading } = useFindProjectById(
    projectId ?? undefined
  );
  if (!authLoaded || isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-low">{t('states.loading')}</p>
      </div>
    );
  }
  if (!isSignedIn) {
    return (
      <div className="flex h-full w-full items-center justify-center p-base">
        <LoginRequiredPrompt
          className="max-w-md"
          title={t('kanban.loginRequired.title')}
          description={t('kanban.loginRequired.description')}
          actionLabel={t('kanban.loginRequired.action')}
        />
      </div>
    );
  }
  if (!projectId || !organizationId || !userId) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-low">{t('kanban.noProjectFound')}</p>
      </div>
    );
  }
  return (
    <ProjectProvider projectId={projectId}>
      <LiveProjectBoard projectName={project?.name} />
    </ProjectProvider>
  );
}

function LiveProjectBoard({ projectName }: { projectName?: string }) {
  const { issues, statuses, isLoading, error, retry, updateIssue } =
    useProjectContext();
  const [pendingIssueIds, setPendingIssueIds] = useState<Set<string>>(
    () => new Set()
  );
  const [mutationErrors, setMutationErrors] = useState<Record<string, string>>(
    {}
  );

  const orderedStatuses = useMemo(
    () =>
      [...statuses].sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      ),
    [statuses]
  );
  const visibleStatuses = useMemo(
    () => orderedStatuses.filter((status) => !status.hidden),
    [orderedStatuses]
  );

  const advanceIssue = async (issueId: string, current: ProjectStatus) => {
    const next = getNextVisibleStatus(visibleStatuses, current);
    if (!next || pendingIssueIds.has(issueId)) return;

    setPendingIssueIds((pending) => new Set(pending).add(issueId));
    setMutationErrors((errors) => ({ ...errors, [issueId]: '' }));
    try {
      await updateIssue(issueId, {
        status_id: next.id,
        expected_status_id: current.id,
      } as Parameters<typeof updateIssue>[1]).persisted;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setMutationErrors((errors) => ({ ...errors, [issueId]: message }));
    } finally {
      setPendingIssueIds((pending) => {
        const nextPending = new Set(pending);
        nextPending.delete(issueId);
        return nextPending;
      });
    }
  };

  if (isLoading) {
    return <div className="p-double text-low">Loading project board…</div>;
  }

  return (
    <main className="new-design flex h-full min-h-0 flex-col bg-primary text-high">
      <header className="border-b border-border px-double py-base">
        <h1 className="text-xl font-semibold">
          {projectName ?? 'Project board'}
        </h1>
        <p className="mt-half text-sm text-low">
          Live project issues and statuses
        </p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-base border-b border-border px-double py-base">
        <p className="text-sm text-low">
          Pclip and n8n are disconnected. No authorized adapter is configured.
        </p>
        {error && (
          <div className="flex items-center gap-base text-sm text-error">
            <span>Project data may be stale: {error.message}</span>
            <button className="underline" onClick={retry} type="button">
              Retry
            </button>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 gap-base overflow-x-auto p-double">
        {visibleStatuses.map((status) => {
          const statusIssues = issues.filter(
            (issue) => issue.status_id === status.id
          );
          return (
            <section
              aria-label={status.name}
              className="flex w-72 min-w-72 flex-col rounded border border-border bg-secondary"
              key={status.id}
            >
              <div className="flex items-center justify-between border-b border-border px-base py-base">
                <h2 className="font-semibold">{status.name}</h2>
                <span className="text-sm text-low">{statusIssues.length}</span>
              </div>
              <div className="flex flex-1 flex-col gap-half overflow-y-auto p-base">
                {statusIssues.map((issue) => {
                  const next = getNextVisibleStatus(visibleStatuses, status);
                  const pending = pendingIssueIds.has(issue.id);
                  return (
                    <article
                      className="rounded border border-border bg-panel p-base"
                      key={issue.id}
                    >
                      <p className="text-sm font-semibold">{issue.title}</p>
                      {issue.description && (
                        <p className="mt-half line-clamp-3 text-sm text-low">
                          {issue.description}
                        </p>
                      )}
                      {next && (
                        <button
                          className="mt-base inline-flex items-center gap-half rounded border border-border px-base py-half text-sm text-normal hover:text-high disabled:opacity-50"
                          disabled={pending}
                          onClick={() => void advanceIssue(issue.id, status)}
                          type="button"
                        >
                          {pending ? (
                            <SpinnerGapIcon className="animate-spin" />
                          ) : (
                            <ArrowRightIcon />
                          )}
                          Move to {next.name}
                        </button>
                      )}
                      {mutationErrors[issue.id] && (
                        <p className="mt-base text-sm text-error" role="alert">
                          {mutationErrors[issue.id]}
                        </p>
                      )}
                    </article>
                  );
                })}
                {statusIssues.length === 0 && (
                  <p className="py-base text-center text-sm text-low">
                    No issues in this status.
                  </p>
                )}
              </div>
            </section>
          );
        })}
        {visibleStatuses.length === 0 && (
          <p className="text-sm text-low">
            This project has no visible statuses.
          </p>
        )}
      </div>
    </main>
  );
}
