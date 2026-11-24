import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, expect } from "@effect/vitest";
import { symlinksSupported } from "@t3tools/shared/testing/symlinks";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { readAntigravityReviewPlan } from "./AntigravityReviewPlan.ts";

it.effect("reads only the current turn's explicit, visible review request", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-" });
    const sessionId = "35296a4f-2385-4b2f-89b4-bf830a81ed29";
    const folder = path.join(root, "antigravity-acp", "brain", sessionId);
    const markdown = path.join(folder, "implementation_plan.md");
    const meta = markdown + ".metadata.json";
    const updatedAt = "2026-11-24T20:48:53.176208Z";
    const time = Date.parse(updatedAt);
    const read = (start = time - 100, id = sessionId) =>
      Effect.promise(() => readAntigravityReviewPlan(root, id, start, time + 100));
    yield* fs.makeDirectory(folder, { recursive: true });
    yield* fs.writeFileString(markdown, "# Plan");
    expect(yield* read()).toBeUndefined();
    yield* fs.writeFileString(meta, JSON.stringify({ updatedAt, userFacing: true }));
    expect(yield* read()).toBeUndefined();
    yield* fs.writeFileString(
      meta,
      JSON.stringify({ updatedAt, userFacing: true, requestFeedback: true }),
    );
    expect(yield* read()).toEqual({ planMarkdown: "# Plan", reviewRevision: updatedAt });
    expect(yield* read(time + 1)).toBeUndefined();
    expect(yield* read(time - 1, "../" + sessionId)).toBeUndefined();
    if (symlinksSupported) {
      yield* fs.remove(markdown);
      yield* fs.symlink(meta, markdown);
      expect(yield* read()).toBeUndefined();
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
