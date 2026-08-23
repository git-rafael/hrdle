import { describe, expect, test } from 'bun:test';
import { publicAgentSessionId } from '../../src/routes/sessions';

const FIRST_PI_ID = '019ffb3b-0c1b-71b9-b575-45677d8737ed';
const SECOND_PI_ID = '019fffdd-2125-7a4f-8a73-54c426069e4e';

describe('publicAgentSessionId', () => {
  test('publishes only the resolved canonical Pi UUID', () => {
    const path = '/home/user/.pi/agent/shared-sessions/first.jsonl';

    expect(publicAgentSessionId('pi', path, FIRST_PI_ID)).toBe(FIRST_PI_ID);
    expect(publicAgentSessionId('pi', path, 'not-a-uuid')).toBeUndefined();
    expect(publicAgentSessionId('pi', path)).toBeUndefined();
  });

  test('keeps distinct canonical identities for multiple Pi panes', () => {
    const panes = [
      publicAgentSessionId('pi', '/sessions/first.jsonl', FIRST_PI_ID),
      publicAgentSessionId('pi', '/sessions/second.jsonl', SECOND_PI_ID),
    ];

    expect(panes).toEqual([FIRST_PI_ID, SECOND_PI_ID]);
  });

  test('preserves the existing fallback for other agents', () => {
    expect(publicAgentSessionId('codex', 'thread-abc')).toBe('thread-abc');
    expect(publicAgentSessionId('claude', 'session-abc')).toBe('session-abc');
  });
});
