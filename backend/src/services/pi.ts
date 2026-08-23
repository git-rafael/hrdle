import { readFileSync } from 'node:fs';
import { open, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import type { AgentThread, AgentThreadService } from './agent-providers';

export interface PiSessionInfo {
  sessionId: string;
  path: string;
  cwd: string;
  title?: string;
  firstPrompt?: string;
  lastPrompt?: string;
  lastAssistantMessage?: string;
  lastAssistantAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PiEntry {
  type?: string;
  id?: unknown;
  parentId?: unknown;
  timestamp?: unknown;
  version?: unknown;
  cwd?: unknown;
  name?: unknown;
  message?: {
    role?: unknown;
    content?: unknown;
    toolCallId?: unknown;
    toolName?: unknown;
    isError?: unknown;
    usage?: {
      input?: unknown;
      output?: unknown;
      cacheRead?: unknown;
      cacheWrite?: unknown;
      totalTokens?: unknown;
    };
    model?: unknown;
  };
}

const SESSION_LIST_CACHE_TTL_MS = 5000;
const MAX_TRANSCRIPT_CACHE = 8;
const PI_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCanonicalPiSessionId(value: string): boolean {
  return PI_SESSION_ID_PATTERN.test(value);
}

interface CachedPiMetadata {
  mtimeMs: number;
  size: number;
  info: PiSessionInfo;
}

interface CachedPiSession extends CachedPiMetadata {
  /** Bytes already parsed. A partial append leaves this unchanged until its newline arrives. */
  size: number;
  entries: PiEntry[];
  activeEntries: PiEntry[];
}

function expandPath(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

function defaultAgentDir(): string {
  return expandPath(process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent'));
}

function configuredSessionDir(agentDir: string): string | undefined {
  if (process.env.PI_CODING_AGENT_SESSION_DIR) {
    return expandPath(process.env.PI_CODING_AGENT_SESSION_DIR);
  }
  try {
    const settings = JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf8')) as {
      sessionDir?: unknown;
    };
    return typeof settings.sessionDir === 'string' && settings.sessionDir.trim()
      ? expandPath(settings.sessionDir)
      : undefined;
  } catch {
    return undefined;
  }
}

function defaultSessionRoots(): string[] {
  const agentDir = defaultAgentDir();
  return [...new Set([
    configuredSessionDir(agentDir),
    join(agentDir, 'shared-sessions'),
    join(agentDir, 'sessions'),
  ].filter((path): path is string => Boolean(path)))];
}

function textContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((part) =>
      part && typeof part === 'object' && (part as { type?: unknown }).type === 'text' &&
      typeof (part as { text?: unknown }).text === 'string'
        ? [(part as { text: string }).text]
        : [])
    .join('\n');
}

export function parsePiEntries(text: string): PiEntry[] {
  const entries: PiEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as PiEntry);
    } catch {
      // A partially written final JSONL line is ignored until the next read.
    }
  }
  return entries;
}

function parsePiChunk(text: string): { entries: PiEntry[]; parsedBytes: number } {
  if (text.endsWith('\n')) {
    return { entries: parsePiEntries(text), parsedBytes: Buffer.byteLength(text) };
  }
  const lastNewline = text.lastIndexOf('\n');
  const trailing = text.slice(lastNewline + 1);
  try {
    JSON.parse(trailing);
    return { entries: parsePiEntries(text), parsedBytes: Buffer.byteLength(text) };
  } catch {
    const complete = lastNewline >= 0 ? text.slice(0, lastNewline + 1) : '';
    return { entries: parsePiEntries(complete), parsedBytes: Buffer.byteLength(complete) };
  }
}

/** Follow Pi's current leaf (the last entry) back to the root of its append-only tree. */
export function activePiEntries(entries: PiEntry[]): PiEntry[] {
  const sessionEntries = entries.filter((entry) => entry.type !== 'session');
  if (sessionEntries.length === 0) return [];
  if (!sessionEntries.every((entry) => typeof entry.id === 'string')) {
    return sessionEntries;
  }

  const byId = new Map<string, PiEntry>();
  for (const entry of sessionEntries) byId.set(entry.id as string, entry);
  const path: PiEntry[] = [];
  const visited = new Set<string>();
  let current: PiEntry | undefined = sessionEntries.at(-1);
  while (current && typeof current.id === 'string' && !visited.has(current.id)) {
    path.push(current);
    visited.add(current.id);
    current = typeof current.parentId === 'string' ? byId.get(current.parentId) : undefined;
  }
  return path.reverse();
}

function latestTimestamp(entries: PiEntry[], fallback: string): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const timestamp = entries[i]?.timestamp;
    if (typeof timestamp === 'string') return timestamp;
  }
  return fallback;
}

export function piSessionMetadata(
  path: string,
  allEntries: PiEntry[],
): PiSessionInfo | undefined {
  const header = allEntries.find((entry) => entry.type === 'session');
  if (
    !header ||
    header.version !== 3 ||
    typeof header.id !== 'string' ||
    !isCanonicalPiSessionId(header.id) ||
    typeof header.cwd !== 'string'
  ) {
    return undefined;
  }

  const branch = activePiEntries(allEntries);
  const createdAt = typeof header.timestamp === 'string'
    ? header.timestamp
    : new Date(0).toISOString();
  const prompts: string[] = [];
  let title: string | undefined;
  let lastAssistantMessage: string | undefined;
  let lastAssistantAt: string | undefined;

  for (const entry of branch) {
    if (entry.type === 'session_info') {
      title = typeof entry.name === 'string' && entry.name.trim()
        ? entry.name.trim()
        : undefined;
      continue;
    }
    if (entry.type !== 'message') continue;
    const content = textContent(entry.message?.content).trim();
    if (entry.message?.role === 'user' && content) prompts.push(content);
    if (entry.message?.role !== 'assistant') continue;
    if (content) {
      lastAssistantMessage = content;
      lastAssistantAt = typeof entry.timestamp === 'string' ? entry.timestamp : undefined;
    }
  }

  return {
    sessionId: header.id,
    path,
    cwd: header.cwd,
    title,
    firstPrompt: prompts[0],
    lastPrompt: prompts.at(-1),
    lastAssistantMessage,
    lastAssistantAt,
    createdAt,
    updatedAt: latestTimestamp(branch, createdAt),
  };
}

export function parsePiSessionMetadata(path: string, text: string): PiSessionInfo | undefined {
  return piSessionMetadata(path, parsePiEntries(text));
}

function metadataProjection(entry: PiEntry): PiEntry {
  const projected: PiEntry = {
    type: entry.type,
    id: entry.id,
    parentId: entry.parentId,
    timestamp: entry.timestamp,
  };
  if (entry.type === 'session_info') projected.name = entry.name;
  if (entry.type === 'message' && (
    entry.message?.role === 'user' || entry.message?.role === 'assistant'
  )) {
    projected.message = {
      role: entry.message.role,
      content: textContent(entry.message.content),
      usage: entry.message.usage,
      model: entry.message.model,
    };
  }
  return projected;
}

async function readPiMetadataEntries(path: string): Promise<PiEntry[]> {
  const handle = await open(path, 'r');
  const selected: PiEntry[] = [];
  let header: PiEntry | undefined;
  let wantedId: string | undefined;

  const consume = (line: Buffer): void => {
    if (!line.length) return;
    let entry: PiEntry;
    try {
      entry = JSON.parse(line.toString('utf8')) as PiEntry;
    } catch {
      return;
    }
    if (entry.type === 'session') {
      header = entry;
      return;
    }
    if (typeof entry.id !== 'string') return;
    if (wantedId === undefined) {
      wantedId = entry.id;
    }
    if (entry.id !== wantedId) return;
    selected.push(metadataProjection(entry));
    wantedId = typeof entry.parentId === 'string' ? entry.parentId : '';
  };

  try {
    const { size } = await handle.stat();
    let position = Number(size);
    let suffix = Buffer.alloc(0);
    const chunkSize = 1024 * 1024;
    while (position > 0) {
      const start = Math.max(0, position - chunkSize);
      const chunk = Buffer.alloc(position - start);
      await handle.read(chunk, 0, chunk.length, start);
      const data = Buffer.concat([chunk, suffix]);
      let lineEnd = data.length;
      for (let index = data.length - 1; index >= 0; index--) {
        if (data[index] !== 0x0a) continue;
        consume(data.subarray(index + 1, lineEnd));
        lineEnd = index;
      }
      suffix = data.subarray(0, lineEnd);
      position = start;
    }
    consume(suffix);
  } finally {
    await handle.close();
  }

  return header ? [header, ...selected.reverse()] : selected.reverse();
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  fn: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await fn(values[index]);
    }
    return undefined;
  });
  await Promise.all(workers);
  return results;
}

export class PiSessionStore {
  private roots: string[];
  private cache: { timestamp: number; sessions: PiSessionInfo[] } | null = null;
  private metadataCache = new Map<string, CachedPiMetadata>();
  private transcriptCache = new Map<string, CachedPiSession>();
  private sessionsById = new Map<string, CachedPiMetadata>();

  constructor(roots = defaultSessionRoots()) {
    this.roots = roots.map((path) => expandPath(path));
  }

  async listSessions(): Promise<PiSessionInfo[]> {
    if (this.cache && Date.now() - this.cache.timestamp < SESSION_LIST_CACHE_TTL_MS) {
      return this.cache.sessions;
    }
    const paths = await this.sessionPaths();
    const loaded = await mapWithConcurrency(paths, 2, (path) => this.loadMetadata(path));
    const byId = new Map<string, CachedPiMetadata>();
    for (const session of loaded) {
      if (!session) continue;
      const existing = byId.get(session.info.sessionId);
      if (!existing || session.info.updatedAt > existing.info.updatedAt) {
        byId.set(session.info.sessionId, session);
      }
    }
    this.sessionsById = byId;
    const result = [...byId.values()].map((session) => session.info);
    this.cache = { timestamp: Date.now(), sessions: result };
    return result;
  }

  async findSession(reference: string): Promise<PiSessionInfo | undefined> {
    return (await this.resolveTrustedSession(reference))?.info;
  }

  async findPublicSession(sessionId: string): Promise<PiSessionInfo | undefined> {
    return (await this.resolvePublicSession(sessionId))?.info;
  }

  async getActiveEntries(reference: string): Promise<PiEntry[] | undefined> {
    return (await this.resolveTrustedSession(reference))?.activeEntries;
  }

  async getPublicActiveEntries(sessionId: string): Promise<PiEntry[] | undefined> {
    return (await this.resolvePublicSession(sessionId))?.activeEntries;
  }

  private async resolveTrustedSession(reference: string): Promise<CachedPiSession | undefined> {
    if (isAbsolute(reference)) {
      const path = await realpath(reference).catch(() => undefined);
      if (!path || !path.endsWith('.jsonl')) return undefined;
      const session = await this.loadTranscript(path);
      if (session) {
        this.sessionsById.set(session.info.sessionId, session);
        const root = dirname(path);
        if (!this.roots.includes(root)) {
          this.roots.push(root);
          this.cache = null;
        }
      }
      return session;
    }
    return this.resolvePublicSession(reference);
  }

  private async resolvePublicSession(sessionId: string): Promise<CachedPiSession | undefined> {
    if (!isCanonicalPiSessionId(sessionId)) {
      return undefined;
    }
    const indexed = this.sessionsById.get(sessionId);
    if (indexed) return this.loadTranscript(indexed.info.path);
    await this.listSessions();
    const found = this.sessionsById.get(sessionId);
    return found ? this.loadTranscript(found.info.path) : undefined;
  }

  private async sessionPaths(): Promise<string[]> {
    const paths = new Set<string>();
    for (const root of this.roots) {
      const glob = new Bun.Glob('**/*.jsonl');
      try {
        for await (const entry of glob.scan({ cwd: root, absolute: true, onlyFiles: true })) {
          paths.add(entry);
        }
      } catch {
        // A missing or unreadable session root contributes no history.
      }
    }
    return [...paths];
  }

  private async loadMetadata(path: string): Promise<CachedPiMetadata | undefined> {
    let fileStat: Awaited<ReturnType<typeof stat>>;
    try {
      fileStat = await stat(path);
    } catch {
      return undefined;
    }
    const cached = this.metadataCache.get(path);
    if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
      return cached;
    }
    let entries: PiEntry[];
    try {
      entries = await readPiMetadataEntries(path);
    } catch {
      return undefined;
    }
    const info = piSessionMetadata(path, entries);
    if (!info) return undefined;
    const metadata = {
      mtimeMs: Number(fileStat.mtimeMs),
      size: Number(fileStat.size),
      info,
    };
    this.metadataCache.set(path, metadata);
    return metadata;
  }

  private async loadTranscript(path: string): Promise<CachedPiSession | undefined> {
    let fileStat: Awaited<ReturnType<typeof stat>>;
    try {
      fileStat = await stat(path);
    } catch {
      return undefined;
    }
    const cached = this.transcriptCache.get(path);
    if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
      this.touchTranscript(path, cached);
      return cached;
    }
    const loaded = await this.readTranscript(path, fileStat, cached);
    if (!loaded) return undefined;
    this.touchTranscript(path, loaded);
    this.metadataCache.set(path, {
      mtimeMs: loaded.mtimeMs,
      size: loaded.size,
      info: loaded.info,
    });
    return loaded;
  }

  private async readTranscript(
    path: string,
    fileStat: Awaited<ReturnType<typeof stat>>,
    cached?: CachedPiSession,
  ): Promise<CachedPiSession | undefined> {
    let entries: PiEntry[];
    let parsedSize: number;
    if (cached && fileStat.size > cached.size) {
      const appended = await Bun.file(path).slice(cached.size, Number(fileStat.size)).text().catch(() => '');
      const chunk = parsePiChunk(appended);
      if (chunk.parsedBytes === 0) return cached;
      entries = [...cached.entries, ...chunk.entries];
      parsedSize = cached.size + chunk.parsedBytes;
    } else {
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch {
        return undefined;
      }
      const chunk = parsePiChunk(text);
      entries = chunk.entries;
      parsedSize = chunk.parsedBytes;
    }
    const info = piSessionMetadata(path, entries);
    if (!info) return undefined;
    return {
      mtimeMs: Number(fileStat.mtimeMs),
      size: parsedSize,
      entries,
      info,
      activeEntries: activePiEntries(entries),
    };
  }

  private touchTranscript(path: string, session: CachedPiSession): void {
    this.transcriptCache.delete(path);
    this.transcriptCache.set(path, session);
    while (this.transcriptCache.size > MAX_TRANSCRIPT_CACHE) {
      const oldest = this.transcriptCache.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.transcriptCache.delete(oldest);
    }
  }
}

export const piSessionStore = new PiSessionStore();

export class PiService implements AgentThreadService {
  constructor(private store = piSessionStore) {}

  async getThreadsByIds(references: string[]): Promise<Map<string, AgentThread>> {
    const result = new Map<string, AgentThread>();
    for (const reference of new Set(references.filter(Boolean))) {
      const session = await this.store.findSession(reference);
      if (!session) continue;
      result.set(reference, {
        sessionId: session.sessionId,
        title: session.title,
        firstPrompt: session.firstPrompt,
        recap: session.lastAssistantMessage,
        recapAt: session.lastAssistantAt,
        cwd: session.cwd,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });
    }
    return result;
  }
}
