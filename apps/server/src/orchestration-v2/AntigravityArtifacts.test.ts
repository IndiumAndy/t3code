// @effect-diagnostics nodeBuiltinImport:off -- fixture exercises actual directory and symbolic link behavior.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { listAntigravityArtifacts } from "./AntigravityArtifacts.ts";

it("lists same-session deliverables and never transfers review to another revision", async () => {
  const profile = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "agy-artifacts-"));
  const id = "9c88484a-5636-4d65-a6f7-59466363d776";
  const brain = NodePath.join(profile, "antigravity-acp", "brain");
  const folder = NodePath.join(brain, id);
  const revision = "2026-10-01T12:15:30Z";
  const list = () => listAntigravityArtifacts(profile, id, new Map([[revision, "reviewed"]]));
  try {
    await NodeFSP.mkdir(folder, { recursive: true });
    await NodeFSP.writeFile(NodePath.join(folder, "implementation_plan.md"), "# Plan");
    await NodeFSP.writeFile(NodePath.join(folder, "chart.png"), "image fixture");
    await NodeFSP.writeFile(NodePath.join(folder, "private.png"), "hidden by native metadata");
    await NodeFSP.writeFile(
      NodePath.join(folder, "private.png.metadata.json"),
      '{"userFacing":false}',
    );
    await NodeFSP.writeFile(NodePath.join(folder, "notes.md"), "not marked user facing");
    await NodeFSP.writeFile(NodePath.join(folder, "验收 记录.md"), "# Review");
    await NodeFSP.writeFile(
      NodePath.join(folder, "验收 记录.md.metadata.json"),
      '{"userFacing":true}',
    );
    await NodeFSP.symlink(NodePath.join(folder, "notes.md"), NodePath.join(folder, "linked.png"));
    const meta = NodePath.join(folder, "implementation_plan.md.metadata.json");
    await NodeFSP.writeFile(
      meta,
      JSON.stringify({ updatedAt: revision, requestFeedback: true, userFacing: true }),
    );
    expect((await list()).artifacts.map((a) => [a.name, a.review]).sort()).toEqual([
      ["chart.png", "none"],
      ["implementation_plan.md", "reviewed"],
      ["验收 记录.md", "none"],
    ]);
    await NodeFSP.writeFile(
      meta,
      JSON.stringify({ updatedAt: revision + "2", requestFeedback: true, userFacing: true }),
    );
    expect((await list()).artifacts.find((a) => a.name === "implementation_plan.md")?.review).toBe(
      "requested",
    );
    expect((await listAntigravityArtifacts(profile, "../" + id, new Map())).artifacts).toEqual([]);
  } finally {
    await NodeFSP.rm(profile, { recursive: true, force: true });
  }
});
