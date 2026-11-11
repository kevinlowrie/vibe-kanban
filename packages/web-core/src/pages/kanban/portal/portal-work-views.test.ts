import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadPortalWorkViews, PortalBoardError } from './portal-work-views.ts';

const session = {
  userId: 'user-a',
  tenantId: 'tenant-a',
  idToken: 'test-id-token',
};
const payloads: Record<string, unknown> = {
  projects: {
    projects: [
      {
        id: 'project-a',
        name: 'Project A',
        status: 'active',
        secret: 'never-render',
      },
    ],
  },
  issues: {
    issues: [
      {
        id: 'issue-a',
        title: 'Task A',
        status: 'in_progress',
        projectId: 'project-a',
        updatedAt: null,
      },
    ],
  },
  blocked: {
    blocked: [
      { id: 'issue-a', title: 'Task A', reason: 'Waiting', updatedAt: null },
    ],
  },
  approvals: {
    approvals: [
      {
        id: 'approval-a',
        status: 'pending',
        type: 'review',
        issueId: 'issue-a',
        updatedAt: null,
      },
    ],
  },
};
function transport(
  overrides: Record<string, unknown> = {},
  observe?: (url: string, init: RequestInit) => void
): typeof fetch {
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    observe?.(url, init);
    const resource = new URL(url, 'https://portal.example').pathname
      .split('/')
      .pop()!;
    return Response.json({ ...payloads, ...overrides }[resource]);
  }) as typeof fetch;
}
const options = (fetcher = transport()) => ({
  getSession: async () => session,
  fetcher,
});

describe('portal work-view contract and security boundaries', () => {
  it('reads only fixed same-origin routes with current tenant and bearer; projects only safe fields', async () => {
    const calls: string[] = [];
    const result = await loadPortalWorkViews(
      options(
        transport({}, (url, init) => {
          calls.push(url);
          assert.match(
            url,
            /^\/api\/v1\/(projects|issues|blocked|approvals)\?tenant_id=tenant-a$/
          );
          assert.equal(init.method, 'GET');
          assert.equal(init.redirect, 'error');
          assert.equal(init.cache, 'no-store');
          assert.equal(init.credentials, 'omit');
          assert.equal(
            new Headers(init.headers).get('Authorization'),
            'Bearer test-id-token'
          );
        })
      )
    );
    assert.equal(calls.length, 4);
    assert.deepEqual(result.projects, [
      { id: 'project-a', name: 'Project A', status: 'active' },
    ]);
    assert.equal(result.issues[0].title, 'Task A');
  });
  it('makes no requests when signed out', async () => {
    await assert.rejects(
      loadPortalWorkViews({
        getSession: async () => null,
        fetcher: transport({}, () => assert.fail('request sent')),
      }),
      /Sign in/
    );
  });
  it('rejects malformed tenant context before sending', async () => {
    for (const tenantId of [
      'tenant-a&company=other',
      '../other',
      '',
      'tenant a',
    ]) {
      await assert.rejects(
        loadPortalWorkViews({
          getSession: async () => ({ ...session, tenantId }),
          fetcher: transport({}, () => assert.fail('request sent')),
        }),
        /session/
      );
    }
  });
  it('drops results if identity or tenant changes during the request', async () => {
    let count = 0;
    await assert.rejects(
      loadPortalWorkViews({
        ...options(),
        getSession: async () =>
          ++count === 1 ? session : { ...session, tenantId: 'tenant-b' },
      }),
      /changed/
    );
  });
  it('drops results after logout during the request', async () => {
    let count = 0;
    await assert.rejects(
      loadPortalWorkViews({
        ...options(),
        getSession: async () => (++count === 1 ? session : null),
      }),
      /changed/
    );
  });
  it('rejects malformed or duplicate IDs and missing fields', async () => {
    for (const issues of [
      null,
      {},
      [{}],
      [{ id: 'x' }],
      [payloads.issues, payloads.issues],
      Array(5001).fill({}),
    ]) {
      await assert.rejects(
        loadPortalWorkViews(options(transport({ issues: { issues } }))),
        /unavailable/
      );
    }
    const row = {
      id: 'same',
      title: 'A',
      status: 'todo',
      projectId: null,
      updatedAt: null,
    };
    await assert.rejects(
      loadPortalWorkViews(
        options(transport({ issues: { issues: [row, row] } }))
      ),
      /unavailable/
    );
  });
  it('redacts authentication failures and arbitrary upstream bodies', async () => {
    for (const status of [401, 403, 500, 502]) {
      const fetcher = (async () =>
        Response.json(
          {
            error: {
              message: 'secret-upstream-token',
              request_id: '<script>bad</script>',
            },
          },
          { status }
        )) as typeof fetch;
      await assert.rejects(
        loadPortalWorkViews(options(fetcher)),
        (error: unknown) =>
          error instanceof PortalBoardError &&
          !error.message.includes('secret') &&
          !error.message.includes('script')
      );
    }
  });
  it('rejects redirects, HTML, oversized bodies, and invalid JSON', async () => {
    const responses = [
      new Response('redirect', { status: 302 }),
      new Response('<html>'),
      new Response('{', { headers: { 'content-type': 'application/json' } }),
      new Response('x'.repeat(1_048_577), {
        headers: { 'content-type': 'application/json' },
      }),
    ];
    for (const response of responses)
      await assert.rejects(
        loadPortalWorkViews(
          options((async () => response.clone()) as typeof fetch)
        ),
        /unavailable/
      );
  });
  it('propagates cancellation and sends no request after an already aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      loadPortalWorkViews({
        ...options(transport({}, () => assert.fail('request sent'))),
        signal: controller.signal,
      }),
      { name: 'AbortError' }
    );
  });
  it('retains unrecognised status labels without inventing approval or completion', async () => {
    const result = await loadPortalWorkViews(
      options(
        transport({
          issues: {
            issues: [
              {
                id: 'x',
                title: '<img src=x onerror=bad()>',
                status: 'new-upstream-status',
                projectId: 'project-a',
                updatedAt: null,
              },
            ],
          },
        })
      )
    );
    assert.equal(result.issues[0].status, 'new-upstream-status');
    assert.equal(result.issues[0].title, '<img src=x onerror=bad()>');
  });
});

describe('bounded reads and audited support', () => {
  it('forwards an explicit support reason and rejects changed support context', async () => {
    let calls = 0;
    const support = {
      ...session,
      supportReason: 'Inspect customer rollout at operator request',
    };
    await loadPortalWorkViews({
      getSession: async () => support,
      fetcher: transport({}, (_url, init) => {
        calls++;
        assert.equal(
          new Headers(init.headers).get('X-Support-Reason'),
          support.supportReason
        );
      }),
    });
    assert.equal(calls, 4);
    let count = 0;
    await assert.rejects(
      loadPortalWorkViews({
        getSession: async () => ({
          ...support,
          supportReason: ++count === 1 ? 'First reason' : 'Changed reason',
        }),
        fetcher: transport(),
      }),
      /changed/
    );
  });
  it('cancels even an unresolved host authentication promise', async () => {
    const controller = new AbortController();
    const pending = loadPortalWorkViews({
      getSession: () => new Promise(() => {}),
      signal: controller.signal,
      fetcher: transport({}, () => assert.fail('request sent')),
    });
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
  });
  it('bounds an unresolved authentication provider', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = loadPortalWorkViews({
      getSession: () => new Promise(() => {}),
      fetcher: transport(),
    });
    context.mock.timers.tick(15_001);
    await assert.rejects(pending, /unavailable/);
  });
});
