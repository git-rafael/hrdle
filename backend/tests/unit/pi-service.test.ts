import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PiService, PiSessionStore, activePiEntries } from '../../src/services/pi';
import { PiHistoryService, parsePiConversation } from '../../src/services/pi-history';
import { claudeProjectDirName } from '../../src/utils/claude-project-path';

const TEST_DIR = join(tmpdir(), `hrdle-pi-service-${Date.now()}`);
const SHARED_DIR = join(TEST_DIR, 'shared-sessions');
const PROJECTS_DIR = join(TEST_DIR, 'sessions');
const CWD = '/home/user/my-project';
const SESSION_ID = '019ffb3b-0c1b-71b9-b575-45677d8737ed';
const SESSION_FILE = join(SHARED_DIR, `2026-08-13T13-06-18-779Z_${SESSION_ID}.jsonl`);

const PI_JSONL = [
  {
    type: 'session',
    version: 3,
    id: SESSION_ID,
    timestamp: '2026-08-13T13:06:18.779Z',
    cwd: CWD,
  },
  {
    type: 'session_info',
    id: 'title-1',
    parentId: null,
    timestamp: '2026-08-13T13:06:20.000Z',
    name: 'Initial name',
  },
  {
    type: 'message',
    id: 'user-1',
    parentId: 'title-1',
    timestamp: '2026-08-13T13:10:56.341Z',
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'Inspect the project' }],
      timestamp: 1786626656326,
    },
  },
  {
    type: 'message',
    id: 'assistant-1',
    parentId: 'user-1',
    timestamp: '2026-08-13T13:11:03.619Z',
    message: {
      role: 'assistant',
      model: 'gpt-5.6-sol',
      usage: { input: 100, output: 20, cacheRead: 80, totalTokens: 200 },
      content: [
        { type: 'thinking', thinking: 'I should inspect it.' },
        { type: 'text', text: 'I will inspect it.' },
        {
          type: 'toolCall',
          id: 'call-1',
          name: 'read',
          arguments: { path: '/tmp/file.ts' },
        },
      ],
    },
  },
  {
    type: 'message',
    id: 'result-1',
    parentId: 'assistant-1',
    timestamp: '2026-08-13T13:11:04.827Z',
    message: {
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'read',
      content: [{ type: 'text', text: 'export const value = 1;' }],
      isError: false,
    },
  },
  {
    type: 'message',
    id: 'assistant-2',
    parentId: 'result-1',
    timestamp: '2026-08-13T13:11:10.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'The project exports one value.' }],
    },
  },
  {
    type: 'message',
    id: 'user-2',
    parentId: 'assistant-2',
    timestamp: '2026-08-13T13:12:00.000Z',
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'Now add tests' }],
    },
  },
  {
    type: 'session_info',
    id: 'title-2',
    parentId: 'user-2',
    timestamp: '2026-08-13T13:12:01.000Z',
    name: 'Pi adapter work',
  },
].map((entry) => JSON.stringify(entry)).join('\n');

beforeEach(async () => {
  await mkdir(SHARED_DIR, { recursive: true });
  await mkdir(PROJECTS_DIR, { recursive: true });
  await writeFile(SESSION_FILE, PI_JSONL);
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('PiSessionStore', () => {
  test('lists session metadata from Pi JSONL', async () => {
    const store = new PiSessionStore([SHARED_DIR, PROJECTS_DIR]);
    const sessions = await store.listSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: SESSION_ID,
      path: SESSION_FILE,
      cwd: CWD,
      title: 'Pi adapter work',
      firstPrompt: 'Inspect the project',
      lastPrompt: 'Now add tests',
      createdAt: '2026-08-13T13:06:18.779Z',
    });
  });

  test('resolves the exact Herdr path and the canonical UUID', async () => {
    const store = new PiSessionStore([SHARED_DIR, PROJECTS_DIR]);

    expect((await store.findSession(SESSION_FILE))?.sessionId).toBe(SESSION_ID);
    expect((await store.findSession(SESSION_ID))?.path).toBe(SESSION_FILE);
  });

  test('keeps the header metadata when a long session tail no longer contains it', async () => {
    const entries = PI_JSONL.split('\n');
    const filler = Array.from({ length: 500 }, (_, index) => JSON.stringify({
      type: 'custom',
      customType: 'fixture',
      timestamp: `2026-08-13T14:${String(index % 60).padStart(2, '0')}:00.000Z`,
    }));
    await writeFile(SESSION_FILE, [entries[0], ...filler, ...entries.slice(1)].join('\n'));
    const store = new PiSessionStore([SHARED_DIR, PROJECTS_DIR]);

    expect(await store.findSession(SESSION_FILE)).toMatchObject({
      sessionId: SESSION_ID,
      cwd: CWD,
      title: 'Pi adapter work',
      lastPrompt: 'Now add tests',
    });
  });

  test('accepts an exact valid Pi path reported by Herdr outside discovered roots', async () => {
    const outside = join(TEST_DIR, 'custom-session-dir', 'outside.jsonl');
    await mkdir(join(TEST_DIR, 'custom-session-dir'), { recursive: true });
    await writeFile(outside, PI_JSONL);
    const store = new PiSessionStore([SHARED_DIR, PROJECTS_DIR]);

    expect(await store.findSession(outside)).toMatchObject({ sessionId: SESSION_ID, path: outside });
  });

  test('does not accept an absolute path through the public history lookup', async () => {
    const outside = join(TEST_DIR, 'custom-session-dir', 'public.jsonl');
    await mkdir(join(TEST_DIR, 'custom-session-dir'), { recursive: true });
    await writeFile(outside, PI_JSONL);
    const store = new PiSessionStore([SHARED_DIR, PROJECTS_DIR]);

    expect(await store.findPublicSession(outside)).toBeUndefined();
    expect(await store.getPublicActiveEntries(outside)).toBeUndefined();
  });

  test('rejects a path that is not a Pi v3 session', async () => {
    const outside = join(TEST_DIR, 'outside.jsonl');
    await writeFile(outside, '{"type":"other","id":"not-pi"}\n');
    const store = new PiSessionStore([SHARED_DIR, PROJECTS_DIR]);

    expect(await store.findSession(outside)).toBeUndefined();
  });

  test('adds only appended records after the first read', async () => {
    const store = new PiSessionStore([SHARED_DIR, PROJECTS_DIR]);
    expect((await store.getActiveEntries(SESSION_FILE))?.at(-1)?.id).toBe('title-2');

    await appendFile(SESSION_FILE, '\n' + JSON.stringify({
      type: 'message',
      id: 'assistant-2',
      parentId: 'user-2',
      timestamp: '2026-08-13T13:13:00.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Appended answer' }] },
    }));

    const entries = await store.getActiveEntries(SESSION_FILE);
    expect(entries?.filter((entry) => entry.id === 'assistant-2')).toHaveLength(1);
    expect(entries?.at(-1)?.id).toBe('assistant-2');
  });
});

describe('PiService', () => {
  test('resolves a path-valued Herdr reference to a canonical Pi thread', async () => {
    const service = new PiService(new PiSessionStore([SHARED_DIR, PROJECTS_DIR]));
    const threads = await service.getThreadsByIds([SESSION_FILE, '/missing/session.jsonl']);

    expect(threads.size).toBe(1);
    expect(threads.get(SESSION_FILE)).toMatchObject({
      sessionId: SESSION_ID,
      title: 'Pi adapter work',
      firstPrompt: 'Inspect the project',
      recap: 'The project exports one value.',
      cwd: CWD,
    });
  });
});

describe('Pi active branch', () => {
  test('drops abandoned conversation branches', () => {
    const entries = [
      { type: 'message', id: 'root', parentId: null, timestamp: '2026-08-13T13:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text: 'root prompt' }] } },
      { type: 'message', id: 'old', parentId: 'root', timestamp: '2026-08-13T13:01:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'abandoned answer' }] } },
      { type: 'message', id: 'active', parentId: 'root', timestamp: '2026-08-13T13:02:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'active answer' }] } },
    ];

    const branch = activePiEntries(entries);
    expect(branch.map((entry) => entry.id)).toEqual(['root', 'active']);
    expect(parsePiConversation(branch).map((message) => message.content)).toEqual([
      'root prompt',
      'active answer',
    ]);
  });
});

describe('PiHistoryService', () => {
  test('groups and lists sessions as Pi history', async () => {
    const service = new PiHistoryService(new PiSessionStore([SHARED_DIR, PROJECTS_DIR]));

    expect(await service.getProjects()).toEqual([
      expect.objectContaining({
        dirName: claudeProjectDirName(CWD),
        projectPath: CWD,
        sessionCount: 1,
      }),
    ]);
    expect(await service.getProjectSessions(claudeProjectDirName(CWD))).toEqual([
      expect.objectContaining({
        sessionId: SESSION_ID,
        agent: 'pi',
        firstPrompt: 'Inspect the project',
        lastPrompt: 'Now add tests',
        summary: 'Pi adapter work',
      }),
    ]);
  });

  test('searches cwd, title, and prompts', async () => {
    const service = new PiHistoryService(new PiSessionStore([SHARED_DIR, PROJECTS_DIR]));

    expect(await service.searchSessions('adapter work')).toHaveLength(1);
    expect(await service.searchSessions('now add tests')).toHaveLength(1);
    expect(await service.searchSessions('missing words')).toEqual([]);
  });

  test('converts Pi messages and tool activity to conversation turns', async () => {
    const service = new PiHistoryService(new PiSessionStore([SHARED_DIR, PROJECTS_DIR]));
    const messages = await service.getConversation(SESSION_ID);

    expect(messages).toHaveLength(5);
    expect(messages[0]).toEqual({
      role: 'user',
      content: 'Inspect the project',
      timestamp: '2026-08-13T13:10:56.341Z',
    });
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: 'I will inspect it.',
      thinking: 'I should inspect it.',
      timestamp: '2026-08-13T13:11:03.619Z',
      toolUse: [{ id: 'call-1', name: 'read', input: { path: '/tmp/file.ts' } }],
    });
    expect(messages[2]).toEqual({
      role: 'user',
      content: '',
      timestamp: '2026-08-13T13:11:04.827Z',
      toolResult: [{
        toolUseId: 'call-1',
        toolName: 'read',
        output: 'export const value = 1;',
        isError: false,
      }],
    });
    expect(messages.at(-1)?.content).toBe('Now add tests');
  });
});
