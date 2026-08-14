import { describe, expect, test } from 'bun:test';
import { herdrPaneCommand, indexHerdrAgentPanes } from '../../src/services/herdr';

describe('HerdrService agent identity', () => {
  test('uses agent.list instead of the foreground process name', () => {
    const agents = indexHerdrAgentPanes([{
      pane_id: 'w1:p1',
      agent: 'codex',
      agent_status: 'blocked',
      agent_session: {
        kind: 'id',
        value: 'codex-session-id',
      },
    }]);
    const pane = agents.get('w1:p1');

    expect(pane).toMatchObject({
      agent: 'codex',
      sessionId: 'codex-session-id',
      status: 'blocked',
    });
    expect(herdrPaneCommand('node-MainThread', pane)).toBe('codex');
  });

  test('keeps the path-valued session reference reported for Pi', () => {
    const agents = indexHerdrAgentPanes([{
      pane_id: 'w1:p2',
      agent: 'pi',
      agent_status: 'working',
      agent_session: {
        kind: 'path',
        value: '/home/user/.pi/agent/shared-sessions/session.jsonl',
      },
    }]);

    expect(agents.get('w1:p2')).toMatchObject({
      agent: 'pi',
      sessionId: '/home/user/.pi/agent/shared-sessions/session.jsonl',
      status: 'working',
    });
  });
});
