import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  loadPortalWorkProjection,
  parsePortalWorkProjection,
  PortalBoardError,
} from './portal-work-views.ts';

const sample = () => ({
  userId: 'user-a',
  tenantId: 'tenant-a',
  projects: [{ id: 'p', name: 'Project', status: 'active' }],
  issues: [
    { id: 'i', title: 'Task', status: 'todo', projectId: 'p', updatedAt: null },
  ],
  blocked: [],
  approvals: [],
});

test('data-only projection accepts no credential fields and copies its rows', () => {
  const input = sample();
  const output = parsePortalWorkProjection(input);
  input.issues[0].title = 'changed';
  assert.equal(output.issues[0].title, 'Task');
  assert.throws(
    () => parsePortalWorkProjection({ ...sample(), idToken: 'must-not-cross' }),
    PortalBoardError
  );
  assert.throws(
    () => parsePortalWorkProjection({ ...sample(), tenantId: '../other' }),
    PortalBoardError
  );
  assert.throws(
    () => parsePortalWorkProjection({ ...sample(), userId: '' }),
    PortalBoardError
  );
});

test('data-only projection validates all DTO boundaries', () => {
  for (const update of [
    { projects: [{ id: 'p', name: { private: 'hidden' }, status: 'active' }] },
    { issues: [sample().issues[0], sample().issues[0]] },
    { issues: [{ ...sample().issues[0], title: 'x'.repeat(4001) }] },
    {
      approvals: [
        {
          id: 'a',
          status: 'pending',
          type: null,
          issueId: { private: 'hidden' },
          updatedAt: null,
        },
      ],
    },
    {
      blocked: Array.from({ length: 5001 }, (_, i) => ({
        id: `b${i}`,
        title: '',
        reason: '',
        updatedAt: null,
      })),
    },
  ])
    assert.throws(
      () => parsePortalWorkProjection({ ...sample(), ...update }),
      PortalBoardError
    );
});

test('data-only loader passes only an AbortSignal to the authenticated host', async () => {
  let seen: AbortSignal | undefined;
  const output = await loadPortalWorkProjection({
    loadViews: async (signal) => {
      seen = signal;
      return sample();
    },
  });
  assert.equal(output.tenantId, 'tenant-a');
  assert.ok(seen instanceof AbortSignal);
  assert.ok(seen.aborted);
});

test('data-only loader does not call a host after cancellation', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    loadPortalWorkProjection({
      signal: controller.signal,
      loadViews: async () => {
        assert.fail('must not be invoked');
      },
    })
  );
});

test('data-only loader rejects late data even when host ignores cancellation', async () => {
  const controller = new AbortController();
  let complete!: (value: unknown) => void;
  const loading = loadPortalWorkProjection({
    signal: controller.signal,
    loadViews: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  });
  controller.abort();
  complete(sample());
  await assert.rejects(loading, { name: 'AbortError' });
});

test('data-only loader bounds an unresolved host provider', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const loading = loadPortalWorkProjection({
    loadViews: () => new Promise(() => {}),
  });
  t.mock.timers.tick(15000);
  await assert.rejects(
    loading,
    (error: unknown) =>
      error instanceof PortalBoardError && error.code === 'unavailable'
  );
});

test('data-only loader never exposes host error text', async () => {
  await assert.rejects(
    loadPortalWorkProjection({
      loadViews: async () => {
        throw new Error('private provider token');
      },
    }),
    (error: unknown) =>
      error instanceof PortalBoardError && !error.message.includes('private')
  );
});

test('synchronous host invalidation cannot miss the abort listener', async () => {
  const controller = new AbortController();
  await assert.rejects(
    loadPortalWorkProjection({
      signal: controller.signal,
      loadViews: () => {
        controller.abort();
        return new Promise(() => {});
      },
    }),
    { name: 'AbortError' }
  );
});
