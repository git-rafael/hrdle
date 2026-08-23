import {
	isAgentProvider,
	type AgentProvider,
	type StewardTurn,
} from "../../../shared/types";

export interface StewardConversationSource {
	agentSessionId: string;
	agent?: AgentProvider;
	messageId?: string;
}

/** Older stored sources have no provider, so decode the optional extension at this boundary. */
export function stewardConversationSource(
	source: NonNullable<StewardTurn["source"]>,
): StewardConversationSource {
	const candidate = "agent" in source ? source.agent : undefined;
	const agent = typeof candidate === "string" && isAgentProvider(candidate)
		? candidate
		: undefined;
	return {
		agentSessionId: source.agentSessionId,
		...(agent ? { agent } : {}),
		messageId: source.messageIds?.[0],
	};
}

export function stewardSourceConversationPath(source: StewardConversationSource): string {
	const path = `/api/sessions/history/${encodeURIComponent(source.agentSessionId)}/conversation`;
	return source.agent ? `${path}?agent=${encodeURIComponent(source.agent)}` : path;
}
