import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseOperatorProjection,
  projectionIsStale,
} from './operator-projection.ts';
const now = Date.parse('2026-11-11T07:00:00Z');
const good = () => ({
  observed_at: '2026-11-11T06:59:00Z',
  provenance: 'Kubernetes Deployment replica readiness',
  stale: false,
  items: [
    {
      deployment_id: 'kevinlowrie',
      display_name: 'Kevin Lowrie',
      status: 'healthy',
    },
    { deployment_id: 'class101', display_name: 'Class101', status: 'unknown' },
  ],
});
describe('operator deployment projection boundary', () => {
  it('accepts only the pinned sanitized read model and copies it', () => {
    const source = good();
    const parsed = parseOperatorProjection(source, now);
    assert.deepEqual(parsed, source);
    source.items[0].status = 'unavailable';
    assert.equal(parsed.items[0].status, 'healthy');
  });
  it('rejects secret/extra fields at every level, duplicates and too many rows', () => {
    for (const source of [
      { ...good(), token: 'private' },
      { ...good(), items: [{ ...good().items[0], namespace: 'private' }] },
      { ...good(), items: [good().items[0], good().items[0]] },
      { ...good(), items: Array(1001).fill(good().items[0]) },
    ])
      assert.throws(() => parseOperatorProjection(source, now));
  });
  it('rejects unknown/malformed status, identifier, date, and provenance', () => {
    for (const source of [
      null,
      {},
      { ...good(), observed_at: '2026-02-30T00:00:00Z' },
      { ...good(), observed_at: '2026-11-11T07:00:00.001Z' },
      { ...good(), observed_at: '2026-11-11' },
      { ...good(), provenance: '' },
      { ...good(), items: [{ ...good().items[0], status: 'ready' }] },
      {
        ...good(),
        items: [{ ...good().items[0], deployment_id: '../tenant' }],
      },
    ])
      assert.throws(() => parseOperatorProjection(source, now));
  });
  it('expires exactly at five minutes and always honors server stale', () => {
    const source = parseOperatorProjection(good(), now);
    assert.equal(projectionIsStale(source, now), false);
    assert.equal(projectionIsStale(source, now + 239999), false);
    assert.equal(projectionIsStale(source, now + 240000), true);
    assert.equal(projectionIsStale({ ...source, stale: true }, now), true);
    assert.equal(projectionIsStale(source, now - 60001), true);
  });
  it('retains hostile text as inert text without adding task/app-health claims', () => {
    const source = good();
    source.items[0].display_name = '<img src=x onerror=alert(1)>';
    assert.equal(
      parseOperatorProjection(source, now).items[0].display_name,
      source.items[0].display_name
    );
  });
});

it('rejects coerced non-string readiness states instead of hiding deployments', () => {
  for (const status of [['healthy'], { value: 'healthy' }, null, true, 1])
    assert.throws(() =>
      parseOperatorProjection(
        { ...good(), items: [{ ...good().items[0], status }] },
        now
      )
    );
});
