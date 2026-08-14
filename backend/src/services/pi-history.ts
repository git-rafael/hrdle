import type {
  ConversationMessage,
  HistorySession,
  ToolResultInfo,
  ToolUseInfo,
} from '../../../shared/types';
import { claudeProjectDirName } from '../utils/claude-project-path';
import type { AgentHistoryProvider } from './agent-providers';
import {
  piSessionStore,
  type PiEntry,
  type PiSessionInfo,
} from './pi';
import type { ProjectInfo } from './session-history';

interface PiContentPart {
  type?: unknown;
  text?: unknown;
  thinking?: unknown;
  id?: unknown;
  name?: unknown;
  arguments?: unknown;
}

function objectInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textParts(content: unknown): string[] {
  if (typeof content === 'string') return content ? [content] : [];
  if (!Array.isArray(content)) return [];
  return content.flatMap((raw) => {
    const part = raw as PiContentPart | undefined;
    return part?.type === 'text' && typeof part.text === 'string' && part.text
      ? [part.text]
      : [];
  });
}

function thinkingParts(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((raw) => {
    const part = raw as PiContentPart | undefined;
    return part?.type === 'thinking' && typeof part.thinking === 'string' && part.thinking
      ? [part.thinking]
      : [];
  });
}

function toolCalls(content: unknown): ToolUseInfo[] {
  if (!Array.isArray(content)) return [];
  const calls: ToolUseInfo[] = [];
  for (const raw of content) {
    const part = raw as PiContentPart | undefined;
    if (part?.type !== 'toolCall' || typeof part.id !== 'string' || typeof part.name !== 'string') continue;
    calls.push({ id: part.id, name: part.name, input: objectInput(part.arguments) });
  }
  return calls;
}

/** Convert Pi's active branch records to the conversation API shape. */
export function parsePiConversation(entries: PiEntry[]): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  for (const entry of entries) {
    if (entry.type !== 'message' || !entry.message) continue;
    const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : undefined;
    const role = entry.message.role;

    if (role === 'user' || role === 'assistant') {
      const content = textParts(entry.message.content).join('\n\n');
      const thinking = role === 'assistant' ? thinkingParts(entry.message.content).join('\n\n') : '';
      const toolUse = role === 'assistant' ? toolCalls(entry.message.content) : [];
      if (!content && !thinking && toolUse.length === 0) continue;
      messages.push({
        role,
        content,
        timestamp,
        ...(thinking ? { thinking } : {}),
        ...(toolUse.length > 0 ? { toolUse } : {}),
      });
      continue;
    }

    if (role === 'toolResult' && typeof entry.message.toolCallId === 'string') {
      const result: ToolResultInfo = {
        toolUseId: entry.message.toolCallId,
        toolName: typeof entry.message.toolName === 'string' ? entry.message.toolName : undefined,
        output: textParts(entry.message.content).join('\n'),
        isError: entry.message.isError === true,
      };
      messages.push({ role: 'user', content: '', timestamp, toolResult: [result] });
    }
  }
  return messages;
}

export class PiHistoryService implements AgentHistoryProvider {
  constructor(private store = piSessionStore) {}

  async getProjects(): Promise<ProjectInfo[]> {
    const sessions = await this.store.listSessions();
    const byDir = new Map<string, ProjectInfo>();
    for (const session of sessions) {
      const dirName = claudeProjectDirName(session.cwd);
      const existing = byDir.get(dirName);
      if (existing) {
        existing.sessionCount++;
        if (!existing.latestModified || session.updatedAt > existing.latestModified) {
          existing.latestModified = session.updatedAt;
        }
      } else {
        byDir.set(dirName, {
          dirName,
          projectPath: session.cwd,
          projectName: session.cwd.replace(/^\/home\/[^/]+\//, '~/'),
          sessionCount: 1,
          latestModified: session.updatedAt,
        });
      }
    }
    return [...byDir.values()];
  }

  async getProjectSessions(dirName: string): Promise<HistorySession[]> {
    const sessions = await this.store.listSessions();
    return sessions
      .filter((session) => claudeProjectDirName(session.cwd) === dirName)
      .map((session) => this.toHistorySession(session))
      .sort((a, b) => b.modified.localeCompare(a.modified));
  }

  async getRecentSessions(limit = 30): Promise<HistorySession[]> {
    const sessions = await this.store.listSessions();
    return sessions
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((session) => this.toHistorySession(session));
  }

  async searchSessions(query: string, limit = 50): Promise<HistorySession[]> {
    if (!query.trim()) return [];
    const needle = query.toLowerCase();
    const sessions = await this.store.listSessions();
    return sessions
      .filter((session) =>
        `${session.cwd} ${session.title ?? ''} ${session.firstPrompt ?? ''} ${session.lastPrompt ?? ''}`
          .toLowerCase()
          .includes(needle))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((session) => this.toHistorySession(session));
  }

  async getConversation(sessionId: string): Promise<ConversationMessage[]> {
    const entries = await this.store.getPublicActiveEntries(sessionId);
    return entries ? parsePiConversation(entries) : [];
  }

  private toHistorySession(session: PiSessionInfo): HistorySession {
    return {
      sessionId: session.sessionId,
      projectPath: session.cwd,
      projectName: session.cwd.replace(/^\/home\/[^/]+\//, '~/'),
      firstPrompt: session.firstPrompt,
      lastPrompt: session.lastPrompt,
      summary: session.title,
      modified: session.updatedAt,
      startTime: session.createdAt,
      agent: 'pi',
    };
  }
}
