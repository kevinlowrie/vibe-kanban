import {
  canApproveTask,
  evaluateTaskTransition,
  type ProjectBoardSnapshot,
  type ProjectColumnId,
  type ProjectTask,
} from './pclip-project-board-model';

export interface ProjectBoardProcessApi {
  getProjectSnapshot(projectId: string): Promise<ProjectBoardSnapshot>;
  runRequiredCheck(
    projectId: string,
    taskId: string,
    idempotencyKey: string
  ): Promise<ProjectBoardSnapshot>;
  moveTask(
    projectId: string,
    taskId: string,
    destination: ProjectColumnId,
    idempotencyKey: string
  ): Promise<{ snapshot: ProjectBoardSnapshot; allowed: boolean }>;
  approveTask(
    projectId: string,
    taskId: string,
    idempotencyKey: string
  ): Promise<{ snapshot: ProjectBoardSnapshot; allowed: boolean }>;
}

const initialTasks: ProjectTask[] = [
  {
    id: 'workflow-goals',
    title: 'Agree how Pclip work should be checked',
    description: 'Set the project rules for checks, review, and approval.',
    status: 'done',
    owner: 'Project team',
    startDay: 0,
    durationDays: 1,
    dependencies: [],
    checkState: 'passed',
    approvalState: 'approved',
    processes: [
      {
        source: 'pclip',
        requestId: 'pclip-demo-workflow-goals',
        state: 'passed',
        updatedAt: '2026-11-08T12:00:00Z',
      },
    ],
  },
  {
    id: 'task-api',
    title: 'Describe project tasks and their progress',
    description:
      'Agree what the board needs to read from Pclip, including task status, dependencies, checks, and approval.',
    status: 'in_progress',
    owner: 'Project assistant',
    startDay: 1,
    durationDays: 2,
    dependencies: ['workflow-goals'],
    checkState: 'needs_attention',
    approvalState: 'waiting',
    processes: [
      {
        source: 'pclip',
        requestId: 'pclip-demo-task-api',
        state: 'running',
        updatedAt: '2026-11-08T12:00:00Z',
      },
      {
        source: 'n8n',
        requestId: 'n8n-demo-task-api-check',
        state: 'needs_attention',
        updatedAt: '2026-11-08T12:01:00Z',
      },
    ],
  },
  {
    id: 'pclip-updates',
    title: 'Show updates from Pclip work',
    description: 'Keep each task in step with the work Pclip reports.',
    status: 'ideas',
    owner: 'Project team',
    startDay: 3,
    durationDays: 1,
    dependencies: ['task-api'],
    checkState: 'not_started',
    approvalState: 'waiting',
    processes: [
      {
        source: 'pclip',
        requestId: 'pclip-demo-updates',
        state: 'queued',
        updatedAt: '2026-11-08T12:00:00Z',
      },
    ],
  },
  {
    id: 'n8n-checks',
    title: 'Show automated check results',
    description: 'Bring n8n check results into the task before review.',
    status: 'ideas',
    owner: 'Project team',
    startDay: 4,
    durationDays: 1,
    dependencies: ['task-api'],
    checkState: 'not_started',
    approvalState: 'waiting',
    processes: [
      {
        source: 'n8n',
        requestId: 'n8n-demo-checks',
        state: 'queued',
        updatedAt: '2026-11-08T12:00:00Z',
      },
    ],
  },
  {
    id: 'workflow-review',
    title: 'Review the project workflow',
    description: 'Confirm the board waits for checks and human approval.',
    status: 'review',
    owner: 'Project team',
    startDay: 0,
    durationDays: 2,
    dependencies: [],
    checkState: 'passed',
    approvalState: 'waiting',
    processes: [
      {
        source: 'n8n',
        requestId: 'n8n-demo-workflow-review',
        state: 'passed',
        updatedAt: '2026-11-08T12:00:00Z',
      },
    ],
  },
  {
    id: 'approval-gate',
    title: 'Require approval before work is finished',
    description: 'Keep final approval with a person on the project team.',
    status: 'ideas',
    owner: 'Project assistant',
    startDay: 2,
    durationDays: 2,
    dependencies: ['pclip-updates', 'n8n-checks'],
    checkState: 'not_started',
    approvalState: 'waiting',
    processes: [
      {
        source: 'n8n',
        requestId: 'n8n-demo-approval-gate',
        state: 'queued',
        updatedAt: '2026-11-08T12:00:00Z',
      },
    ],
  },
  {
    id: 'project-timeline',
    title: 'Show how tasks fit together',
    description: 'Use task dates and dependencies to show the whole plan.',
    status: 'ideas',
    owner: 'Project team',
    startDay: 3,
    durationDays: 1,
    dependencies: ['task-api'],
    checkState: 'not_started',
    approvalState: 'waiting',
    processes: [
      {
        source: 'pclip',
        requestId: 'pclip-demo-timeline',
        state: 'queued',
        updatedAt: '2026-11-08T12:00:00Z',
      },
    ],
  },
];

const snapshots = new Map<string, ProjectBoardSnapshot>();
const mutationResponses = new Map<
  string,
  { fingerprint: string; result: unknown }
>();

function requireIdempotencyKey(idempotencyKey: string): void {
  if (!idempotencyKey.trim()) {
    throw new Error('A request key is required for this action.');
  }
}

function cloneSnapshot(snapshot: ProjectBoardSnapshot): ProjectBoardSnapshot {
  return structuredClone(snapshot);
}

function readMutation<T>(
  projectId: string,
  idempotencyKey: string,
  fingerprint: string
): T | undefined {
  const cacheKey = `${projectId}:${idempotencyKey}`;
  const existing = mutationResponses.get(cacheKey);
  if (!existing) return undefined;
  if (existing.fingerprint !== fingerprint) {
    throw new Error(
      'This request key was already used for a different action.'
    );
  }
  return structuredClone(existing.result) as T;
}

function saveMutation<T>(
  projectId: string,
  idempotencyKey: string,
  fingerprint: string,
  result: T
): T {
  mutationResponses.set(`${projectId}:${idempotencyKey}`, {
    fingerprint,
    result: structuredClone(result),
  });
  return structuredClone(result);
}

function getOrCreateSnapshot(projectId: string): ProjectBoardSnapshot {
  const existing = snapshots.get(projectId);
  if (existing) return existing;

  const created: ProjectBoardSnapshot = {
    projectId,
    version: 1,
    tasks: structuredClone(initialTasks),
  };
  snapshots.set(projectId, created);
  return created;
}

function findTask(
  snapshot: ProjectBoardSnapshot,
  taskId: string
): ProjectTask | undefined {
  return snapshot.tasks.find((task) => task.id === taskId);
}

function updateProcessProjection(
  task: ProjectTask,
  process: ProjectTask['processes'][number]
): void {
  task.processes = [
    ...task.processes.filter((item) => item.source !== process.source),
    process,
  ];
}

/**
 * Local-only API adapter for the Project board proof of concept.
 * It normalizes Pclip and n8n process updates into one task snapshot and does
 * not connect to either service's dashboard or browser API directly.
 */
export const projectBoardProcessApi: ProjectBoardProcessApi = {
  async getProjectSnapshot(projectId) {
    return cloneSnapshot(getOrCreateSnapshot(projectId));
  },

  async runRequiredCheck(projectId, taskId, idempotencyKey) {
    requireIdempotencyKey(idempotencyKey);
    const fingerprint = JSON.stringify({ action: 'run_check', taskId });
    const replay = readMutation<ProjectBoardSnapshot>(
      projectId,
      idempotencyKey,
      fingerprint
    );
    if (replay) return replay;

    const snapshot = getOrCreateSnapshot(projectId);
    const task = findTask(snapshot, taskId);
    if (!task || task.status !== 'in_progress') {
      return saveMutation(projectId, idempotencyKey, fingerprint, snapshot);
    }

    updateProcessProjection(task, {
      source: 'n8n',
      requestId: `check-${task.id}-${idempotencyKey}`,
      state: 'passed',
      updatedAt: new Date().toISOString(),
    });
    task.checkState = 'passed';
    snapshot.version += 1;
    return saveMutation(projectId, idempotencyKey, fingerprint, snapshot);
  },

  async moveTask(projectId, taskId, destination, idempotencyKey) {
    requireIdempotencyKey(idempotencyKey);
    const fingerprint = JSON.stringify({
      action: 'move_task',
      taskId,
      destination,
    });
    const replay = readMutation<{
      snapshot: ProjectBoardSnapshot;
      allowed: boolean;
    }>(projectId, idempotencyKey, fingerprint);
    if (replay) return replay;

    const snapshot = getOrCreateSnapshot(projectId);
    const task = findTask(snapshot, taskId);
    if (
      !task ||
      !evaluateTaskTransition(task, destination, snapshot.tasks).allowed
    ) {
      return saveMutation(projectId, idempotencyKey, fingerprint, {
        snapshot,
        allowed: false,
      });
    }

    task.status = destination;
    if (destination === 'in_progress') {
      updateProcessProjection(task, {
        source: 'pclip',
        requestId: `work-${task.id}-${idempotencyKey}`,
        state: 'running',
        updatedAt: new Date().toISOString(),
      });
    }
    snapshot.version += 1;
    return saveMutation(projectId, idempotencyKey, fingerprint, {
      snapshot,
      allowed: true,
    });
  },

  async approveTask(projectId, taskId, idempotencyKey) {
    requireIdempotencyKey(idempotencyKey);
    const fingerprint = JSON.stringify({ action: 'approve_task', taskId });
    const replay = readMutation<{
      snapshot: ProjectBoardSnapshot;
      allowed: boolean;
    }>(projectId, idempotencyKey, fingerprint);
    if (replay) return replay;

    const snapshot = getOrCreateSnapshot(projectId);
    const task = findTask(snapshot, taskId);
    if (!task || !canApproveTask(task)) {
      return saveMutation(projectId, idempotencyKey, fingerprint, {
        snapshot,
        allowed: false,
      });
    }

    task.approvalState = 'approved';
    task.status = 'done';
    snapshot.version += 1;
    return saveMutation(projectId, idempotencyKey, fingerprint, {
      snapshot,
      allowed: true,
    });
  },
};
