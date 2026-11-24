// @effect-diagnostics nodeBuiltinImport:off -- a memory SQLite database models the native session record.
import * as NodeSqlite from "node:sqlite";
import { describe, expect, it } from "@effect/vitest";
import { field, proto } from "./AntigravityChildWork.testkit.ts";
import { antigravityGoalControl, readAntigravityGoalSteps } from "./AntigravityGoal.ts";

function goalDb() {
  const db = new NodeSqlite.DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE steps(idx INTEGER PRIMARY KEY, step_type INTEGER, status INTEGER DEFAULT 3, step_format INTEGER, step_payload BLOB)",
  );
  const add = db.prepare("INSERT INTO steps(step_type,step_format,step_payload) VALUES(?,0,?)");
  const user = (text: string, goal = false) =>
    add.run(
      14,
      proto(
        field(
          19,
          proto(
            field(2, text),
            ...(goal
              ? [
                  field(
                    3,
                    proto(field(2, proto(field(27, proto(field(1, proto(field(1, "goal")))))))),
                  ),
                ]
              : []),
          ),
        ),
      ),
    );
  const answer = (text: string) => add.run(15, proto(field(20, proto(field(1, text)))));
  return { db, user, answer };
}

describe("Antigravity native goal records", () => {
  it("requires the native expansion, a cancellation acknowledgement and the retained objective", () => {
    const { db, user, answer } = goalDb();
    try {
      user("/goal literal message");
      expect(readAntigravityGoalSteps(db)).toBeNull();
      user("/goal Verify the change", true);
      const active = readAntigravityGoalSteps(db);
      expect(active).toEqual({ objective: "Verify the change", status: "active" });
      const pause = antigravityGoalControl({ type: "pause" }, active);
      if (!("prompt" in pause)) throw Error("Missing cancellation prompt");
      // T3 wraps the request and appends a separate runtime-info block on a fresh ACP turn.
      const wrapped = `<t3_code_instructions>\nHost context\n</t3_code_instructions>\n\n<user_request>\n${pause.prompt}\n</user_request>`;
      db.prepare("INSERT INTO steps(step_type,step_format,step_payload) VALUES(14,0,?)").run(
        proto(
          field(
            19,
            proto(
              field(2, wrapped + "<runtime_info>…</runtime_info>"),
              field(3, proto(field(1, wrapped))),
            ),
          ),
        ),
      );
      expect(readAntigravityGoalSteps(db)?.status).toBe("active");
      answer("Stopped.\n<!-- GOAL_CANCELLED -->");
      const stopped = readAntigravityGoalSteps(db);
      expect(stopped?.status).toBe("retained");
      expect(antigravityGoalControl({ type: "resume" }, stopped)).toEqual({
        prompt: "/goal Verify the change",
      });
      const clear = antigravityGoalControl({ type: "clear" }, stopped);
      if (!("prompt" in clear)) throw Error("Missing clear request");
      user(clear.prompt);
      expect(readAntigravityGoalSteps(db)?.status).toBe("cancelled");
      user("/goal Another target", true);
      answer("All done.\n<!-- GOAL_COMPLETE -->");
      const done = readAntigravityGoalSteps(db);
      expect(done).toEqual({ objective: "Another target", status: "complete" });
      user("Describe what a cancellation marker looks like.");
      answer("The marker is <!-- GOAL_CANCELLED -->");
      expect(readAntigravityGoalSteps(db)).toEqual(done);
      expect(antigravityGoalControl({ type: "resume" }, done)).toHaveProperty("reply");
    } finally {
      db.close();
    }
  });
  it("withholds state when a newer native step uses an unknown encoding", () => {
    const { db, user } = goalDb();
    try {
      user("/goal Earlier target", true);
      db.exec("INSERT INTO steps(step_type,step_format,step_payload) VALUES(15,1,x'00')");
      expect(readAntigravityGoalSteps(db)).toBeUndefined();
      expect(antigravityGoalControl({ type: "pause" }, undefined)).toHaveProperty("reply");
    } finally {
      db.close();
    }
  });
});
