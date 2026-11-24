// @effect-diagnostics nodeBuiltinImport:off -- native sidecar metadata requires a bounded, no-follow read.
import * as NodeFSP from "node:fs/promises";
import {
  OrchestrationV2GetThreadProjectionError,
  type AntigravityArtifact,
  type AntigravityArtifactList,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import {
  antigravityManagedPath,
  antigravityProfileRoot,
  readAntigravityArtifact,
} from "../provider/acp/AntigravityProfilePaths.ts";
import {
  antigravityConversationId,
  resolveAntigravityThreadSession,
} from "./AntigravityThreadSession.ts";
import { ThreadManagementService } from "./ThreadManagementService.ts";

const METADATA_SUFFIX = ".metadata.json";
const SCREENSHOT = /\.(?:png|jpe?g|webp|gif|avif)$/i;
const MAX_RESULTS = 256;
const METADATA_BYTES = 64 * 1024;
const EMPTY: AntigravityArtifactList = { artifacts: [], truncated: false };

function parseArtifactMetadata(text: string | undefined) {
  if (!text) return undefined;
  try {
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== "object") return undefined;
    return {
      userFacing: "userFacing" in data && data.userFacing === true,
      requestFeedback: "requestFeedback" in data && data.requestFeedback === true,
      updatedAt: "updatedAt" in data && typeof data.updatedAt === "string" ? data.updatedAt : "",
      summary:
        "summary" in data && typeof data.summary === "string" ? data.summary.slice(0, 400) : "",
    };
  } catch {
    return undefined;
  }
}

export async function listAntigravityArtifacts(
  profile: string,
  sessionId: string,
  planReviews: ReadonlyMap<string, AntigravityArtifact["review"]>,
): Promise<AntigravityArtifactList> {
  if (!antigravityConversationId.test(sessionId)) return EMPTY;
  const root = await antigravityProfileRoot(profile);
  if (!root) return EMPTY;
  const parts = ["antigravity-acp", "brain", sessionId];
  const directory = await antigravityManagedPath(root, parts, "directory");
  if (!directory) return EMPTY;
  const entries = await NodeFSP.opendir(directory.path);
  const names = new Set<string>();
  let visited = 0;
  let truncated = false;
  for await (const entry of entries) {
    if (++visited > 8192) {
      truncated = true;
      break;
    }
    if (entry.name.startsWith(".")) continue;
    if (!entry.isFile()) continue;
    const name = entry.name.endsWith(METADATA_SUFFIX)
      ? entry.name.slice(0, -METADATA_SUFFIX.length)
      : SCREENSHOT.test(entry.name)
        ? entry.name
        : undefined;
    if (name && !name.startsWith(".") && !name.endsWith(METADATA_SUFFIX)) names.add(name);
  }
  const artifacts: Array<AntigravityArtifact & { modified: number }> = [];
  for (const name of names) {
    const file = await antigravityManagedPath(root, [...parts, name], "file");
    if (!file) continue;
    const hasMetadata = await NodeFSP.lstat(file.path + METADATA_SUFFIX).then(
      () => true,
      (cause: NodeJS.ErrnoException) => {
        if (cause.code === "ENOENT") return false;
        throw cause;
      },
    );
    const meta = hasMetadata
      ? parseArtifactMetadata(
          await readAntigravityArtifact(
            root,
            sessionId,
            name + METADATA_SUFFIX,
            METADATA_BYTES,
          ).catch(() => undefined),
        )
      : undefined;
    if (hasMetadata ? !meta?.userFacing : !SCREENSHOT.test(name)) continue;
    const review = meta?.requestFeedback
      ? (name === "implementation_plan.md" && planReviews.get(meta.updatedAt)) || "requested"
      : "none";
    artifacts.push({
      name,
      path: file.path,
      summary: meta?.summary ?? "",
      review,
      modified: file.info.mtimeMs,
    });
  }
  artifacts.sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
  return {
    artifacts: artifacts.slice(0, MAX_RESULTS).map(({ modified: _, ...entry }) => entry),
    truncated: truncated || artifacts.length > MAX_RESULTS,
  };
}

export const getAntigravityArtifacts = Effect.fn("AntigravityArtifacts.list")(
  function* (threadId: ThreadId) {
    const session = yield* resolveAntigravityThreadSession(threadId);
    if (!session) return EMPTY;
    const threads = yield* ThreadManagementService;
    const { plans } = yield* threads.getThreadRecords(threadId, ["plans"]);
    const reviews = new Map<string, AntigravityArtifact["review"]>();
    for (const plan of plans) {
      if (plan.kind === "proposed_plan" && plan.reviewRevision) {
        reviews.set(
          plan.reviewRevision,
          plan.status === "completed"
            ? "reviewed"
            : plan.status === "superseded"
              ? "superseded"
              : "requested",
        );
      }
    }
    return yield* Effect.tryPromise({
      try: () =>
        listAntigravityArtifacts(session.profileDirectory, session.nativeSessionId, reviews),
      catch: () =>
        new OrchestrationV2GetThreadProjectionError({
          threadId,
          message: "Could not read Antigravity artifacts.",
        }),
    });
  },
  (effect, threadId) =>
    effect.pipe(
      Effect.mapError(
        () =>
          new OrchestrationV2GetThreadProjectionError({
            threadId,
            message: "Could not load Antigravity artifacts.",
          }),
      ),
    ),
);
