// @effect-diagnostics nodeBuiltinImport:off -- lstat proves no managed component is a link.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

/**
 * Proves a native runtime entry is at its literal path below the canonical profile: every
 * component exists with the expected type and none is a link. A link could point at another
 * child's transcript or another session's database under the same profile.
 */
export async function antigravityManagedPath(
  profileRoot: string,
  segments: ReadonlyArray<string>,
  kind: "file" | "directory",
): Promise<{ readonly path: string; readonly info: NodeFS.Stats } | undefined> {
  let current = profileRoot;
  let info: NodeFS.Stats | undefined;
  for (const [index, segment] of segments.entries()) {
    current = NodePath.join(current, segment);
    info = await NodeFSP.lstat(current).catch(() => undefined);
    const expectFile = kind === "file" && index === segments.length - 1;
    if (
      info === undefined ||
      info.isSymbolicLink() ||
      (expectFile ? !info.isFile() : !info.isDirectory())
    ) {
      return undefined;
    }
  }
  if (info === undefined) return undefined;
  return (await NodeFSP.realpath(current).catch(() => undefined)) === current
    ? { path: current, info }
    : undefined;
}

export const antigravityProfileRoot = (profileDirectory: string) =>
  NodeFSP.realpath(profileDirectory).catch(() => undefined);

export async function readAntigravityArtifact(
  root: string,
  sessionId: string,
  name: string,
  limit: number,
) {
  if (
    !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(sessionId) ||
    !/^[\w.-]+$/.test(name) ||
    name === "." ||
    name === ".."
  )
    return undefined;
  const file = await antigravityManagedPath(
    root,
    ["antigravity-acp", "brain", sessionId, name],
    "file",
  );
  if (!file || file.info.size > limit) return undefined;
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
      stat.dev !== file.info.dev ||
      stat.ino !== file.info.ino ||
      stat.size > limit
    )
      return undefined;
    const bytes = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await handle.read(bytes);
    if (bytesRead !== stat.size) return undefined;
    return bytes.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close();
  }
}
