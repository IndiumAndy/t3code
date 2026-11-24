// @effect-diagnostics nodeBuiltinImport:off -- exercises file identity and symbolic links on disk.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";

import { readSwarmRecords, readSwarmFrame } from "./AntigravitySwarmQuery.ts";

it("returns only scoped board records and screens referenced in the current swarm", async () => {
  const profile = await NodeFSP.realpath(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "agy-swarm-")),
  );
  const session = "10000000-0000-4000-8000-000000000001",
    child = "20000000-0000-4000-8000-000000000002";
  const root = NodePath.join(profile, "antigravity-acp", "brain");
  const system = NodePath.join(root, session, ".system_generated");
  const board = NodePath.join(system, "swarm");
  try {
    await NodeFSP.mkdir(board, { recursive: true });
    await NodeFSP.mkdir(NodePath.join(system, "subagents"));
    await NodeFSP.mkdir(NodePath.join(root, child, ".system_generated", "logs"), {
      recursive: true,
    });
    const transcript = NodePath.join(root, child, ".system_generated", "logs", "transcript.jsonl");
    await NodeFSP.writeFile(transcript, '{"step_index":8}\n');
    const image = NodePath.join(root, session, "step.png");
    const unlisted = NodePath.join(root, session, "private.png");
    await NodeFSP.writeFile(image, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    await NodeFSP.writeFile(unlisted, "private");
    await NodeFSP.writeFile(
      NodePath.join(board, "board.jsonl"),
      JSON.stringify({ seq: 1, text: "Screenshot: " + image + " | UI test" }) + "\n",
    );
    await NodeFSP.writeFile(
      NodePath.join(board, "members.json"),
      JSON.stringify({ members: { worker: { conversation_id: child } } }),
    );
    await NodeFSP.symlink(unlisted, NodePath.join(board, "view.json"));
    const first = await readSwarmRecords(profile, session);
    expect(first.files.map((f) => f.name.split("/").at(-1)).sort()).toEqual([
      "board.jsonl",
      "members.json",
    ]);
    expect((await readSwarmRecords(profile, session, first.revision)).files).toEqual([]);
    expect((await readSwarmRecords(profile, "../secret")).files).toEqual([]);
    expect((await readSwarmFrame(profile, session, image)).files[0]?.text).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );
    expect((await readSwarmFrame(profile, session, unlisted)).files).toEqual([]);
    await NodeFSP.writeFile(
      NodePath.join(system, "subagents", child + ".json"),
      JSON.stringify({ conversationId: child }),
    );
    const second = await readSwarmRecords(profile, session, first.revision);
    expect(second.revision).not.toBe(first.revision);
    expect(second.files.some((f) => f.name.endsWith("transcript.jsonl"))).toBe(true);
  } finally {
    await NodeFSP.rm(profile, { recursive: true, force: true });
  }
});
