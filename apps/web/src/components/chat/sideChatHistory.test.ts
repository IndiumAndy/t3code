import { EnvironmentId, RunId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { latestAnsweredSideChat } from "./sideChatHistory";

it("reopens the latest completed reply belonging to this parent on this environment", () => {
  const parent = { environmentId: EnvironmentId.make("local"), threadId: ThreadId.make("main") };
  const answer = (id: string, completedAt: string) => ({
    id: ThreadId.make(id),
    environmentId: parent.environmentId,
    deletedAt: null,
    archivedAt: null,
    lineage: {
      rootThreadId: parent.threadId,
      parentThreadId: parent.threadId,
      relationshipToParent: "fork" as const,
      sideChat: true,
      forkedFrom: null,
    },
    latestRun: {
      runId: RunId.make(id),
      assistantMessageId: null,
      status: "completed" as const,
      startedAt: null,
      requestedAt: null,
      completedAt,
    },
  });
  const first = answer("first", "2026-01-01T00:00:00Z");
  const second = answer("second", "2026-01-02T00:00:00Z");
  const other = answer("other", "2026-01-03T00:00:00Z");
  const ineligible = [
    { ...other, environmentId: EnvironmentId.make("remote") },
    { ...other, lineage: { ...other.lineage, parentThreadId: other.id } },
    { ...other, lineage: { ...other.lineage, sideChat: false } },
    { ...other, archivedAt: "archived" },
    { ...other, deletedAt: "deleted" },
    { ...other, latestRun: null },
    { ...other, latestRun: { ...other.latestRun, status: "running" as const } },
  ];
  expect(latestAnsweredSideChat(parent, [second, first, ...ineligible])?.id).toBe(second.id);
  expect(latestAnsweredSideChat(parent, ineligible)).toBeUndefined();
});
