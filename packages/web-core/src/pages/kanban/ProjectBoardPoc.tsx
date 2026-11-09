import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
} from 'react';
import {
  ArrowRightIcon,
  CalendarBlankIcon,
  CheckCircleIcon,
  CircleIcon,
  MagnifyingGlassIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react';
import type { ProjectBoardProcessApi } from './pclip-project-board-api';
import type {
  ProjectBoardSnapshot,
  ProjectColumnId,
  ProjectTask,
  ProjectTaskFilter,
} from './pclip-project-board-model';
import {
  enqueueUserRequest,
  loadProjectSnapshot,
  saveProjectSnapshot,
} from './pclip-project-board-offline';
import {
  describeProcessUpdate,
  evaluateTaskTransition,
  filterProjectTasks,
  timelineBarPosition,
} from './pclip-project-board-model';

interface ProjectBoardPocProps {
  projectId: string;
  userId: string;
  projectName?: string;
  api: ProjectBoardProcessApi;
}

const COLUMNS: { id: ProjectColumnId; label: string }[] = [
  { id: 'ideas', label: 'Ideas' },
  { id: 'ready', label: 'Ready' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'review', label: 'Your review' },
  { id: 'done', label: 'Finished' },
];
const EMPTY_TASKS: ProjectTask[] = [];

const WEEKDAYS = [
  { day: 'Mon', date: 'Nov 9, 2026' },
  { day: 'Tue', date: 'Nov 10, 2026' },
  { day: 'Wed', date: 'Nov 11, 2026' },
  { day: 'Thu', date: 'Nov 12, 2026' },
  { day: 'Fri', date: 'Nov 13, 2026' },
];

function requestKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `demo-${Date.now()}`;
}

function statusLabel(task: ProjectTask): string {
  if (task.checkState === 'needs_attention') return 'Check needed';
  if (task.status === 'review') return 'Your review';
  return COLUMNS.find((column) => column.id === task.status)?.label ?? 'Ready';
}

function statusClasses(task: ProjectTask): string {
  if (task.checkState === 'needs_attention') {
    return 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200';
  }
  if (task.status === 'done') {
    return 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-200';
  }
  if (task.status === 'review') {
    return 'bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-200';
  }
  if (task.status === 'in_progress') {
    return 'bg-orange-50 text-orange-800 dark:bg-orange-950 dark:text-orange-200';
  }
  return 'bg-secondary text-normal';
}

function taskBarClasses(task: ProjectTask, selected: boolean): string {
  if (selected) return 'bg-brand text-white ring-2 ring-brand/25';
  if (task.status === 'done') return 'bg-green-500 text-white';
  if (task.status === 'review') return 'bg-purple-500 text-white';
  if (task.checkState === 'needs_attention') {
    return 'bg-red-100 text-red-800 ring-1 ring-inset ring-red-300';
  }
  return 'bg-orange-100 text-orange-900 ring-1 ring-inset ring-orange-200';
}

function statusText(task: ProjectTask): string {
  if (task.checkState === 'needs_attention') {
    return 'A required check needs attention.';
  }
  if (task.status === 'review') {
    return 'The work is ready for your review.';
  }
  if (task.status === 'done') return 'This task is finished.';
  if (task.status === 'ready') return 'This task is ready to begin.';
  if (task.status === 'ideas') return 'This task is part of the project plan.';
  return 'Work is moving ahead as planned.';
}

function formatProcessUpdate(updatedAt: string): string {
  const timestamp = new Date(updatedAt);
  if (Number.isNaN(timestamp.getTime())) return 'Update time unavailable';
  return `Updated ${new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp)}`;
}

export function ProjectBoardPoc({
  projectId,
  userId,
  projectName,
  api,
}: ProjectBoardPocProps) {
  const [snapshot, setSnapshot] = useState<ProjectBoardSnapshot | null>(null);
  const [loadErrorProjectId, setLoadErrorProjectId] = useState<string | null>(
    null
  );
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [selectedTaskId, setSelectedTaskId] = useState('task-api');
  const [search, setSearch] = useState('');
  const [boardFilter, setBoardFilter] = useState<ProjectTaskFilter>('active');
  const [notice, setNotice] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(
    typeof navigator === 'undefined' || navigator.onLine
  );

  useEffect(() => {
    const updateOnlineState = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateOnlineState);
    window.addEventListener('offline', updateOnlineState);
    return () => {
      window.removeEventListener('online', updateOnlineState);
      window.removeEventListener('offline', updateOnlineState);
    };
  }, []);

  useEffect(() => {
    let isCurrent = true;
    void api
      .getProjectSnapshot(projectId)
      .then((next) => {
        if (isCurrent) {
          setSnapshot(next);
          setLoadErrorProjectId(null);
          void saveProjectSnapshot(userId, next).catch(() => undefined);
        }
      })
      .catch(async () => {
        const cached = await loadProjectSnapshot(userId, projectId).catch(
          () => undefined
        );
        if (!isCurrent) return;
        if (cached) {
          setSnapshot(cached.snapshot);
          setLoadErrorProjectId(null);
          setNotice(
            `Offline copy from ${formatProcessUpdate(cached.observedAt)}.`
          );
        } else {
          setLoadErrorProjectId(projectId);
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [api, loadAttempt, projectId, userId]);

  const currentSnapshot = snapshot?.projectId === projectId ? snapshot : null;
  const tasks = currentSnapshot?.tasks ?? EMPTY_TASKS;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const matchingTasks = useMemo(() => {
    return filterProjectTasks(tasks, search, boardFilter);
  }, [boardFilter, search, tasks]);

  const moveTask = useCallback(
    async (task: ProjectTask, destination: ProjectColumnId) => {
      const decision = evaluateTaskTransition(
        task,
        destination,
        snapshot?.tasks ?? []
      );
      if (!decision.allowed) {
        setNotice(
          decision.reason === 'check_required'
            ? 'This task can’t move forward until the required check is complete.'
            : decision.reason === 'dependency_required'
              ? 'This task must wait until its earlier tasks are finished.'
              : decision.reason === 'approval_required'
                ? 'This task can’t be finished until you approve it.'
                : 'This task can only move one step at a time.'
        );
        return;
      }

      setIsUpdating(true);
      setNotice(null);
      try {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          await enqueueUserRequest({
            userId,
            projectId,
            taskId: task.id,
            kind: 'task_action',
            payload: { action: 'move', destination },
          });
          setNotice(
            'Saved on this device. It will be sent when you reconnect.'
          );
          return;
        }
        const result = await api.moveTask(
          projectId,
          task.id,
          destination,
          requestKey()
        );
        setSnapshot(result.snapshot);
        if (!result.allowed) {
          setNotice(
            'This task can’t move forward until its required steps are complete.'
          );
        } else {
          setNotice('Task moved to the next step.');
        }
      } catch {
        setNotice(
          'Could not update this task. Refresh the project and try again.'
        );
      } finally {
        setIsUpdating(false);
      }
    },
    [api, projectId, snapshot, userId]
  );

  const handleRunCheck = useCallback(async () => {
    if (!selectedTask) return;
    setIsUpdating(true);
    setNotice(null);
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await enqueueUserRequest({
          userId,
          projectId,
          taskId: selectedTask.id,
          kind: 'task_action',
          payload: { action: 'run_required_check' },
        });
        setNotice('Saved on this device. It will be sent when you reconnect.');
        return;
      }
      const next = await api.runRequiredCheck(
        projectId,
        selectedTask.id,
        requestKey()
      );
      setSnapshot(next);
      setNotice('The check is complete. This task is ready to move forward.');
    } catch {
      setNotice('Could not run the check. Refresh the project and try again.');
    } finally {
      setIsUpdating(false);
    }
  }, [api, projectId, selectedTask, userId]);

  const handleApprove = useCallback(async () => {
    if (!selectedTask) return;
    setIsUpdating(true);
    setNotice(null);
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await enqueueUserRequest({
          userId,
          projectId,
          taskId: selectedTask.id,
          kind: 'task_action',
          payload: { action: 'approve' },
        });
        setNotice(
          'Approval request saved. It will be sent when you reconnect.'
        );
        return;
      }
      const result = await api.approveTask(
        projectId,
        selectedTask.id,
        requestKey()
      );
      setSnapshot(result.snapshot);
      setNotice(
        result.allowed
          ? 'You approved this task. It is now finished.'
          : 'This task is not ready for your approval yet.'
      );
    } catch {
      setNotice(
        'Could not finish this task. Refresh the project and try again.'
      );
    } finally {
      setIsUpdating(false);
    }
  }, [api, projectId, selectedTask, userId]);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, destination: ProjectColumnId) => {
      event.preventDefault();
      const task = tasks.find((item) => item.id === draggedTaskId);
      setDraggedTaskId(null);
      if (task) void moveTask(task, destination);
    },
    [draggedTaskId, moveTask, tasks]
  );

  if (!currentSnapshot) {
    if (loadErrorProjectId === projectId) {
      return (
        <main className="flex h-full min-h-0 flex-col items-center justify-center gap-3 bg-primary p-6 text-center">
          <p role="alert" className="text-lg text-high">
            We couldn’t load this project. Try again in a moment.
          </p>
          <button
            type="button"
            onClick={() => setLoadAttempt((attempt) => attempt + 1)}
            className="rounded-sm bg-brand px-4 py-2 text-base font-semibold text-white hover:bg-brand-hover"
          >
            Try again
          </button>
        </main>
      );
    }
    return (
      <div className="flex h-full items-center justify-center text-lg text-low">
        Loading project board…
      </div>
    );
  }

  const nextColumn = selectedTask
    ? COLUMNS[
        COLUMNS.findIndex((column) => column.id === selectedTask.status) + 1
      ]
    : undefined;
  const transition =
    selectedTask && nextColumn
      ? evaluateTaskTransition(selectedTask, nextColumn.id, tasks)
      : null;
  const isSelectedCheckAttention =
    selectedTask?.checkState === 'needs_attention' &&
    selectedTask.status === 'in_progress';
  const isSelectedAwaitingApproval =
    selectedTask?.status === 'review' &&
    selectedTask.approvalState === 'waiting';
  const unfinishedDependencies = selectedTask
    ? selectedTask.dependencies
        .map((dependencyId) => tasks.find((task) => task.id === dependencyId))
        .filter((task) => task && task.status !== 'done')
    : [];

  return (
    <main className="flex h-full min-h-0 flex-col gap-3 overflow-auto bg-primary p-3 sm:p-4">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1 text-sm font-medium text-low">Project board</p>
          <h1 className="truncate text-2xl font-semibold text-high">
            {projectName || 'Pclip workflow'}
          </h1>
        </div>
        <span className="rounded-sm border border-border bg-secondary px-2 py-1 text-sm text-low">
          {isOnline ? 'Example project data' : 'Offline · requests saved here'}
        </span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="flex min-h-0 min-w-0 flex-col gap-3">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 rounded-sm border border-border bg-secondary p-1 text-sm">
              {(['active', 'all', 'team'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setBoardFilter(filter)}
                  aria-pressed={boardFilter === filter}
                  className={`rounded-sm px-3 py-1.5 font-medium transition-colors ${boardFilter === filter ? 'bg-primary text-high' : 'text-low hover:text-high'}`}
                >
                  {filter === 'active'
                    ? 'Active'
                    : filter === 'all'
                      ? 'All'
                      : 'Team'}
                </button>
              ))}
            </div>
            <label className="flex min-w-[190px] items-center gap-2 rounded-sm border border-border bg-primary px-3 py-2 text-normal focus-within:ring-1 focus-within:ring-brand">
              <MagnifyingGlassIcon className="size-4 shrink-0 text-low" />
              <input
                aria-label="Search tasks"
                className="w-full bg-transparent text-sm text-high outline-none placeholder:text-low"
                placeholder="Search tasks…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>

          {selectedTask &&
            !matchingTasks.some((task) => task.id === selectedTask.id) && (
              <div
                role="status"
                className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border bg-secondary/50 px-3 py-2 text-sm text-normal"
              >
                <span>
                  The selected task is hidden by the current search or filter.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setBoardFilter('all');
                  }}
                  className="font-semibold text-brand-secondary hover:underline"
                >
                  Show selected task
                </button>
              </div>
            )}

          <p className="text-sm text-low sm:hidden">
            Scroll sideways to see every task stage →
          </p>
          <div
            role="region"
            aria-label="Task stages. Scroll horizontally to see every stage."
            tabIndex={0}
            className="min-h-[280px] flex-1 overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <div className="grid h-full min-w-[900px] grid-cols-5 gap-2">
              {COLUMNS.map((column) => {
                const columnTasks = matchingTasks.filter(
                  (task) => task.status === column.id
                );
                return (
                  <div
                    key={column.id}
                    className={`flex min-h-0 flex-col overflow-hidden rounded-sm border ${draggedTaskId ? 'border-brand/60 bg-brand/5' : 'border-border bg-secondary/40'}`}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleDrop(event, column.id)}
                  >
                    <div className="flex items-center justify-between border-b border-border bg-secondary px-3 py-2.5">
                      <h2 className="truncate text-lg font-medium text-high">
                        {column.label}
                      </h2>
                      <span className="ml-2 rounded-full bg-panel px-2 py-0.5 text-sm text-low">
                        {columnTasks.length}
                      </span>
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
                      {columnTasks.map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          draggable
                          onDragStart={() => setDraggedTaskId(task.id)}
                          onDragEnd={() => setDraggedTaskId(null)}
                          onClick={() => {
                            setSelectedTaskId(task.id);
                            setNotice(null);
                          }}
                          aria-pressed={selectedTask?.id === task.id}
                          className={`w-full cursor-grab rounded-sm border p-3 text-left transition-colors active:cursor-grabbing ${selectedTask?.id === task.id ? 'border-brand bg-primary ring-1 ring-brand/40' : 'border-border bg-primary hover:border-brand/50'}`}
                        >
                          <span className="block text-base font-medium leading-snug text-high">
                            {task.title}
                          </span>
                          <span className="mt-2 block truncate text-sm text-low">
                            {task.description}
                          </span>
                          <span
                            className={`mt-3 inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-sm font-medium ${statusClasses(task)}`}
                          >
                            {task.checkState === 'needs_attention' ? (
                              <WarningCircleIcon
                                className="size-4"
                                weight="fill"
                              />
                            ) : task.status === 'done' ? (
                              <CheckCircleIcon
                                className="size-4"
                                weight="fill"
                              />
                            ) : (
                              <CircleIcon className="size-4" />
                            )}
                            {statusLabel(task)}
                          </span>
                        </button>
                      ))}
                      {columnTasks.length === 0 && (
                        <p className="px-2 py-4 text-center text-sm text-low">
                          No tasks here yet
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {selectedTask && (
            <ProjectTimeline
              tasks={tasks}
              selectedTaskId={selectedTask.id}
              onSelectTask={setSelectedTaskId}
            />
          )}
        </section>

        {selectedTask ? (
          <aside className="flex min-h-[420px] min-w-0 flex-col overflow-y-auto rounded-sm border border-border bg-primary p-4 xl:min-h-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="mb-1 text-sm text-low">Selected task</p>
                <h2 className="text-xl font-semibold leading-snug text-high">
                  {selectedTask.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedTaskId('');
                  setNotice(null);
                }}
                aria-label="Close selected task"
                className="rounded-sm p-1 text-low hover:bg-secondary hover:text-high"
              >
                <XIcon className="size-5" />
              </button>
            </div>

            <p className="mt-2 text-lg leading-relaxed text-normal">
              {selectedTask.description}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-border pb-4">
              <span
                className={`rounded-sm px-2 py-1 text-sm font-medium ${statusClasses(selectedTask)}`}
              >
                {statusLabel(selectedTask)}
              </span>
              <span className="rounded-sm border border-border px-2 py-1 text-sm text-normal">
                Owner: {selectedTask.owner}
              </span>
            </div>

            {unfinishedDependencies.length > 0 && (
              <p className="mt-3 rounded-sm border border-border bg-secondary/50 px-3 py-2 text-sm leading-relaxed text-normal">
                Waiting for:{' '}
                {unfinishedDependencies.map((task) => task?.title).join(', ')}
              </p>
            )}

            <div className="mt-3 rounded-sm border border-border bg-secondary/50 px-3 py-2">
              <p className="text-sm font-medium text-high">Work updates</p>
              <div className="mt-1 space-y-2">
                {selectedTask.processes.map((process) => {
                  const update = describeProcessUpdate(process);
                  return (
                    <div
                      key={`${process.source}-${process.requestId ?? 'none'}`}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm"
                    >
                      <span className="text-normal">
                        {update.source} · {update.state}
                      </span>
                      <span className="text-low">
                        {formatProcessUpdate(process.updatedAt)}
                      </span>
                    </div>
                  );
                })}
                {selectedTask.processes.length === 0 && (
                  <p className="text-sm text-low">No updates yet</p>
                )}
              </div>
            </div>

            <div className="py-4">
              <h3 className="mb-3 text-xl font-semibold text-high">
                Project steps
              </h3>
              <ol className="space-y-0">
                <StepRow
                  title="Plan agreed"
                  description={
                    selectedTask.status === 'ideas'
                      ? 'This task is waiting to be added to the project plan.'
                      : 'The goal and approach are set.'
                  }
                  state={
                    selectedTask.status === 'ideas' ? 'current' : 'complete'
                  }
                />
                <StepRow
                  title="Work underway"
                  description={
                    selectedTask.status === 'ready' ||
                    selectedTask.status === 'ideas'
                      ? 'This task is waiting to begin.'
                      : 'Work is in progress as planned.'
                  }
                  state={
                    selectedTask.status === 'ideas' ||
                    selectedTask.status === 'ready'
                      ? 'waiting'
                      : 'complete'
                  }
                />
                <StepRow
                  title="Check the result"
                  description={statusText(selectedTask)}
                  state={
                    selectedTask.checkState === 'passed'
                      ? 'complete'
                      : selectedTask.checkState === 'needs_attention'
                        ? 'attention'
                        : 'waiting'
                  }
                />
                <StepRow
                  title="Your approval"
                  description={
                    selectedTask.approvalState === 'approved'
                      ? 'You approved this task.'
                      : 'You decide when this task is ready to finish.'
                  }
                  state={
                    selectedTask.approvalState === 'approved'
                      ? 'complete'
                      : selectedTask.status === 'review'
                        ? 'current'
                        : 'waiting'
                  }
                  isLast
                />
              </ol>
            </div>

            {isSelectedCheckAttention && (
              <div className="rounded-sm border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
                <div className="flex items-start gap-2 text-red-800 dark:text-red-200">
                  <WarningCircleIcon
                    className="mt-0.5 size-5 shrink-0"
                    weight="fill"
                  />
                  <div>
                    <p className="font-semibold">
                      This task can’t move forward yet
                    </p>
                    <p className="mt-1 text-sm leading-relaxed">
                      A required check hasn’t finished. Run it before sending
                      this work for review.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRunCheck()}
                  disabled={isUpdating}
                  className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-sm bg-brand px-3 py-2 text-base font-medium text-white hover:bg-brand-hover disabled:cursor-wait disabled:opacity-70"
                >
                  {isUpdating ? (
                    <SpinnerGapIcon className="size-4 animate-spin" />
                  ) : null}
                  Run the check
                </button>
              </div>
            )}

            {isSelectedAwaitingApproval && (
              <div className="rounded-sm border border-brand/30 bg-brand/5 p-3">
                <p className="font-semibold text-high">Ready for your review</p>
                <p className="mt-1 text-sm leading-relaxed text-normal">
                  The required check is complete. Your approval is needed before
                  this task is finished.
                </p>
              </div>
            )}

            {notice && (
              <p
                role="status"
                className="mt-3 rounded-sm bg-secondary px-3 py-2 text-sm text-normal"
              >
                {notice}
              </p>
            )}

            <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
              {isSelectedAwaitingApproval ? (
                <button
                  type="button"
                  onClick={() => void handleApprove()}
                  disabled={isUpdating}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-brand px-4 py-2 text-base font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
                >
                  {isUpdating ? (
                    <SpinnerGapIcon className="size-4 animate-spin" />
                  ) : null}
                  Approve and finish
                </button>
              ) : selectedTask.status === 'ideas' && nextColumn ? (
                <button
                  type="button"
                  onClick={() => void moveTask(selectedTask, nextColumn.id)}
                  disabled={isUpdating || !transition?.allowed}
                  title={
                    transition &&
                    !transition.allowed &&
                    transition.reason === 'dependency_required'
                      ? 'Finish the earlier tasks first'
                      : undefined
                  }
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-brand px-4 py-2 text-base font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-secondary disabled:text-low"
                >
                  Move to Ready
                  <ArrowRightIcon className="size-4" weight="bold" />
                </button>
              ) : selectedTask.status === 'ready' && nextColumn ? (
                <button
                  type="button"
                  onClick={() => void moveTask(selectedTask, nextColumn.id)}
                  disabled={isUpdating || !transition?.allowed}
                  title={
                    transition &&
                    !transition.allowed &&
                    transition.reason === 'dependency_required'
                      ? 'Finish the earlier tasks first'
                      : undefined
                  }
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-brand px-4 py-2 text-base font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-secondary disabled:text-low"
                >
                  Start work
                  <ArrowRightIcon className="size-4" weight="bold" />
                </button>
              ) : selectedTask.status === 'in_progress' && nextColumn ? (
                <button
                  type="button"
                  onClick={() => void moveTask(selectedTask, nextColumn.id)}
                  disabled={isUpdating || !transition?.allowed}
                  title={
                    !transition?.allowed
                      ? transition?.reason === 'dependency_required'
                        ? 'Finish the earlier tasks first'
                        : 'Complete the required check first'
                      : undefined
                  }
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-brand px-4 py-2 text-base font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-secondary disabled:text-low"
                >
                  Move to review
                  <ArrowRightIcon className="size-4" weight="bold" />
                </button>
              ) : selectedTask.status === 'done' ? (
                <p className="flex items-center justify-center gap-2 rounded-sm bg-green-50 px-4 py-3 text-base font-medium text-green-800 dark:bg-green-950 dark:text-green-200">
                  <CheckCircleIcon className="size-5" weight="fill" />
                  This task is finished
                </p>
              ) : null}
              <p className="text-center text-sm text-low">
                Final approval always belongs to you.
              </p>
            </div>
          </aside>
        ) : (
          <aside className="flex min-h-[180px] items-center justify-center rounded-sm border border-dashed border-border bg-secondary/30 p-5 text-center text-lg text-low xl:min-h-0">
            Select a task to see its progress and place in the project.
          </aside>
        )}
      </div>
    </main>
  );
}

function StepRow({
  title,
  description,
  state,
  isLast = false,
}: {
  title: string;
  description: string;
  state: 'complete' | 'current' | 'attention' | 'waiting';
  isLast?: boolean;
}) {
  const icon =
    state === 'complete' ? (
      <CheckCircleIcon className="size-6 text-green-600" weight="fill" />
    ) : state === 'attention' ? (
      <WarningCircleIcon className="size-6 text-red-600" weight="fill" />
    ) : state === 'current' ? (
      <CircleIcon className="size-6 text-brand" weight="fill" />
    ) : (
      <CircleIcon className="size-6 text-low" />
    );

  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      <div className="relative flex w-6 shrink-0 flex-col items-center">
        {icon}
        {!isLast && (
          <span
            className="absolute top-7 h-full w-px bg-border"
            aria-hidden="true"
          />
        )}
      </div>
      <div className="min-w-0 flex-1 pb-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-lg font-semibold text-high">{title}</h4>
          <span
            className={`rounded-sm px-2 py-0.5 text-sm font-medium ${
              state === 'complete'
                ? 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200'
                : state === 'attention'
                  ? 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200'
                  : state === 'current'
                    ? 'bg-brand/10 text-brand-secondary'
                    : 'bg-secondary text-low'
            }`}
          >
            {state === 'complete'
              ? 'Complete'
              : state === 'attention'
                ? 'Needs attention'
                : state === 'current'
                  ? 'Waiting on you'
                  : 'Waiting'}
          </span>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-low">{description}</p>
      </div>
    </li>
  );
}

function ProjectTimeline({
  tasks,
  selectedTaskId,
  onSelectTask,
}: {
  tasks: ProjectTask[];
  selectedTaskId: string;
  onSelectTask: (taskId: string) => void;
}) {
  const sortedTasks = [...tasks].sort(
    (left, right) =>
      left.startDay - right.startDay || left.title.localeCompare(right.title)
  );

  return (
    <section className="shrink-0 overflow-hidden rounded-sm border border-border bg-primary">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-3 sm:px-4">
        <div className="flex items-center gap-2">
          <CalendarBlankIcon className="size-5 text-brand" weight="bold" />
          <div>
            <h2 className="text-xl font-semibold text-high">
              Project timeline
            </h2>
            <p className="text-sm text-low">See how the work fits together.</p>
            <p className="text-sm text-low sm:hidden">
              Scroll sideways to see more dates and tasks →
            </p>
          </div>
        </div>
        <span className="text-sm text-low">Week of Nov 9, 2026</span>
      </div>

      <div
        role="region"
        aria-label="Project timeline. Scroll horizontally to see all dates and tasks."
        tabIndex={0}
        className="max-h-[280px] overflow-auto p-2 sm:p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[minmax(220px,1.6fr)_repeat(5,minmax(80px,1fr))] border-b border-border">
            <div className="flex items-end px-2 pb-2 text-sm font-medium text-low">
              Task
            </div>
            {WEEKDAYS.map((weekday) => (
              <div
                key={weekday.day}
                className="border-l border-border px-1 pb-2 text-center"
              >
                <p className="text-sm font-semibold text-high">{weekday.day}</p>
                <p className="text-xs text-low">{weekday.date}</p>
              </div>
            ))}
          </div>

          {sortedTasks.map((task) => {
            const selected = task.id === selectedTaskId;
            const barPosition = timelineBarPosition(
              task.startDay,
              task.durationDays,
              WEEKDAYS.length
            );
            const dependencyTitles = task.dependencies
              .map((dependencyId) =>
                sortedTasks.find((item) => item.id === dependencyId)
              )
              .filter((dependency): dependency is ProjectTask =>
                Boolean(dependency)
              )
              .map((dependency) => dependency.title);
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => onSelectTask(task.id)}
                aria-pressed={selected}
                className={`grid w-full grid-cols-[minmax(220px,1.6fr)_repeat(5,minmax(80px,1fr))] border-b border-border text-left last:border-b-0 ${selected ? 'bg-brand/10' : 'hover:bg-secondary/50'}`}
              >
                <span className="flex min-w-0 items-center gap-2 px-2 py-2.5">
                  {task.status === 'done' ? (
                    <CheckCircleIcon
                      className="size-4 shrink-0 text-green-600"
                      weight="fill"
                    />
                  ) : task.checkState === 'needs_attention' ? (
                    <WarningCircleIcon
                      className="size-4 shrink-0 text-red-600"
                      weight="fill"
                    />
                  ) : (
                    <CircleIcon className="size-4 shrink-0 text-low" />
                  )}
                  <span className="flex min-w-0 flex-col">
                    <span
                      className={`truncate text-sm ${selected ? 'font-semibold text-high' : 'text-normal'}`}
                    >
                      {task.title}
                    </span>
                    {dependencyTitles.length > 0 && (
                      <span className="truncate text-xs text-low">
                        After {dependencyTitles.join(', ')}
                      </span>
                    )}
                  </span>
                </span>
                <span className="relative col-span-5 grid grid-cols-5 border-l border-border">
                  {WEEKDAYS.map((weekday) => (
                    <span
                      key={weekday.day}
                      className="border-l border-border first:border-l-0"
                    />
                  ))}
                  {barPosition && (
                    <span
                      className={`absolute top-1/2 flex h-5 -translate-y-1/2 items-center overflow-hidden rounded-sm px-2 text-xs font-medium ${taskBarClasses(task, selected)}`}
                      style={{
                        left: `${barPosition.leftPercent}%`,
                        width: `calc(${barPosition.widthPercent}% - 8px)`,
                      }}
                      aria-label={`${task.title}, scheduled from day ${barPosition.startDay + 1} for ${barPosition.durationDays} ${barPosition.durationDays === 1 ? 'day' : 'days'}`}
                    >
                      <span className="truncate">
                        {selected
                          ? 'Selected task'
                          : task.status === 'done'
                            ? 'Complete'
                            : 'Planned'}
                      </span>
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
