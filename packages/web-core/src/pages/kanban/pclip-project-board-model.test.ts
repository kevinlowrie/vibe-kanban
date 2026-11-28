import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canApproveTask,
  describeProcessUpdate,
  evaluateTaskTransition,
  filterProjectTasks,
  timelineBarPosition,
  type ProjectTask,
} from './pclip-project-board-model.ts';
import { projectBoardProcessApi } from './pclip-project-board-api.ts';

function task(overrides: Partial<ProjectTask> = {}): ProjectTask {
  return {
    id: 'task-api',
    title: 'Describe project tasks and their progress',
    description: '',
    status: 'in_progress',
    owner: 'Project assistant',
    startDay: 0,
    durationDays: 1,
    dependencies: [],
    checkState: 'needs_attention',
    approvalState: 'waiting',
    processes: [
      {
        source: 'pclip',
        requestId: 'fixture-work-request',
        state: 'running',
        updatedAt: '2026-11-08T12:00:00Z',
      },
    ],
    ...overrides,
  };
}

describe('project workflow boundaries', () => {
  it('positions and clips timeline bars to the visible work week', () => {
    assert.deepEqual(timelineBarPosition(3, 1, 5), {
      leftPercent: 60,
      widthPercent: 20,
      startDay: 3,
      durationDays: 1,
    });
    assert.deepEqual(timelineBarPosition(4, 3, 5), {
      leftPercent: 80,
      widthPercent: 20,
      startDay: 4,
      durationDays: 1,
    });
    assert.equal(timelineBarPosition(5, 1, 5), null);
    assert.equal(timelineBarPosition(0, 0, 5), null);
  });

  it('translates Pclip and n8n states into plain-language task updates', () => {
    assert.deepEqual(
      describeProcessUpdate({
        source: 'pclip',
        requestId: null,
        state: 'running',
        updatedAt: '',
      }),
      { source: 'Pclip work update', state: 'In progress' }
    );
    assert.deepEqual(
      describeProcessUpdate({
        source: 'n8n',
        requestId: 'fixture-check-request',
        state: 'needs_attention',
        updatedAt: '',
      }),
      { source: 'Automated check', state: 'Needs attention' }
    );
  });

  it('applies board filters when the search field is empty', () => {
    const completed = task({
      id: 'completed',
      title: 'Completed task',
      status: 'done',
      owner: 'Project assistant',
    });
    const teamTask = task({
      id: 'team-task',
      title: 'Team task',
      status: 'ideas',
      owner: 'Project team',
    });
    const tasks = [completed, teamTask];

    assert.deepEqual(
      filterProjectTasks(tasks, '', 'active').map((item) => item.id),
      ['team-task']
    );
    assert.deepEqual(
      filterProjectTasks(tasks, '  ', 'team').map((item) => item.id),
      ['team-task']
    );
    assert.deepEqual(
      filterProjectTasks(tasks, '', 'all').map((item) => item.id),
      ['completed', 'team-task']
    );
  });

  it('combines search terms with board filters', () => {
    const tasks = [
      task({
        title: 'Welcome guide',
        description: 'Clear writing',
        status: 'done',
      }),
      task({
        title: 'Welcome checklist',
        description: 'Clear writing',
        status: 'ready',
      }),
      task({
        title: 'Team notes',
        description: 'Clear writing',
        status: 'ready',
        owner: 'Project team',
      }),
    ];

    assert.deepEqual(
      filterProjectTasks(tasks, ' WELCOME ', 'active').map(
        (item) => item.title
      ),
      ['Welcome checklist']
    );
    assert.deepEqual(
      filterProjectTasks(tasks, 'clear', 'team').map((item) => item.title),
      ['Team notes']
    );
  });

  it('blocks a task from review until its required check passes', () => {
    assert.deepEqual(evaluateTaskTransition(task(), 'review'), {
      allowed: false,
      reason: 'check_required',
    });
  });

  it('allows a task into review after the API process reports a passing check', () => {
    assert.deepEqual(
      evaluateTaskTransition(task({ checkState: 'passed' }), 'review'),
      { allowed: true }
    );
  });

  it('blocks finishing work until a person approves it', () => {
    const inReview = task({
      status: 'review',
      checkState: 'passed',
      processes: [
        {
          source: 'n8n',
          requestId: 'fixture-review-check',
          state: 'passed',
          updatedAt: '2026-11-08T12:00:00Z',
        },
      ],
    });

    assert.deepEqual(evaluateTaskTransition(inReview, 'done'), {
      allowed: false,
      reason: 'approval_required',
    });
    assert.equal(canApproveTask(inReview), true);
  });

  it('does not allow approval before checks pass or before the task reaches review', () => {
    assert.equal(
      canApproveTask(task({ checkState: 'needs_attention' })),
      false
    );
    assert.equal(
      canApproveTask(task({ status: 'review', checkState: 'needs_attention' })),
      false
    );
  });

  it('does not allow skipping a project step', () => {
    assert.deepEqual(
      evaluateTaskTransition(task({ status: 'ready' }), 'review'),
      {
        allowed: false,
        reason: 'invalid_transition',
      }
    );
  });

  it('keeps dependent work out of Ready until its earlier task is finished', () => {
    const dependent = task({
      id: 'pclip-updates',
      status: 'ideas',
      dependencies: ['task-api'],
    });
    const earlierTask = task({ id: 'task-api', status: 'in_progress' });

    assert.deepEqual(
      evaluateTaskTransition(dependent, 'ready', [earlierTask, dependent]),
      { allowed: false, reason: 'dependency_required' }
    );
    assert.deepEqual(
      evaluateTaskTransition(dependent, 'ready', [
        task({ id: 'task-api', status: 'done' }),
        dependent,
      ]),
      { allowed: true }
    );
  });

  it('rechecks prerequisites before starting a task marked Ready', () => {
    const dependent = task({
      id: 'pclip-updates',
      status: 'ready',
      dependencies: ['task-api'],
    });
    const earlierTask = task({ id: 'task-api', status: 'in_progress' });

    assert.deepEqual(
      evaluateTaskTransition(dependent, 'in_progress', [
        earlierTask,
        dependent,
      ]),
      { allowed: false, reason: 'dependency_required' }
    );
  });

  it('requires an idempotency key for process mutations', async () => {
    await assert.rejects(
      projectBoardProcessApi.runRequiredCheck(
        'mutation-contract',
        'task-api',
        ''
      ),
      /request key is required/
    );
  });

  it('enforces task dependencies at the process API boundary', async () => {
    const result = await projectBoardProcessApi.moveTask(
      'dependency-adapter-contract',
      'pclip-updates',
      'ready',
      'request-dependent-move'
    );

    assert.equal(result.allowed, false);
    assert.equal(
      result.snapshot.tasks.find((item) => item.id === 'pclip-updates')?.status,
      'ideas'
    );
  });

  it('replays an identical action and rejects key reuse for another action', async () => {
    const projectId = 'idempotency-adapter-contract';
    const first = await projectBoardProcessApi.moveTask(
      projectId,
      'task-api',
      'review',
      'reused-request-key'
    );
    const replay = await projectBoardProcessApi.moveTask(
      projectId,
      'task-api',
      'review',
      'reused-request-key'
    );

    assert.deepEqual(replay, first);
    assert.equal(replay.snapshot.version, 1);
    await assert.rejects(
      projectBoardProcessApi.runRequiredCheck(
        projectId,
        'task-api',
        'reused-request-key'
      ),
      /already used for a different action/
    );
  });

  it('enforces check then user approval at the API adapter boundary', async () => {
    const projectId = 'adapter-contract';
    const firstMove = await projectBoardProcessApi.moveTask(
      projectId,
      'task-api',
      'review',
      'request-move-1'
    );
    assert.equal(firstMove.allowed, false);
    assert.equal(
      firstMove.snapshot.tasks.find((item) => item.id === 'task-api')?.status,
      'in_progress'
    );

    const afterCheck = await projectBoardProcessApi.runRequiredCheck(
      projectId,
      'task-api',
      'request-check-1'
    );
    const checkedTask = afterCheck.tasks.find((item) => item.id === 'task-api');
    assert.equal(checkedTask?.checkState, 'passed');
    assert.equal(
      checkedTask?.processes.find((item) => item.source === 'n8n')?.requestId,
      'check-task-api-request-check-1'
    );
    assert.equal(
      checkedTask?.processes.find((item) => item.source === 'pclip')?.requestId,
      'pclip-demo-task-api'
    );

    const afterMove = await projectBoardProcessApi.moveTask(
      projectId,
      'task-api',
      'review',
      'request-move-2'
    );
    assert.equal(afterMove.allowed, true);
    const beforeApproval = await projectBoardProcessApi.moveTask(
      projectId,
      'task-api',
      'done',
      'request-move-3'
    );
    assert.equal(beforeApproval.allowed, false);

    const afterApproval = await projectBoardProcessApi.approveTask(
      projectId,
      'task-api',
      'request-approval-1'
    );
    assert.equal(afterApproval.allowed, true);
    assert.equal(
      afterApproval.snapshot.tasks.find((item) => item.id === 'task-api')
        ?.status,
      'done'
    );

    const ready = await projectBoardProcessApi.moveTask(
      projectId,
      'pclip-updates',
      'ready',
      'request-move-4'
    );
    assert.equal(ready.allowed, true);
    const started = await projectBoardProcessApi.moveTask(
      projectId,
      'pclip-updates',
      'in_progress',
      'request-move-5'
    );
    const startedTask = started.snapshot.tasks.find(
      (item) => item.id === 'pclip-updates'
    );
    assert.equal(started.allowed, true);
    assert.equal(
      startedTask?.processes.find((item) => item.source === 'pclip')?.state,
      'running'
    );
    assert.equal(
      startedTask?.processes.find((item) => item.source === 'pclip')?.requestId,
      'work-pclip-updates-request-move-5'
    );

    const checkedUpdate = await projectBoardProcessApi.runRequiredCheck(
      projectId,
      'pclip-updates',
      'request-check-2'
    );
    const checkedUpdateTask = checkedUpdate.tasks.find(
      (item) => item.id === 'pclip-updates'
    );
    assert.equal(
      checkedUpdateTask?.processes.find((item) => item.source === 'pclip')
        ?.requestId,
      'work-pclip-updates-request-move-5'
    );
    assert.equal(
      checkedUpdateTask?.processes.find((item) => item.source === 'n8n')
        ?.requestId,
      'check-pclip-updates-request-check-2'
    );
  });
});
