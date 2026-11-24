import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { ServerConfig } from "../config.ts";
import { resolveAntigravityInstanceDirectories } from "../provider/antigravityAuthSupport.ts";
import { ThreadManagementService } from "./ThreadManagementService.ts";

export const antigravityConversationId = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

export const resolveAntigravityThreadSession = Effect.fn("resolveAntigravityThreadSession")(
  function* (threadId: ThreadId) {
    const threads = yield* ThreadManagementService;
    const { thread, providerThreads } = yield* threads.getThreadRecords(threadId, [
      "providerThreads",
    ]);
    const active = providerThreads.find((p) => p.id === thread.activeProviderThreadId);
    if (
      thread.deletedAt !== null ||
      active?.appThreadId !== threadId ||
      active.driver !== "antigravity" ||
      active.providerInstanceId !== thread.providerInstanceId
    ) {
      return null;
    }
    let nativeSessionId = active.nativeThreadRef?.nativeId;
    if (!nativeSessionId || !antigravityConversationId.test(nativeSessionId)) {
      const { runs } = yield* threads.getThreadRecords(threadId, ["runs"]);
      const latest = runs
        .filter((r) => r.providerThreadId === active.id)
        .reduce<(typeof runs)[number] | undefined>(
          (a, b) => (!a || b.ordinal > a.ordinal ? b : a),
          undefined,
        );
      if (!latest?.activeAttemptId) return null;
      const { attempts } = yield* threads.getThreadRecords(threadId, ["attempts"], {
        attemptIds: [latest.activeAttemptId],
      });
      nativeSessionId = attempts.find(
        (a) =>
          a.id === latest.activeAttemptId &&
          a.providerThreadId === active.id &&
          a.providerInstanceId === active.providerInstanceId,
      )?.nativeThreadId;
    }
    if (!nativeSessionId || !antigravityConversationId.test(nativeSessionId)) return null;
    const { stateDir } = yield* ServerConfig;
    const { profile } = yield* resolveAntigravityInstanceDirectories(
      stateDir,
      active.providerInstanceId,
    );
    return {
      profileDirectory: profile,
      nativeSessionId,
      providerInstanceId: active.providerInstanceId,
    };
  },
);
