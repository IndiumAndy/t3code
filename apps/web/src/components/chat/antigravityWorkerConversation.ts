import type { AntigravitySwarmResult } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const decodeRoster = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      members: Schema.Record(
        Schema.String,
        Schema.Struct({
          conversation_id: Schema.String,
          killed: Schema.optional(Schema.Boolean),
          role: Schema.optional(Schema.String),
        }),
      ),
    }),
  ),
);
const decodeStep = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      step_index: Schema.Number,
      type: Schema.String,
      content: Schema.optional(Schema.String),
      created_at: Schema.optional(Schema.String),
    }),
  ),
);

export function workerConversation(packet: AntigravitySwarmResult, memberId: string) {
  const prefix = "/profile/brain/";
  const records = "/.system_generated/";
  if (!packet.sessionId) return null;
  const roster = packet.files.find(
    (f) => f.name === prefix + packet.sessionId + records + "swarm/members.json",
  );
  const transcript = packet.files.find(
    (f) => f.name === prefix + memberId + records + "logs/transcript.jsonl",
  );
  if (!roster || !transcript) return null;
  try {
    const member = Object.entries(decodeRoster(roster.text).members).find(
      ([, v]) => v.conversation_id === memberId,
    );
    if (!member) return null;
    const messages = transcript.text
      .split("\n")
      .flatMap((line) => {
        try {
          const step = decodeStep(line);
          const text = step.content?.trim();
          if (!text) return [];
          if (step.type === "USER_INPUT" || step.type === "PLANNER_RESPONSE")
            return [
              { index: step.step_index, who: step.type === "USER_INPUT" ? "user" : "worker", text },
            ];
          if (step.type !== "SYSTEM_MESSAGE") return [];
          const match = text.match(
            /\[Message\] timestamp=\S+ sender=([a-f\d-]+) priority=\S+ content=([\s\S]*?)\n<\/SYSTEM_MESSAGE>$/iu,
          );
          if (match?.[1] === packet.sessionId)
            return [{ index: step.step_index, who: "coordinator", text: match[2] ?? "" }];
          return [];
        } catch {
          return [];
        }
      })
      .slice(-40);
    return { name: member[0], killed: member[1].killed === true, messages };
  } catch {
    return null;
  }
}
