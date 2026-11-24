import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef } from "@t3tools/contracts";

type SideChatCandidate = Pick<
  EnvironmentThreadShell,
  "id" | "environmentId" | "lineage" | "deletedAt" | "archivedAt" | "latestRun"
>;

export function latestAnsweredSideChat(
  parent: ScopedThreadRef,
  threads: readonly SideChatCandidate[],
) {
  let latest: SideChatCandidate | undefined;
  let answeredAt = "";
  for (const thread of threads) {
    if (
      thread.environmentId === parent.environmentId &&
      thread.lineage.parentThreadId === parent.threadId &&
      thread.lineage.sideChat === true &&
      thread.archivedAt === null &&
      thread.deletedAt === null &&
      thread.latestRun?.status === "completed" &&
      thread.latestRun.completedAt !== null &&
      thread.latestRun.completedAt > answeredAt
    ) {
      latest = thread;
      answeredAt = thread.latestRun.completedAt;
    }
  }
  return latest;
}
