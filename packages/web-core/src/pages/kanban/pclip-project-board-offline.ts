import Dexie, { type Table } from 'dexie';
import type { ProjectBoardSnapshot } from './pclip-project-board-model';

export type OutboxKind =
  'task_action' | 'chat_turn' | 'artifact_upload' | 'memory_sync';
export type OutboxState =
  | 'queued'
  | 'sending'
  | 'accepted'
  | 'complete'
  | 'approval_required'
  | 'needs_attention';

export interface CachedProject {
  key: string;
  userId: string;
  projectId: string;
  snapshot: ProjectBoardSnapshot;
  observedAt: string;
  cursor: string | null;
}

export interface CachedProcessEvent {
  id: string;
  userId: string;
  projectId: string;
  taskId: string | null;
  requestId: string | null;
  source: 'pclip' | 'n8n';
  summary: string;
  occurredAt: string;
  observedAt: string;
  channelCursor: string;
  idempotencyKey?: string | null;
  outcome?: 'accepted' | 'complete' | 'approval_required' | 'failed';
}

export interface LocalConversation {
  id: string;
  userId: string;
  projectId: string | null;
  title: string;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalMessage {
  id: string;
  userId: string;
  conversationId: string;
  sequence: number;
  role: 'user' | 'assistant' | 'agent' | 'system';
  content: string;
  createdAt: string;
  state: 'draft' | 'queued' | 'streaming' | 'complete' | 'interrupted';
  idempotencyKey: string | null;
  requestId: string | null;
}

export interface LocalMemory {
  id: string;
  userId: string;
  scope: 'user' | 'project';
  projectId: string | null;
  kind: 'preference' | 'decision' | 'fact' | 'instruction';
  content: string;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string;
  expiresAt: string | null;
}

export interface LocalArtifact {
  id: string;
  userId: string;
  conversationId: string | null;
  projectId: string | null;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  blob: Blob;
  createdAt: string;
  uploadState: 'local' | 'queued' | 'uploaded';
  remoteObjectId: string | null;
}

export interface LocalOutboxItem {
  id: string;
  idempotencyKey: string;
  requestDigest: string;
  userId: string;
  projectId: string | null;
  taskId: string | null;
  kind: OutboxKind;
  payload: Record<string, unknown>;
  state: OutboxState;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: string;
  attemptCount: number;
  leaseId: string | null;
  leaseUntil: string | null;
  serverRequestId: string | null;
  lastError: string | null;
}

interface LocalMeta {
  key: string;
  userId: string;
  value: string;
  updatedAt: string;
}

class ProjectBoardOfflineDatabase extends Dexie {
  cachedProjects!: Table<CachedProject, string>;
  processEvents!: Table<CachedProcessEvent, string>;
  conversations!: Table<LocalConversation, string>;
  messages!: Table<LocalMessage, string>;
  memories!: Table<LocalMemory, string>;
  artifacts!: Table<LocalArtifact, string>;
  outbox!: Table<LocalOutboxItem, string>;
  meta!: Table<LocalMeta, string>;

  constructor() {
    super('project-board-local-v1');
    this.version(1).stores({
      cachedProjects: '&key,userId,projectId,observedAt',
      processEvents:
        '&id,userId,projectId,observedAt,[userId+projectId+observedAt]',
      conversations:
        '&id,userId,projectId,updatedAt,[userId+projectId+updatedAt]',
      messages: '&id,userId,conversationId,[conversationId+sequence]',
      memories:
        '&id,userId,scope,projectId,updatedAt,expiresAt,[userId+scope+projectId]',
      artifacts: '&id,userId,conversationId,projectId,createdAt,uploadState',
      outbox:
        '&id,&[userId+idempotencyKey],userId,projectId,taskId,kind,state,createdAt,[userId+state+nextAttemptAt]',
      meta: '&key,userId',
    });
  }
}

let database: ProjectBoardOfflineDatabase | null = null;

function localDatabase(): ProjectBoardOfflineDatabase {
  if (typeof indexedDB === 'undefined') {
    throw new Error('This browser does not support offline project storage.');
  }
  database ??= new ProjectBoardOfflineDatabase();
  return database;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return [...bytes]
    .map(
      (byte, index) =>
        `${index === 4 || index === 6 || index === 8 || index === 10 ? '-' : ''}${byte.toString(16).padStart(2, '0')}`
    )
    .join('');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

async function digestRequest(value: unknown): Promise<string> {
  if (!crypto.subtle) {
    throw new Error('Secure browser storage is required to queue requests.');
  }
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function cachedProjectKey(userId: string, projectId: string): string {
  return `${userId}:${projectId}`;
}

export async function requestPersistentBrowserStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

export async function saveProjectSnapshot(
  userId: string,
  snapshot: ProjectBoardSnapshot,
  cursor: string | null = null,
  observedAt = nowIso()
): Promise<void> {
  await localDatabase().cachedProjects.put({
    key: cachedProjectKey(userId, snapshot.projectId),
    userId,
    projectId: snapshot.projectId,
    snapshot: structuredClone(snapshot),
    observedAt,
    cursor,
  });
}

export async function loadProjectSnapshot(
  userId: string,
  projectId: string
): Promise<CachedProject | undefined> {
  return localDatabase().cachedProjects.get(
    cachedProjectKey(userId, projectId)
  );
}

export async function saveConversation(
  conversation: LocalConversation
): Promise<void> {
  await localDatabase().conversations.put(conversation);
}

export async function saveMessage(message: LocalMessage): Promise<void> {
  const db = localDatabase();
  await db.transaction('rw', db.messages, db.conversations, async () => {
    const conversation = await db.conversations.get(message.conversationId);
    if (!conversation || conversation.userId !== message.userId) {
      throw new Error('Conversation is unavailable in this local account.');
    }
    await db.messages.put(message);
    await db.conversations.update(conversation.id, {
      updatedAt: message.createdAt,
    });
  });
}

export async function rememberForAgent(
  memory: Omit<LocalMemory, 'createdAt' | 'updatedAt' | 'reviewedAt'>,
  userConfirmed: boolean
): Promise<void> {
  if (!userConfirmed) {
    throw new Error('Agent memory is saved only after user review.');
  }
  const timestamp = nowIso();
  await localDatabase().memories.put({
    ...memory,
    createdAt: timestamp,
    updatedAt: timestamp,
    reviewedAt: timestamp,
  });
}

export async function buildLocalAgentContext(
  userId: string,
  projectId: string,
  limit = 12
): Promise<{
  memories: LocalMemory[];
  recentEvents: CachedProcessEvent[];
  snapshot: CachedProject | undefined;
}> {
  const db = localDatabase();
  const [memories, recentEvents, snapshot] = await Promise.all([
    db.memories.where('userId').equals(userId).toArray(),
    db.processEvents
      .where('[userId+projectId+observedAt]')
      .between(
        [userId, projectId, Dexie.minKey],
        [userId, projectId, Dexie.maxKey]
      )
      .reverse()
      .limit(limit)
      .toArray(),
    loadProjectSnapshot(userId, projectId),
  ]);
  const now = Date.now();
  return {
    memories: memories
      .filter(
        (memory) =>
          (memory.scope === 'user' || memory.projectId === projectId) &&
          (!memory.expiresAt || Date.parse(memory.expiresAt) > now)
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit),
    recentEvents,
    snapshot,
  };
}

export async function addCachedProcessEvents(
  events: CachedProcessEvent[]
): Promise<void> {
  if (events.length === 0) return;
  await localDatabase().processEvents.bulkPut(events);
}

export async function enqueueUserRequest(input: {
  userId: string;
  projectId?: string | null;
  taskId?: string | null;
  kind: OutboxKind;
  payload: Record<string, unknown>;
}): Promise<LocalOutboxItem> {
  const idempotencyKey = newId();
  const digestInput = {
    userId: input.userId,
    projectId: input.projectId ?? null,
    taskId: input.taskId ?? null,
    kind: input.kind,
    payload: input.payload,
  };
  const timestamp = nowIso();
  const item: LocalOutboxItem = {
    id: newId(),
    idempotencyKey,
    requestDigest: await digestRequest(digestInput),
    userId: input.userId,
    projectId: input.projectId ?? null,
    taskId: input.taskId ?? null,
    kind: input.kind,
    payload: structuredClone(input.payload),
    state: 'queued',
    createdAt: timestamp,
    updatedAt: timestamp,
    nextAttemptAt: timestamp,
    attemptCount: 0,
    leaseId: null,
    leaseUntil: null,
    serverRequestId: null,
    lastError: null,
  };
  await localDatabase().outbox.add(item);
  return item;
}

export async function queuedRequestCount(userId: string): Promise<number> {
  return localDatabase()
    .outbox.where('[userId+state+nextAttemptAt]')
    .between(
      [userId, Dexie.minKey, Dexie.minKey],
      [userId, Dexie.maxKey, Dexie.maxKey]
    )
    .count();
}

export async function saveLocalArtifact(
  artifact: Omit<
    LocalArtifact,
    'id' | 'createdAt' | 'uploadState' | 'remoteObjectId'
  >
): Promise<LocalArtifact> {
  const maxArtifactBytes = 25 * 1024 * 1024;
  if (
    artifact.size > maxArtifactBytes ||
    artifact.blob.size !== artifact.size
  ) {
    throw new Error('This file is too large to save for offline use.');
  }
  const record: LocalArtifact = {
    ...artifact,
    id: newId(),
    createdAt: nowIso(),
    uploadState: 'local',
    remoteObjectId: null,
  };
  await localDatabase().artifacts.add(record);
  return record;
}

export async function applyUserChannelEvent(
  event: CachedProcessEvent & {
    idempotencyKey?: string | null;
    outcome?: 'accepted' | 'complete' | 'approval_required' | 'failed';
  }
): Promise<void> {
  const db = localDatabase();
  await db.transaction('rw', db.processEvents, db.outbox, async () => {
    await db.processEvents.put(event);
    if (!event.idempotencyKey || !event.outcome) return;
    const item = await db.outbox
      .where('[userId+idempotencyKey]')
      .equals([event.userId, event.idempotencyKey])
      .first();
    if (!item) return;
    const state: OutboxState =
      event.outcome === 'accepted'
        ? 'accepted'
        : event.outcome === 'approval_required'
          ? 'approval_required'
          : event.outcome === 'failed'
            ? 'needs_attention'
            : 'complete';
    await db.outbox.update(item.id, {
      state,
      updatedAt: event.observedAt,
      lastError: event.outcome === 'failed' ? event.summary : null,
    });
  });
}

export async function removeLocalUserData(userId: string): Promise<void> {
  const db = localDatabase();
  await db.transaction(
    'rw',
    [
      db.cachedProjects,
      db.processEvents,
      db.conversations,
      db.messages,
      db.memories,
      db.artifacts,
      db.outbox,
      db.meta,
    ],
    async () => {
      await Promise.all([
        db.cachedProjects.where('userId').equals(userId).delete(),
        db.processEvents.where('userId').equals(userId).delete(),
        db.conversations.where('userId').equals(userId).delete(),
        db.messages.where('userId').equals(userId).delete(),
        db.memories.where('userId').equals(userId).delete(),
        db.artifacts.where('userId').equals(userId).delete(),
        db.outbox.where('userId').equals(userId).delete(),
        db.meta.where('userId').equals(userId).delete(),
      ]);
    }
  );
}

export interface UserChannelTransport {
  publishRequest(
    item: LocalOutboxItem
  ): Promise<{ requestId: string; acceptedAt: string }>;
  readEvents(
    userId: string,
    afterCursor: string | null
  ): Promise<{ events: CachedProcessEvent[]; nextCursor: string | null }>;
}

export async function flushUserOutbox(
  userId: string,
  transport: UserChannelTransport
): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const lock = `project-board-outbox:${userId}`;
  const run = () => flushOutboxUnderLock(userId, transport);
  if (navigator.locks?.request) {
    await navigator.locks.request(lock, run);
  } else {
    await run();
  }
}

async function flushOutboxUnderLock(
  userId: string,
  transport: UserChannelTransport
): Promise<void> {
  const db = localDatabase();
  const now = Date.now();
  const candidates = await db.outbox.where('userId').equals(userId).toArray();
  for (const candidate of candidates
    .filter(
      (item) =>
        (item.state === 'queued' && Date.parse(item.nextAttemptAt) <= now) ||
        (item.state === 'sending' &&
          (!item.leaseUntil || Date.parse(item.leaseUntil) <= now))
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    const leaseId = newId();
    const claimed = await db.transaction('rw', db.outbox, async () => {
      const current = await db.outbox.get(candidate.id);
      const currentNow = Date.now();
      if (
        !current ||
        current.userId !== userId ||
        (current.state !== 'queued' && current.state !== 'sending') ||
        Date.parse(current.nextAttemptAt) > currentNow ||
        (current.state === 'sending' &&
          !!current.leaseUntil &&
          Date.parse(current.leaseUntil) > currentNow)
      ) {
        return undefined;
      }
      await db.outbox.update(current.id, {
        state: 'sending',
        leaseId,
        leaseUntil: new Date(currentNow + 60_000).toISOString(),
        updatedAt: nowIso(),
        attemptCount: current.attemptCount + 1,
      });
      return { ...current, leaseId };
    });
    if (!claimed) continue;

    try {
      const receipt = await transport.publishRequest(claimed);
      await db.transaction('rw', db.outbox, async () => {
        const current = await db.outbox.get(claimed.id);
        if (!current || current.leaseId !== leaseId) return;
        await db.outbox.update(current.id, {
          state: 'accepted',
          serverRequestId: receipt.requestId,
          updatedAt: receipt.acceptedAt,
          leaseId: null,
          leaseUntil: null,
          lastError: null,
        });
      });
    } catch (error) {
      const attempt = claimed.attemptCount + 1;
      const delay = Math.min(
        60_000 * 2 ** Math.min(attempt - 1, 8),
        6 * 60 * 60_000
      );
      const retryAt = new Date(Date.now() + delay).toISOString();
      await db.transaction('rw', db.outbox, async () => {
        const current = await db.outbox.get(claimed.id);
        if (!current || current.leaseId !== leaseId) return;
        await db.outbox.update(current.id, {
          state: 'queued',
          nextAttemptAt: retryAt,
          updatedAt: nowIso(),
          leaseId: null,
          leaseUntil: null,
          lastError:
            error instanceof Error
              ? error.message.slice(0, 300)
              : 'Network error',
        });
      });
    }
  }
}

export async function syncUserChannel(
  userId: string,
  transport: UserChannelTransport
): Promise<void> {
  const db = localDatabase();
  const cursorKey = `${userId}:user-channel-cursor`;
  const savedCursor = await db.meta.get(cursorKey);
  const page = await transport.readEvents(userId, savedCursor?.value ?? null);
  if (page.events.some((event) => event.userId !== userId)) {
    throw new Error('The user channel returned an event for another account.');
  }
  await db.transaction('rw', db.processEvents, db.outbox, db.meta, async () => {
    for (const event of page.events) {
      await db.processEvents.put(event);
      if (!event.idempotencyKey || !event.outcome) continue;
      const item = await db.outbox
        .where('[userId+idempotencyKey]')
        .equals([userId, event.idempotencyKey])
        .first();
      if (!item) continue;
      const state: OutboxState =
        event.outcome === 'accepted'
          ? 'accepted'
          : event.outcome === 'approval_required'
            ? 'approval_required'
            : event.outcome === 'failed'
              ? 'needs_attention'
              : 'complete';
      await db.outbox.update(item.id, {
        state,
        updatedAt: event.observedAt,
        lastError: event.outcome === 'failed' ? event.summary : null,
      });
    }
    if (page.nextCursor) {
      await db.meta.put({
        key: cursorKey,
        userId,
        value: page.nextCursor,
        updatedAt: nowIso(),
      });
    }
  });
}
