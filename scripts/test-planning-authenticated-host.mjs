import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(), 'planning-host-'));
try {
  const out = join(dir, 'host.mjs');
  await build({ entryPoints: ['packages/web-core/src/pages/kanban/planning/authenticated-host.ts'], outfile: out, bundle: true, platform: 'node', format: 'esm' });
  const { createAuthenticatedPlanningHost } = await import(pathToFileURL(out));
  const state = { revision: 1, items: [] };
  let current, listener, calls, response, compose, getSession;
  const reset = () => {
    current = { userId: 'user', pclipDomain: 'lab', idToken: 'fixture', canWriteSchedule: false };
    calls = [];
    getSession = async () => current;
    response = () => new Response(JSON.stringify(state), { headers: { 'content-type': 'application/json', 'X-Planning-Contract': 'planning-schedule/v1' } });
    compose = async schedule => ({ schedule, tasks: [], projects: [], sprints: [], observedAt: new Date().toISOString(), coverage: 'fixture' });
  };
  const make = (enableWrites = false) => createAuthenticatedPlanningHost({
    getSession: () => getSession(), onSessionChange: cb => { listener = cb; return () => {}; },
    composeSnapshot: (...args) => compose(...args), enableWrites,
    fetcher: async (url, options) => { calls.push({ url, options }); return response(); },
  });
  const signal = () => new AbortController().signal;
  reset();
  const read = make();
  assert.equal(read.apply, undefined);
  await read.load(signal());
  assert.equal(calls[0].url, '/api/v1/planning/schedule');
  assert.equal(calls[0].options.headers['X-Pclip-Domain'], 'lab');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.credentials, 'omit');
  reset(); current = null;
  await assert.rejects(make().load(signal())); assert.equal(calls.length, 0);
  reset(); response = () => new Response(JSON.stringify(state), { headers: { 'content-type': 'application/json' } });
  await assert.rejects(make().load(signal()));
  reset(); response = () => new Response('SECRET', { status: 403 });
  await assert.rejects(make().load(signal()), /Planning unavailable/);
  reset(); response = () => new Response(JSON.stringify({ revision: -1, items: [] }), { headers: { 'content-type': 'application/json', 'X-Planning-Contract': 'planning-schedule/v1' } });
  await assert.rejects(make().load(signal()));
  reset(); compose = async schedule => ({ schedule: { ...schedule, revision: 99 } });
  await assert.rejects(make().load(signal()));
  reset(); compose = async schedule => { current = { ...current, pclipDomain: 'other' }; return { schedule }; };
  await assert.rejects(make().load(signal()));
  reset(); const write = make(true); const proposal = { baseRevision: 1, changes: [] };
  await assert.rejects(write.apply(proposal, signal())); assert.equal(calls.length, 0);
  current.canWriteSchedule = true;
  response = () => { throw new Error('SECRET'); };
  await assert.rejects(write.apply(proposal, signal()), /Planning unavailable/);
  await assert.rejects(write.apply(proposal, signal()));
  assert.equal(calls[0].options.headers['X-Idempotency-Key'], calls[1].options.headers['X-Idempotency-Key']);
  reset(); const scoped = make(); scoped.onScopeChange(() => {});
  response = () => { listener(); return new Response(JSON.stringify(state), { headers: { 'content-type': 'application/json', 'X-Planning-Contract': 'planning-schedule/v1' } }); };
  await assert.rejects(scoped.load(signal()));
  reset(); const abort = new AbortController(); abort.abort();
  await assert.rejects(make().load(abort.signal)); assert.equal(calls.length, 0);
  reset(); current.canWriteSchedule = true;
  response = () => new Response(JSON.stringify({ revision: calls.length === 1 ? 2 : 4, items: [] }), { headers: { 'content-type': 'application/json', 'X-Planning-Contract': 'planning-schedule/v1' } });
  const latest = await make(true).apply({ baseRevision: 1, changes: [] }, signal());
  assert.equal(latest.schedule.revision, 4);
  assert.deepEqual(calls.map(c => c.options.method), ['POST', 'GET']);
  reset(); current.canWriteSchedule = true;
  response = () => calls.length === 1 ? new Response(JSON.stringify(state), { headers: { 'content-type': 'application/json', 'X-Planning-Contract': 'planning-schedule/v1' } }) : new Response('SECRET', { status: 503 });
  await assert.rejects(make(true).apply({ baseRevision: 1, changes: [] }, signal()));
  reset(); compose = async schedule => { schedule.revision = 99; return { schedule }; };
  await assert.rejects(make().load(signal()));
  reset(); const raced = make(); raced.onScopeChange(() => {});
  let sessionCalls = 0;
  getSession = async () => { sessionCalls++; if (sessionCalls === 3) { await Promise.resolve(); listener(); } return current; };
  await assert.rejects(raced.load(signal()));
  reset(); current.canWriteSchedule = true;
  response = () => new Response(JSON.stringify({ revision: calls.length === 1 ? 4 : 2, items: [] }), { headers: { 'content-type': 'application/json', 'X-Planning-Contract': 'planning-schedule/v1' } });
  await assert.rejects(make(true).apply({ baseRevision: 1, changes: [] }, signal()));
  console.log('16 authenticated adapter cases passed (synthetic HTTP fixtures; no live backend)');
} finally { await rm(dir, { recursive: true, force: true }); }
