// @effect-diagnostics nodeBuiltinImport:off -- the native goal and its terminal marker live in the session's read-only SQLite log.
import * as NodeSqlite from "node:sqlite";
import { parseGoalCommand, type OrchestrationV2GoalCommand } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { protoFields } from "./AntigravityChildWork.ts";
import { antigravityManagedPath, antigravityProfileRoot } from "./AntigravityProfilePaths.ts";

const knownSession = Schema.is(Schema.String.check(Schema.isUUID(4)));
const pauseRequest =
  "Stop and cancel the current goal. T3 Code will retain the objective so I can restart it later.";
const clearRequest =
  "Cancel the current goal and stop pursuing it. I am clearing the retained objective.";
const decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_STEP_BYTES = 2 * 1024 * 1024;
const MAX_SCAN_BYTES = 16 * 1024 * 1024;

type Goal = {
  readonly objective: string;
  readonly status: "active" | "complete" | "cancelled" | "retained";
};

function field(payload: Uint8Array, number: number) {
  return protoFields(payload).find(([key]) => key === number)?.[1];
}

/** A native goal starts with an expanded goal skill, and ends on a planner response marker. */
export function readAntigravityGoalSteps(
  database: NodeSqlite.DatabaseSync,
): Goal | null | undefined {
  let read = 0;
  let end: "complete" | "cancelled" | undefined;
  let cancelRequest: "retain" | "clear" | "ordinary" | undefined;
  let terminalRow = 0;
  let newestClear = Number.POSITIVE_INFINITY;
  const rows = database.prepare(
    "SELECT step_type, step_format, length(step_payload) AS size, CASE WHEN length(step_payload) <= ? THEN step_payload END AS payload FROM steps WHERE step_type IN (14,15) AND status=3 ORDER BY idx DESC LIMIT 2049",
  );
  let count = 0;
  for (const row of rows.iterate(MAX_STEP_BYTES)) {
    if (
      ++count > 2048 ||
      typeof row.size !== "number" ||
      row.step_format !== 0 ||
      !(row.payload instanceof Uint8Array)
    )
      return undefined;
    read += row.size;
    if (read > MAX_SCAN_BYTES) return undefined;
    if (row.step_type === 15) {
      const response = field(row.payload, 20);
      const text = response && field(response, 1);
      if (!text) continue;
      const tail = decoder.decode(text).trimEnd();
      if (tail.endsWith("<!-- GOAL_COMPLETE -->")) end = "complete";
      else if (tail.endsWith("<!-- GOAL_CANCELLED -->")) end = "cancelled";
      else continue;
      // Scanning newest first: the earliest terminal after this goal started is authoritative.
      terminalRow = count;
      cancelRequest = undefined;
      continue;
    }
    const user = field(row.payload, 19);
    const text = user && field(user, 2);
    if (!user || !text) continue;
    const prompt = decoder.decode(text);
    // AGY concatenates the T3 instruction and runtime blocks in field 2. Field 3
    // retains the individual ACP inputs, including T3's wrapped user request.
    const control = (request: string) =>
      prompt.trim() === request ||
      protoFields(user).some(([key, value]) => {
        if (key !== 3) return false;
        const bytes = field(value, 1);
        if (!bytes) return false;
        const block = decoder.decode(bytes).trim();
        return (
          block === request ||
          (block.startsWith("<t3_code_instructions>\n") &&
            block.endsWith(
              `</t3_code_instructions>\n\n<user_request>\n${request}\n</user_request>`,
            ))
        );
      });
    const cleared = control(clearRequest);
    if (cleared) newestClear = Math.min(newestClear, count);
    if (end === "cancelled" && cancelRequest === undefined) {
      cancelRequest = control(pauseRequest) ? "retain" : cleared ? "clear" : "ordinary";
    }
    const command = parseGoalCommand({ text: prompt });
    if (command?.type !== "set") continue;
    // A quoted /goal or plain user text is not a native goal. Match the skill expansion.
    const nativeGoal = protoFields(user).some(([n, item]) => {
      if (n !== 3) return false;
      const tagged = field(item, 2);
      const skill = tagged && field(tagged, 27);
      const spec = skill && field(skill, 1);
      const name = spec && field(spec, 1);
      return name !== undefined && decoder.decode(name) === "goal";
    });
    if (!nativeGoal) continue;
    return {
      objective: command.objective,
      status:
        end === "cancelled" && cancelRequest === "retain" && newestClear > terminalRow
          ? "retained"
          : (end ?? "active"),
    };
  }
  return null;
}

export async function readAntigravityGoal(profileDirectory: string, sessionId: string) {
  if (!knownSession(sessionId)) return undefined;
  const root = await antigravityProfileRoot(profileDirectory);
  if (!root) return undefined;
  const file = await antigravityManagedPath(
    root,
    ["antigravity-acp", "conversations", sessionId + ".db"],
    "file",
  );
  if (!file) return undefined;
  let db: NodeSqlite.DatabaseSync | undefined;
  try {
    db = new NodeSqlite.DatabaseSync(file.path, { readOnly: true });
    db.exec("PRAGMA busy_timeout = 100");
    return readAntigravityGoalSteps(db);
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

export function antigravityGoalControl(
  command: Exclude<OrchestrationV2GoalCommand, { type: "set" }>,
  goal: Goal | null | undefined,
): { reply: string } | { prompt: string } {
  if (goal === undefined) return { reply: "The native Antigravity goal state is unavailable." };
  if (!goal) return { reply: "No Antigravity goal is recorded in this conversation." };
  if (command.type === "show") {
    const state =
      goal.status === "retained" ? "stopped; objective retained for restart" : goal.status;
    return { reply: `Antigravity goal (${state}): ${goal.objective}` };
  }
  if (command.type === "resume") {
    return goal.status === "retained"
      ? { prompt: `/goal ${goal.objective}` }
      : { reply: "There is no stopped objective to restart." };
  }
  if (goal.status === "active" || (command.type === "clear" && goal.status === "retained")) {
    return { prompt: command.type === "pause" ? pauseRequest : clearRequest };
  }
  return {
    reply: `The native goal is already ${goal.status === "retained" ? "stopped" : goal.status}.`,
  };
}
