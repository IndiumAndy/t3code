import { expect, it } from "vite-plus/test";
import { workerConversation } from "./antigravityWorkerConversation";

it("shows private receipts from the coordinator in the selected worker’s transcript", () => {
  const root = "90000000-0000-4000-8000-000000000001";
  const worker = "90000000-0000-4000-8000-000000000002";
  const message = (index: number, sender: string) =>
    JSON.stringify({
      step_index: index,
      type: "SYSTEM_MESSAGE",
      content: `<SYSTEM_MESSAGE>\n[Message] timestamp=2026-11-24T21:11:43Z sender=${sender} priority=MESSAGE_PRIORITY_HIGH content=message\n</SYSTEM_MESSAGE>`,
    });
  const roster = {
    name: `/profile/brain/${root}/.system_generated/swarm/members.json`,
    text: JSON.stringify({ members: { amber: { conversation_id: worker } } }),
    modified: 1,
  };
  const transcript = {
    name: `/profile/brain/${worker}/.system_generated/logs/transcript.jsonl`,
    text: [message(1, worker), message(2, root)].join("\n"),
    modified: 2,
  };
  const packet = { sessionId: root, revision: "2", files: [roster, transcript] };
  expect(workerConversation(packet, worker)?.messages).toEqual([
    { index: 2, who: "coordinator", text: "message" },
  ]);
  expect(workerConversation({ ...packet, files: [roster] }, worker)).toBeNull();
  expect(workerConversation({ ...packet, sessionId: worker }, worker)).toBeNull();
});
