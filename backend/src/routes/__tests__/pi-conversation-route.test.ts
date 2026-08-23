import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { IDENTITY } from '../../../../shared/identity';
import { LOCAL_PEER_ID } from '../../../../shared/types';
import { peers } from '../peers';
import { sessions } from '../sessions';

const app = new Hono()
  .route('/api/sessions', sessions)
  .route('/api/peers', peers);
const DATA_DIR_ENV = IDENTITY.dataDirEnv;
let dataDir: string;
let savedDataDir: string | undefined;

beforeEach(async () => {
  savedDataDir = process.env[DATA_DIR_ENV];
  dataDir = await mkdtemp(join(tmpdir(), 'pi-conversation-route-'));
  process.env[DATA_DIR_ENV] = dataDir;
});

afterEach(async () => {
  if (savedDataDir === undefined) delete process.env[DATA_DIR_ENV];
  else process.env[DATA_DIR_ENV] = savedDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

describe('GET /api/sessions/history/:sessionId/conversation for Pi', () => {
  test('rejects an encoded absolute path before consulting history', async () => {
    const response = await app.request(
      '/api/sessions/history/%2Fetc%2Fpasswd/conversation?agent=pi',
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid Pi session id' });
  });

  test('rejects a non-canonical Pi identifier', async () => {
    const response = await app.request(
      '/api/sessions/history/not-a-uuid/conversation?agent=pi',
    );

    expect(response.status).toBe(400);
  });

  test('rejects an invalid Pi identifier through the self-peer route', async () => {
    const response = await app.request(
      `/api/peers/history/${LOCAL_PEER_ID}/%2Fetc%2Fpasswd/conversation?agent=pi`,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid Pi session id' });
  });
});
