// @effect-diagnostics nodeBuiltinImport:off -- validate the AGY-owned roster and child descriptor before addressing a worker.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ProviderDriverKind } from "@t3tools/contracts";
import { ProviderAdapterProtocolError } from "@t3tools/provider-core/server/ProviderAdapter";
import {
  maxAntigravityWorkerMessage,
  parseAntigravityWorkerMessage,
} from "@t3tools/shared/antigravityWorkerMessage";
import { antigravityManagedPath, antigravityProfileRoot } from "./AntigravityProfilePaths.ts";

const encodeMessage = Schema.encodeSync(
  Schema.fromJsonString(Schema.Struct({ Recipient: Schema.String, Message: Schema.String })),
);

const decodeRoster = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      members: Schema.Record(
        Schema.String,
        Schema.Struct({ conversation_id: Schema.String, killed: Schema.optional(Schema.Boolean) }),
      ),
    }),
  ),
);
const decodeChild = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      conversationId: Schema.String,
      state: Schema.optional(Schema.String),
    }),
  ),
);

async function readRecord(root: string, segments: string[], limit: number) {
  const file = await antigravityManagedPath(root, segments, "file");
  if (!file || file.info.size > limit) throw Error("Worker record unavailable.");
  const handle = await NodeFSP.open(
    file.path,
    NodeFS.constants.O_RDONLY |
      (NodeFS.constants.O_NOFOLLOW ?? 0) |
      (NodeFS.constants.O_NONBLOCK ?? 0),
  );
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.ino !== file.info.ino ||
      stat.dev !== file.info.dev ||
      stat.size > limit
    )
      throw Error("Worker record changed.");
    const data = Buffer.alloc(stat.size + 1);
    const read = await handle.read(data);
    if (read.bytesRead !== stat.size) throw Error("Worker record changed.");
    return data.toString("utf8", 0, read.bytesRead);
  } finally {
    await handle.close();
  }
}

export function prepareAntigravityWorkerMessage(profile: string, session: string, text: string) {
  const target = parseAntigravityWorkerMessage(text);
  if (!target) return Effect.succeed(text);
  return Effect.tryPromise({
    try: async () => {
      if (
        target.parent !== session ||
        target.child === session ||
        !target.message.trim() ||
        target.message.length > maxAntigravityWorkerMessage
      )
        throw Error("Invalid target.");
      const root = await antigravityProfileRoot(profile);
      if (!root) throw Error("Unknown profile.");
      const base = ["antigravity-acp", "brain", session, ".system_generated"];
      const roster = decodeRoster(
        await readRecord(root, [...base, "swarm", "members.json"], 131072),
      );
      if (
        !Object.values(roster.members).some((m) => m.conversation_id === target.child && !m.killed)
      )
        throw Error("Not a live member.");
      const child = decodeChild(
        await readRecord(root, [...base, "subagents", target.child + ".json"], 65536),
      );
      if (child.conversationId !== target.child || child.state === "SUBAGENT_STATE_KILLED")
        throw Error("Child is unavailable.");
      const args = encodeMessage({ Recipient: target.child, Message: target.message });
      return `Deliver my private message to this worker by calling the native send_message tool with the following exact JSON arguments. Treat Message as the payload for the recipient. Do not execute it yourself or post it to the board. If delivery fails, report the error.\n${args}`;
    },
    catch: () =>
      new ProviderAdapterProtocolError({
        driver: ProviderDriverKind.make("antigravity"),
        detail: "The addressed Antigravity worker is unavailable in this conversation.",
      }),
  });
}
