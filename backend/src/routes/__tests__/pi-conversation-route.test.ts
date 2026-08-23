import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { sessions } from '../sessions';

const app = new Hono().route('/api/sessions', sessions);

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
});
