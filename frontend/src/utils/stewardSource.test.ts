import { describe, expect, test } from "bun:test";
import { stewardSourceConversationPath } from "./stewardSource";

describe("stewardSourceConversationPath", () => {
	test("routes Pi sources through the Pi history provider", () => {
		expect(
			stewardSourceConversationPath({
				agentSessionId: "019ffb3b-0c1b-71b9-b575-45677d8737ed",
				agent: "pi",
			}),
		).toBe(
			"/api/sessions/history/019ffb3b-0c1b-71b9-b575-45677d8737ed/conversation?agent=pi",
		);
	});

	test("keeps legacy Claude sources on the default provider", () => {
		expect(stewardSourceConversationPath({ agentSessionId: "claude-session" })).toBe(
			"/api/sessions/history/claude-session/conversation",
		);
	});
});
