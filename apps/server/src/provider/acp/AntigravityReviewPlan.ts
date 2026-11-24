import { antigravityProfileRoot, readAntigravityArtifact } from "./AntigravityProfilePaths.ts";

/** The CLI requests review in the metadata beside the artifact, outside the ACP event stream. */
export async function readAntigravityReviewPlan(
  profileDirectory: string,
  sessionId: string,
  turnStartedMs: number,
  turnEndedMs: number,
) {
  try {
    const root = await antigravityProfileRoot(profileDirectory);
    if (!root) return undefined;
    const metadataText = await readAntigravityArtifact(
      root,
      sessionId,
      "implementation_plan.md.metadata.json",
      16_384,
    );
    if (!metadataText) return undefined;
    const meta: unknown = JSON.parse(metadataText);
    if (
      !meta ||
      typeof meta !== "object" ||
      !("userFacing" in meta && meta.userFacing === true) ||
      !("requestFeedback" in meta && meta.requestFeedback === true) ||
      !("updatedAt" in meta && typeof meta.updatedAt === "string") ||
      !(Date.parse(meta.updatedAt) >= turnStartedMs && Date.parse(meta.updatedAt) <= turnEndedMs)
    )
      return undefined;
    const markdown = await readAntigravityArtifact(
      root,
      sessionId,
      "implementation_plan.md",
      64_000,
    );
    if (!markdown?.trim()) return undefined;
    return { planMarkdown: markdown, reviewRevision: meta.updatedAt };
  } catch {
    // A missing, replaced or malformed artifact must not fail the agent's turn.
    return undefined;
  }
}
