export type ProjectColumnId =
  'ideas' | 'ready' | 'in_progress' | 'review' | 'done';

export type CheckState =
  'not_started' | 'running' | 'passed' | 'needs_attention';
export type ApprovalState = 'waiting' | 'approved';
export type ProjectTaskFilter = 'active' | 'all' | 'team';

export interface ProcessProjection {
  /** Service provenance from the normalized API response. */
  source: 'pclip' | 'n8n';
  /** Stable downstream request ID for correlating later process updates. */
  requestId: string | null;
  state: 'queued' | 'running' | 'passed' | 'needs_attention';
  updatedAt: string;
}

export interface ProcessUpdateLabels {
  source: 'Pclip work update' | 'Automated check';
  state: 'Waiting to start' | 'In progress' | 'Complete' | 'Needs attention';
}

export function describeProcessUpdate(
  process: ProcessProjection
): ProcessUpdateLabels {
  return {
    source:
      process.source === 'pclip' ? 'Pclip work update' : 'Automated check',
    state:
      process.state === 'queued'
        ? 'Waiting to start'
        : process.state === 'running'
          ? 'In progress'
          : process.state === 'passed'
            ? 'Complete'
            : 'Needs attention',
  };
}

export interface TimelineBarPosition {
  leftPercent: number;
  widthPercent: number;
  startDay: number;
  durationDays: number;
}

export function timelineBarPosition(
  startDay: number,
  durationDays: number,
  visibleDays: number
): TimelineBarPosition | null {
  if (
    !Number.isFinite(startDay) ||
    !Number.isFinite(durationDays) ||
    !Number.isFinite(visibleDays) ||
    durationDays <= 0 ||
    visibleDays <= 0
  ) {
    return null;
  }

  const visibleStart = Math.max(0, startDay);
  const visibleEnd = Math.min(startDay + durationDays, visibleDays);
  if (visibleEnd <= visibleStart) return null;

  return {
    leftPercent: (visibleStart / visibleDays) * 100,
    widthPercent: ((visibleEnd - visibleStart) / visibleDays) * 100,
    startDay: visibleStart,
    durationDays: visibleEnd - visibleStart,
  };
}

export interface ProjectTask {
  id: string;
  title: string;
  description: string;
  status: ProjectColumnId;
  owner: string;
  startDay: number;
  durationDays: number;
  dependencies: string[];
  checkState: CheckState;
  approvalState: ApprovalState;
  processes: ProcessProjection[];
}

export interface ProjectBoardSnapshot {
  projectId: string;
  version: number;
  tasks: ProjectTask[];
}

export function filterProjectTasks(
  tasks: ProjectTask[],
  search: string,
  filter: ProjectTaskFilter
): ProjectTask[] {
  const normalizedSearch = search.trim().toLowerCase();
  return tasks.filter(
    (task) =>
      (!normalizedSearch ||
        task.title.toLowerCase().includes(normalizedSearch) ||
        task.description.toLowerCase().includes(normalizedSearch)) &&
      (filter === 'all' ||
        (filter === 'active' && task.status !== 'done') ||
        (filter === 'team' && task.owner === 'Project team'))
  );
}

export type TransitionBlockReason =
  | 'dependency_required'
  | 'check_required'
  | 'review_required'
  | 'approval_required'
  | 'invalid_transition';

export type TransitionDecision =
  { allowed: true } | { allowed: false; reason: TransitionBlockReason };

const COLUMN_ORDER: ProjectColumnId[] = [
  'ideas',
  'ready',
  'in_progress',
  'review',
  'done',
];

export function evaluateTaskTransition(
  task: ProjectTask,
  destination: ProjectColumnId,
  projectTasks: ProjectTask[] = []
): TransitionDecision {
  const currentIndex = COLUMN_ORDER.indexOf(task.status);
  const destinationIndex = COLUMN_ORDER.indexOf(destination);

  if (
    destinationIndex <= currentIndex ||
    destinationIndex !== currentIndex + 1
  ) {
    return { allowed: false, reason: 'invalid_transition' };
  }

  if (
    (destination === 'ready' || destination === 'in_progress') &&
    task.dependencies.some((dependencyId) => {
      const dependency = projectTasks.find((item) => item.id === dependencyId);
      return !dependency || dependency.status !== 'done';
    })
  ) {
    return { allowed: false, reason: 'dependency_required' };
  }

  if (destination === 'review' && task.checkState !== 'passed') {
    return { allowed: false, reason: 'check_required' };
  }

  if (destination === 'done' && task.approvalState !== 'approved') {
    return { allowed: false, reason: 'approval_required' };
  }

  return { allowed: true };
}

export function canApproveTask(task: ProjectTask): boolean {
  return task.status === 'review' && task.checkState === 'passed';
}
