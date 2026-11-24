import {
  AuthFilesystemReadScope,
  type AntigravityArtifactList,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { T } from "gt-react";
import { FilesIcon } from "lucide-react";
import { useState } from "react";
import { useRightPanelStore } from "../../rightPanelStore";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { ThreadDetailsControl } from "./ThreadDetailsControl";

export function AntigravityArtifacts({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const canRead = useEnvironmentScope(threadRef.environmentId, AuthFilesystemReadScope);
  const [open, setOpen] = useState(false);
  const query = useEnvironmentQuery<AntigravityArtifactList, unknown>(
    canRead && open
      ? orchestrationEnvironment.antigravityArtifacts({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  );
  if (!canRead) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <ThreadDetailsControl onClick={() => setOpen(true)}>
        <FilesIcon />
        <T>Artifacts</T>
      </ThreadDetailsControl>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            <T>Artifacts</T>
          </DialogTitle>
          <DialogDescription>
            <T>Files shared by Antigravity in this session.</T>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {query.error ? (
            <p role="alert">{query.error}</p>
          ) : !query.data ? (
            <p>
              <T>Loading…</T>
            </p>
          ) : query.data.artifacts.length === 0 ? (
            <p>
              <T>No artifacts yet.</T>
            </p>
          ) : (
            <ul className="divide-y">
              {query.data.artifacts.map((artifact) => (
                <li key={artifact.name} className="py-2">
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => {
                      useRightPanelStore.getState().openFile(threadRef, artifact.path);
                      setOpen(false);
                    }}
                  >
                    {artifact.name}
                  </Button>
                  {artifact.summary && (
                    <p className="text-sm text-muted-foreground">{artifact.summary}</p>
                  )}
                  {artifact.review !== "none" && (
                    <p className="text-xs text-muted-foreground">
                      {artifact.review === "reviewed" ? (
                        <T>Reviewed</T>
                      ) : artifact.review === "superseded" ? (
                        <T>Superseded</T>
                      ) : (
                        <T>Feedback requested</T>
                      )}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {query.data?.truncated && (
            <p>
              <T>Showing a limited list of artifacts.</T>
            </p>
          )}
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" size="sm" onClick={query.refresh} disabled={query.isPending}>
            <T>Refresh</T>
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
