import type { ScopedThreadRef } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { useRef, useState } from "react";
import { readThreadShell } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { newMessageId } from "~/lib/utils";
import type { ProposedPlan } from "../../types";
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

function planPassages(markdown: string) {
  const passages: { line: number; text: string }[] = [];
  let line = 1;
  for (const paragraph of markdown.split(/(\n\s*\n)/)) {
    if (paragraph.trim()) passages.push({ line, text: paragraph });
    line += paragraph.split("\n").length - 1;
  }
  return passages;
}

export function PlanReviewActions({
  plan,
  threadRef,
  current,
}: {
  plan: ProposedPlan;
  threadRef: ScopedThreadRef;
  current: boolean;
}) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [sending, setSending] = useState(false);
  const locked = useRef(false);
  const send = useOrchestrationCommand(threadEnvironment.startTurn);
  const passages = open ? planPassages(plan.planMarkdown) : [];
  const hasNotes = Object.values(notes).some((note) => note.trim().length > 0);

  const respond = async (requestChanges: boolean) => {
    const thread = readThreadShell(threadRef);
    if (!thread || thread.latestRun?.runId !== plan.runId || !current || locked.current) return;
    const comments = planPassages(plan.planMarkdown).flatMap(({ line, text }) => {
      const note = notes[line]?.trim();
      return note ? [`Line ${line} (${text.split("\n")[0]?.slice(0, 120)}): ${note}`] : [];
    });
    if (requestChanges && !comments.length) return;
    const text = [
      requestChanges
        ? "Revise this plan using my comments and ask for review again before implementation."
        : "Proceed with this version of the plan, incorporating my comments if present.",
      ...(comments.length ? [comments.join("\n\n")] : []),
      plan.planMarkdown,
    ].join("\n\n");
    locked.current = true;
    setSending(true);
    const result = await send({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        dispatchMode: "start",
        sourceProposedPlan: {
          threadId: threadRef.threadId,
          planId: plan.id,
          ...(requestChanges ? { requestChanges: true } : {}),
        },
      },
    }).finally(() => {
      locked.current = false;
      setSending(false);
    });
    if (result._tag === "Success") setOpen(false);
  };
  if (plan.status === "completed" || plan.status === "superseded") {
    return (
      <p className="mt-3 text-sm text-muted-foreground">
        {plan.status === "completed" ? gt("Proceeded") : gt("Changes requested")}
      </p>
    );
  }
  if (!current || plan.status !== "active") return null;
  return (
    <>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={sending}>
          <T>Review and comment</T>
        </Button>
        <Button size="sm" onClick={() => void respond(false)} disabled={sending}>
          <T>Proceed</T>
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              <T>Review implementation plan</T>
            </DialogTitle>
            <DialogDescription>
              <T>Add feedback beside the passage you want to change.</T>
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="grid gap-4">
              {passages.map(({ line, text }) => (
                <div key={line} className="grid gap-2">
                  <p className="whitespace-pre-wrap break-words text-sm">{text}</p>
                  {notes[line] === undefined ? (
                    <div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setNotes({ ...notes, [line]: "" })}
                      >
                        <T>Add comment</T>
                      </Button>
                    </div>
                  ) : (
                    <Textarea
                      aria-label={gt("Comment on line {line}", { line })}
                      value={notes[line]}
                      onChange={(event) => setNotes({ ...notes, [line]: event.target.value })}
                      rows={2}
                    />
                  )}
                </div>
              ))}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              disabled={sending || !hasNotes}
              onClick={() => void respond(true)}
            >
              <T>Request changes</T>
            </Button>
            <Button size="sm" disabled={sending} onClick={() => void respond(false)}>
              <T>Proceed</T>
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
