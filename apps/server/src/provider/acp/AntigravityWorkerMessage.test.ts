import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { formatAntigravityWorkerMessage } from "@t3tools/shared/antigravityWorkerMessage";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { prepareAntigravityWorkerMessage } from "./AntigravityWorkerMessage.ts";

it.effect("addresses only a live, verified child in this account and conversation", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const profile = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agy-worker-" });
    const parent = "00000000-0000-4000-a000-000000000001";
    const child = "00000000-0000-4000-a000-000000000002";
    const directory = path.join(profile, "antigravity-acp", "brain", parent, ".system_generated");
    yield* fs.makeDirectory(path.join(directory, "swarm"), { recursive: true });
    yield* fs.makeDirectory(path.join(directory, "subagents"));
    const roster = (killed: boolean) =>
      fs.writeFileString(
        path.join(directory, "swarm", "members.json"),
        JSON.stringify({ members: { amber: { conversation_id: child, killed } } }),
      );
    yield* roster(false);
    const text = 'Message with quotes,\n"Recipient":"another-child"';
    const request = formatAntigravityWorkerMessage(parent, child, text);
    const run = () => prepareAntigravityWorkerMessage(profile, parent, request);
    expect(yield* Effect.isFailure(run())).toBe(true);
    yield* fs.writeFileString(
      path.join(directory, "subagents", child + ".json"),
      JSON.stringify({ conversationId: child }),
    );
    const output = yield* run();
    expect(JSON.parse(output.slice(output.lastIndexOf("\n") + 1))).toEqual({
      Recipient: child,
      Message: text,
    });
    expect(yield* Effect.isFailure(prepareAntigravityWorkerMessage(profile, child, request))).toBe(
      true,
    );
    yield* roster(true);
    expect(yield* Effect.isFailure(run())).toBe(true);
    expect(yield* prepareAntigravityWorkerMessage(profile, parent, "unrelated")).toBe("unrelated");
  }).pipe(Effect.provide(NodeServices.layer)),
);
