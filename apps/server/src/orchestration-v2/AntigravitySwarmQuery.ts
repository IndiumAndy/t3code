// @effect-diagnostics nodeBuiltinImport:off -- read-only, inode-checked access to installed provider resources.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  AntigravitySwarmError,
  type AntigravitySwarmInput,
  type AntigravitySwarmResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import {
  antigravityManagedPath,
  antigravityProfileRoot,
} from "../provider/acp/AntigravityProfilePaths.ts";
import {
  antigravityConversationId,
  resolveAntigravityThreadSession,
} from "./AntigravityThreadSession.ts";

const ASSETS = [
  "index.html",
  "styles.css",
  "hive.css",
  "gif.js",
  "hive.js",
  "app.js",
  "narrator_bootstrap.js",
  "main.mjs",
  "board_cache.mjs",
  "channels.mjs",
] as const;
const PLUGIN = ["builtin", "plugins", "swarm", "sidecars", "swarm_board"];
const EMPTY: AntigravitySwarmResult = { sessionId: null, files: [], revision: "" };
type Entry = NonNullable<Awaited<ReturnType<typeof antigravityManagedPath>>> & {
  name: string;
  limit: number;
  tail?: boolean;
};
async function bytesOf(entry: Entry) {
  if (entry.info.size > entry.limit && !entry.tail)
    throw new Error("Swarm Board file exceeds its display limit.");
  const handle = await NodeFSP.open(
    entry.path,
    NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW | NodeFS.constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.dev !== entry.info.dev ||
      stat.ino !== entry.info.ino ||
      stat.size !== entry.info.size ||
      stat.mtimeMs !== entry.info.mtimeMs
    )
      throw new Error("Swarm Board changed while reading. Retry.");
    const size = Math.min(stat.size, entry.limit);
    const bytes = Buffer.alloc(size);
    const start = stat.size - size;
    let read = 0;
    while (read < size) {
      const { bytesRead } = await handle.read(bytes, read, size - read, start + read);
      if (bytesRead === 0) throw new Error("Swarm Board changed while reading. Retry.");
      read += bytesRead;
    }
    if (!start) return bytes;
    const newline = bytes.indexOf(10);
    return newline < 0 ? bytes.subarray(0, 0) : bytes.subarray(newline + 1);
  } finally {
    await handle.close();
  }
}

async function textOf(entry: Entry) {
  return (await bytesOf(entry)).toString("utf8");
}

export async function readSwarmRecords(
  profile: string,
  session: string,
  revision?: string,
): Promise<AntigravitySwarmResult> {
  const root = await antigravityProfileRoot(profile);
  if (!root || !antigravityConversationId.test(session)) return EMPTY;
  const entries: Entry[] = [];
  const add = async (cid: string, pieces: string[], limit: number, tail = false) => {
    const segments = ["antigravity-acp", "brain", cid, ...pieces];
    const file = await antigravityManagedPath(root, segments, "file");
    if (!file) return undefined;
    const entry = { ...file, name: "/profile/" + segments.slice(1).join("/"), limit, tail };
    entries.push(entry);
    return entry;
  };
  const swarm = [".system_generated", "swarm"];
  const roster = await add(session, [...swarm, "members.json"], 128 * 1024);
  if (!roster) return { ...EMPTY, sessionId: session };
  const members: unknown = JSON.parse(await textOf(roster)).members;
  if (!members || typeof members !== "object") throw new Error("Invalid swarm member roster.");
  for (const name of ["board.jsonl", "plan.json", "view.json", "view.html"]) {
    await add(session, [...swarm, name], name === "board.jsonl" ? 2 * 1024 * 1024 : 64 * 1024);
  }
  const ids = new Set<string>([session]);
  for (const member of Object.values(members)) {
    const id: unknown = member?.conversation_id;
    if (typeof id !== "string" || !antigravityConversationId.test(id) || ids.has(id)) continue;
    // A mutable roster alone cannot authorize reads of another conversation.
    const proof = await antigravityManagedPath(
      root,
      ["antigravity-acp", "brain", session, ".system_generated", "subagents", id + ".json"],
      "file",
    );
    if (!proof || proof.info.size > 65536) continue;
    const record: unknown = JSON.parse(
      await textOf({ ...proof, name: "descriptor", limit: 65536 }),
    );
    if (
      typeof record === "object" &&
      record !== null &&
      "conversationId" in record &&
      record.conversationId === id
    )
      ids.add(id);
  }
  if (ids.size > 128) throw new Error("Too many swarm members to display.");
  for (const id of ids) {
    await add(
      id,
      [".system_generated", "logs", "transcript.jsonl"],
      Math.min(65536, Math.floor((1024 * 1024) / ids.size)),
      true,
    );
  }
  return packet(entries, session, revision);
}
async function packet(
  entries: Entry[],
  session: string,
  previous?: string,
): Promise<AntigravitySwarmResult> {
  const revision = NodeCrypto.createHash("sha256")
    .update(JSON.stringify(entries.map((e) => [e.name, e.info.ino, e.info.size, e.info.mtimeMs])))
    .digest("hex");
  return {
    sessionId: session,
    revision,
    files:
      revision === previous
        ? []
        : await Promise.all(
            entries.map(async (e) => ({
              name: e.name,
              text: await textOf(e),
              modified: e.info.mtimeMs,
            })),
          ),
  };
}
export async function readSwarmFrame(
  profile: string,
  session: string,
  target: string,
): Promise<AntigravitySwarmResult> {
  const none = { ...EMPTY, sessionId: session };
  if (
    !antigravityConversationId.test(session) ||
    !NodePath.isAbsolute(target) ||
    NodePath.normalize(target) !== target
  )
    return none;
  const root = await antigravityProfileRoot(profile);
  if (!root) return none;
  const relative = NodePath.relative(NodePath.join(root, "antigravity-acp", "brain"), target);
  const segments = relative.split(NodePath.sep);
  const owner = segments[0];
  if (!owner || !antigravityConversationId.test(owner) || segments.length < 2) return none;
  const scope = ["antigravity-acp", "brain", session, ".system_generated"];
  if (owner !== session) {
    const descriptor = await antigravityManagedPath(
      root,
      [...scope, "subagents", owner + ".json"],
      "file",
    );
    if (
      !descriptor ||
      JSON.parse(await textOf({ ...descriptor, name: "member", limit: 65536 })).conversationId !==
        owner
    )
      return none;
  }
  const source = await antigravityManagedPath(
    root,
    ["antigravity-acp", "brain", ...segments],
    "file",
  );
  const type: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };
  const mime = type[NodePath.extname(target).toLowerCase()];
  if (!source || !mime || source.info.size > 8 * 1024 * 1024) return none;
  const view = await antigravityManagedPath(root, [...scope, "swarm", "view.json"], "file");
  const frames: unknown = view
    ? JSON.parse(await textOf({ ...view, name: "overview", limit: 65536 }))?.reel?.frames
    : undefined;
  let listed = Array.isArray(frames) && frames.some((f) => f?.path === target);
  if (!listed) {
    const board = await antigravityManagedPath(root, [...scope, "swarm", "board.jsonl"], "file");
    if (!board) return none;
    const lines = (await textOf({ ...board, name: "board", limit: 2 * 1024 * 1024 })).split("\n");
    listed = lines.some((line) => {
      try {
        const post = JSON.parse(line);
        return (
          typeof post?.text === "string" &&
          [
            ...post.text.matchAll(
              /^\s*(?:[-*]\s*)?Screenshot:\s*`?([^\s`|]+)`?(?:\s*\|[^\n]*)?\s*$/gim,
            ),
          ].some((match) => match[1] === target)
        );
      } catch {
        return false;
      }
    });
  }
  if (!listed) return none;
  const data = await bytesOf({ ...source, name: "frame", limit: 8 * 1024 * 1024 });
  return {
    sessionId: session,
    revision: String(source.info.mtimeMs),
    files: [
      {
        name: "frame",
        modified: source.info.mtimeMs,
        text: "data:" + mime + ";base64," + data.toString("base64"),
      },
    ],
  };
}
async function readAssets(
  profile: string,
  session: string,
  previous?: string,
): Promise<AntigravitySwarmResult> {
  for (const base of [
    NodePath.join(NodeOS.homedir(), ".gemini", "antigravity"),
    NodePath.join(profile, "antigravity-acp"),
  ]) {
    const root = await antigravityProfileRoot(base);
    if (!root) continue;
    const entries: Entry[] = [];
    for (const name of ASSETS) {
      const info = await antigravityManagedPath(root, [...PLUGIN, name], "file");
      if (!info) break;
      entries.push({ ...info, name, limit: 512 * 1024 });
    }
    if (entries.length === ASSETS.length) return packet(entries, session, previous);
  }
  throw new Error("The installed Antigravity runtime does not contain the Swarm Board panel.");
}

export const makeAntigravitySwarmReader = Effect.gen(function* () {
  const context =
    yield* Effect.context<Effect.Services<ReturnType<typeof resolveAntigravityThreadSession>>>();
  return Effect.fn("AntigravitySwarmQuery.read")(function* (
    input: typeof AntigravitySwarmInput.Type,
  ) {
    const native = yield* resolveAntigravityThreadSession(input.threadId).pipe(
      Effect.provideContext(context),
      Effect.mapError(
        () =>
          new AntigravitySwarmError({ message: "Could not resolve the Antigravity conversation." }),
      ),
    );
    if (!native) return EMPTY;
    const read = input.query === "assets" ? readAssets : readSwarmRecords;
    return yield* Effect.tryPromise({
      try: () =>
        input.query === "frame"
          ? readSwarmFrame(native.profileDirectory, native.nativeSessionId, input.framePath ?? "")
          : read(native.profileDirectory, native.nativeSessionId, input.revision),
      catch: (cause) =>
        new AntigravitySwarmError({
          message:
            cause instanceof Error &&
            /^(Swarm Board|Too many swarm|The installed Antigravity|Invalid swarm)/.test(
              cause.message,
            )
              ? cause.message
              : "Could not read the Swarm Board.",
        }),
    });
  });
});
