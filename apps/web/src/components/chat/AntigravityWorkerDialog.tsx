import { useAtomValue } from "@effect/atom-react";
import {
  type AntigravitySwarmResult,
  AuthOrchestrationOperateScope,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import {
  formatAntigravityWorkerMessage,
  maxAntigravityWorkerMessage,
} from "@t3tools/shared/antigravityWorkerMessage";
import { workerConversation } from "./antigravityWorkerConversation";
import { T, useGT } from "gt-react";
import { useRef, useState } from "react";
import { newMessageId } from "~/lib/utils";
import { readThreadShell } from "~/state/entities";
import { useEnvironmentScope } from "~/state/session";
import { environmentThreadDetails, threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
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
import { Textarea } from "../ui/textarea";

export function AntigravityWorkerDialog({
  threadRef,
  packet,
  memberId,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  packet: AntigravitySwarmResult;
  memberId: string;
  onClose: () => void;
}) {
  const gt = useGT();
  const worker = workerConversation(packet, memberId);
  const [draft, setDraft] = useState("");
  const [outcome, setOutcome] = useState<"submitted" | "failure" | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const canSend = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const pending = useAtomValue(environmentThreadDetails.pendingRequestsAtom(threadRef));
  const send = useOrchestrationCommand(threadEnvironment.startTurn);
  const sender = async () => {
    const thread = readThreadShell(threadRef);
    if (
      !worker ||
      worker.killed ||
      !canSend ||
      !packet.sessionId ||
      !thread ||
      !draft.trim() ||
      inFlight.current ||
      memberId === packet.sessionId
    )
      return;
    inFlight.current = true;
    setBusy(true);
    const result = await send({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        modelSelection: thread.modelSelection,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: formatAntigravityWorkerMessage(packet.sessionId, memberId, draft),
          attachments: [],
        },
        dispatchMode: "auto",
      },
    })
      .catch(() => null)
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
    setOutcome(result?._tag === "Success" ? "submitted" : "failure");
    if (result?._tag === "Success") setDraft("");
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{worker?.name ?? gt("Worker conversation")}</DialogTitle>
          <DialogDescription>
            <T>Recent messages in this member’s Antigravity conversation.</T>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {!worker ? (
            <p>
              <T>This member’s conversation is unavailable.</T>
            </p>
          ) : (
            <>
              {worker.messages.length ? (
                <ol className="space-y-3">
                  {worker.messages.map((m) => (
                    <li key={m.index}>
                      <strong className="text-xs">
                        {m.who === "coordinator"
                          ? gt("Received from coordinator")
                          : m.who === "user"
                            ? gt("User")
                            : worker.name}
                      </strong>
                      <p className="whitespace-pre-wrap break-words text-sm">{m.text}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>
                  <T>No recent messages.</T>
                </p>
              )}
              {(pending?.approvals.length ?? 0) + (pending?.userInputs.length ?? 0) > 0 ? (
                <Button variant="outline" onClick={onClose}>
                  <T>View pending requests in the main conversation</T>
                </Button>
              ) : null}
              {canSend && !worker.killed && memberId !== packet.sessionId ? (
                <label className="mt-4 block space-y-1 text-sm">
                  <span>
                    <T>Message via coordinator</T>
                  </span>
                  <Textarea
                    aria-label={gt("Message via coordinator")}
                    value={draft}
                    disabled={busy}
                    maxLength={maxAntigravityWorkerMessage}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setOutcome(null);
                    }}
                  />
                </label>
              ) : null}
            </>
          )}
          {outcome === "submitted" ? (
            <p role="status">
              <T>Requested delivery. The worker’s conversation shows messages it receives.</T>
            </p>
          ) : null}
          {outcome === "failure" ? (
            <p role="alert">
              <T>The request could not be submitted.</T>
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            <T>Close</T>
          </Button>
          {canSend && worker && !worker.killed && memberId !== packet.sessionId ? (
            <Button onClick={() => void sender()} disabled={busy || !draft.trim()}>
              <T>Ask coordinator to send</T>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
