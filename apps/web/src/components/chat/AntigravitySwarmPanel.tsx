import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { AntigravitySwarmResult, ScopedThreadRef } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { useEffect, useRef, useState } from "react";
import { randomUUID } from "~/lib/utils";
import { useStableCallback } from "~/hooks/useStableCallback";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useAtomCommand } from "../../state/use-atom-command";
import { isElectron } from "~/env";
import { loadSwarmFonts } from "./antigravitySwarmFonts";
import { swarmDocument } from "./antigravitySwarmDocument";

const themeKeys = [
  "background",
  "foreground",
  "card",
  "secondary",
  "muted",
  "secondary-foreground",
  "muted-foreground",
  "primary",
  "primary-foreground",
  "border",
];
function currentTheme() {
  const style = getComputedStyle(document.documentElement);
  const colors = Object.fromEntries(
    themeKeys.map((k) => ["--" + k, style.getPropertyValue("--" + k).trim()]).filter(([, v]) => v),
  );
  return { type: "theme", dark: document.documentElement.classList.contains("dark"), colors };
}
function documentForSession(assets: AntigravitySwarmResult, expectedId: string, key: string) {
  if (assets.sessionId !== expectedId) throw Error("Antigravity session changed.");
  return swarmDocument(assets.files, expectedId, key);
}

export default function AntigravitySwarmPanel({
  threadRef,
}: {
  readonly threadRef: ScopedThreadRef;
}) {
  const gt = useGT();
  const [doc, setDoc] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const port = useRef<MessagePort | null>(null);
  const snapshot = useRef<AntigravitySwarmResult | null>(null);
  const boardSession = useRef("");
  const frameKey = useRef("");
  const read = useAtomCommand(orchestrationEnvironment.antigravitySwarm, { reportFailure: false });
  const load = useStableCallback(
    async (query: "assets" | "records", revision: string, signal: AbortSignal) => {
      const result = await read(
        {
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, query, revision },
        },
        { signal },
      );
      if (result._tag !== "Success") throw squashAtomCommandFailure(result);
      return result.value;
    },
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a mounted native panel follows on-disk records on the environment that owns the thread
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let loadedSession: string | null = null;
    let revision: string | undefined;
    async function poll() {
      try {
        const records = await load("records", revision ?? "", abort.signal);
        if (abort.signal.aborted) return;
        if (records.sessionId !== loadedSession) {
          loadedSession = null;
          snapshot.current = null;
          boardSession.current = "";
          port.current?.close();
          port.current = null;
          setDoc("");
          if (records.sessionId) {
            const assets = await load("assets", "", abort.signal);
            if (abort.signal.aborted) return;
            boardSession.current = records.sessionId;
            frameKey.current = randomUUID();
            setDoc(documentForSession(assets, records.sessionId, frameKey.current));
          }
          loadedSession = records.sessionId;
        }
        if (revision !== records.revision || snapshot.current === null) {
          snapshot.current = records;
          port.current?.postMessage({ type: "records", packet: records });
          revision = records.revision;
        }
        setFailure(null);
      } catch (e) {
        if (!abort.signal.aborted) {
          port.current?.close();
          port.current = null;
          snapshot.current = null;
          boardSession.current = "";
          loadedSession = null;
          revision = undefined;
          setDoc("");
          setFailure(e instanceof Error ? e.message : String(e));
        }
      }
      if (!abort.signal.aborted)
        timer = setTimeout(
          () => {
            void poll();
          },
          document.hidden ? 15000 : 2000,
        );
    }
    void poll();
    const theme = new MutationObserver(() => port.current?.postMessage(currentTheme()));
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    return () => {
      abort.abort();
      clearTimeout(timer);
      theme.disconnect();
      port.current?.close();
      port.current = null;
    };
  }, [load]);

  const connect = () => {
    const target = frame.current?.contentWindow;
    if (!target || !boardSession.current) return;
    port.current?.close();
    const connection = new MessageChannel();
    port.current = null;
    let trusted = false;
    connection.port1.onmessage = async ({ data }) => {
      if (data?.type === "ready" && data.key === frameKey.current) {
        trusted = true;
        port.current = connection.port1;
        connection.port1.postMessage(currentTheme());
        if (isElectron)
          void loadSwarmFonts().then((faces) => {
            if (port.current === connection.port1)
              connection.port1.postMessage({ type: "fonts", faces });
          });
        if (snapshot.current)
          connection.port1.postMessage({ type: "records", packet: snapshot.current });
      } else if (
        trusted &&
        data?.type === "frame" &&
        typeof data.path === "string" &&
        data.path.length <= 4096
      ) {
        const requestKey = frameKey.current;
        const result = await read({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, query: "frame", framePath: data.path },
        });
        if (requestKey === frameKey.current && port.current === connection.port1)
          connection.port1.postMessage({
            type: "frame",
            path: data.path,
            src:
              result._tag === "Success" && result.value.sessionId === boardSession.current
                ? result.value.files[0]?.text
                : null,
          });
      } else if (
        trusted &&
        data?.type === "open-member" &&
        typeof data.memberId === "string" &&
        frame.current
      ) {
        frame.current.dispatchEvent(
          new CustomEvent("t3:antigravity-worker-open", {
            bubbles: true,
            detail: { threadId: threadRef.threadId, memberId: data.memberId },
          }),
        );
      }
    };
    target.postMessage("t3:swarm:connect", "*", [connection.port2]);
  };
  return (
    <div className="flex size-full min-h-0 flex-col">
      {failure ? (
        <p role="alert" className="p-3 text-sm text-destructive-foreground">
          {failure}
        </p>
      ) : null}
      {doc ? (
        <iframe
          ref={frame}
          title={gt("Swarm Board")}
          className="min-h-0 w-full flex-1 border-0"
          sandbox="allow-scripts allow-downloads"
          referrerPolicy="no-referrer"
          srcDoc={doc}
          onLoad={connect}
        />
      ) : !failure ? (
        <p className="p-3 text-sm text-muted-foreground">
          <T>Waiting for the Antigravity conversation…</T>
        </p>
      ) : null}
    </div>
  );
}
