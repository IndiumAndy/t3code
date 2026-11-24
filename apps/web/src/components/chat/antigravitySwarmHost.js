/* oxlint-disable unicorn/require-post-message-target-origin -- MessagePort is already bound to a single recipient. */
// Runs inside the opaque-origin board frame. The native sidecar can see only the
// read-only in-memory records supplied by the authenticated thread request.
const swarmRecords = new Map();
const swarmRoutes = new Map();
let swarmPort;
let swarmSession = window.t3SwarmSession;
let startBoard;
const boardReady = new Promise((resolve) => {
  startBoard = resolve;
});
const bytes = new TextEncoder();
const utf8 = new TextDecoder();
window.SwarmBytes = class ByteBuffer extends Uint8Array {
  static alloc(size) {
    return new ByteBuffer(size);
  }
  static allocUnsafe(size) {
    return new ByteBuffer(size);
  }
  static concat(parts) {
    const result = new ByteBuffer(parts.reduce((n, part) => n + part.length, 0));
    let cursor = 0;
    for (const part of parts) {
      result.set(part, cursor);
      cursor += part.length;
    }
    return result;
  }
  equals(other) {
    return this.length === other.length && this.every((n, i) => n === other[i]);
  }
  toString(_encoding, from, to) {
    return utf8.decode(this.subarray(from, to));
  }
};
function directories(name) {
  const prefix = name.endsWith("/") ? name : name + "/";
  return [
    ...new Set(
      [...swarmRecords.keys()]
        .filter((p) => p.startsWith(prefix))
        .map((p) => p.slice(prefix.length).split("/")[0]),
    ),
  ];
}
function entry(path) {
  const file = swarmRecords.get(path);
  if (!file) throw Error("Swarm file unavailable");
  return file;
}
function stat(path) {
  const f = swarmRecords.get(path);
  if (!f && !directories(path).length) throw Error("Swarm file unavailable");
  return { size: f?.data.length ?? 0, mtimeMs: f?.modified ?? 0, ino: 1, isFile: () => !!f };
}
const fsView = {
  statSync: stat,
  fstatSync: stat,
  openSync(path) {
    entry(path);
    return path;
  },
  closeSync() {},
  readSync(path, target, offset, length, position) {
    const part = entry(path).data.subarray(position, position + length);
    target.set(part, offset);
    return part.length;
  },
  readFileSync(path, encoding) {
    const f = entry(path);
    return encoding ? f.text : f.data;
  },
  readdirSync: directories,
  existsSync(path) {
    return swarmRecords.has(path) || directories(path).length > 0;
  },
  realpathSync(path) {
    stat(path);
    return path;
  },
  constants: { X_OK: 1 },
  accessSync() {
    throw Error("Executable access is unavailable");
  },
};
// oxlint-disable-next-line typescript/no-extraneous-class -- the native sidecar constructs and checks this response wrapper
class BoardResponse {
  constructor(body, options = {}) {
    this.body = body;
    this.status = options.status ?? 200;
    this.type = options.contentType;
  }
}
class BoardApp {
  get config() {
    return { conversationId: swarmSession };
  }
  page(path, handler) {
    swarmRoutes.set(path, handler);
  }
  api(path, handler) {
    swarmRoutes.set(path, handler);
  }
  run() {
    return Promise.resolve();
  }
}
window.t3BoardModules = {
  "node:fs": fsView,
  "node:path": {
    join: (...parts) => parts.join("/").replace(/\/{2,}/g, "/"),
    dirname: (p) => p.slice(0, p.lastIndexOf("/")) || "/",
    basename: (p) => p.split("/").pop(),
    sep: "/",
    isAbsolute: (p) => p.startsWith("/"),
  },
  "node:url": { fileURLToPath: () => "/ui/main.mjs", pathToFileURL: (p) => new URL("file://" + p) },
  "node:os": { homedir: () => "/profile" },
  "node:child_process": {
    execFile(...args) {
      args.at(-1)(Error("External commands are unavailable"), "");
    },
    spawn() {
      throw Error("External commands are unavailable");
    },
  },
  // The sidecar hashes only a roster cache key. Keep distinct keys distinct for
  // the frame lifetime, including when two successive rosters have the same size.
  "node:crypto": {
    createHash: () => {
      let value = "";
      return {
        update(text) {
          value = text;
          return this;
        },
        digest() {
          return tokenFor(value);
        },
      };
    },
  },
  sidecar_sdk: { SidecarApp: BoardApp, Response: BoardResponse },
};
const rosterTokens = new Map();
let rosterSequence = 0;
function tokenFor(value) {
  if (!rosterTokens.has(value)) {
    if (rosterTokens.size > 128) rosterTokens.clear();
    rosterTokens.set(value, (++rosterSequence).toString(16));
  }
  return rosterTokens.get(value);
}
window.t3BoardProcess = {
  env: {
    ANTIGRAVITY_EXECUTABLE_DATA_DIR: "/profile/sidecar_data/swarm/data",
    SWARM_OVERVIEW: "true",
    SWARM_GRAPH_TAB: "true",
    SWARM_RAW_TAB: "true",
  },
};
function setRecords(packet) {
  swarmRecords.clear();
  swarmSession = packet.sessionId;
  for (const f of packet.files) swarmRecords.set(f.name, { ...f, data: bytes.encode(f.text) });
}
window.sidecar = {
  get conversationId() {
    return swarmSession;
  },
  async fetch(path) {
    await boardReady;
    const url = new URL(path, "https://board.invalid");
    if (url.pathname === "/narrator_bootstrap.js")
      return new Response(window.boardNarratorBootstrap);
    const handler = swarmRoutes.get(url.pathname);
    if (!handler) return new Response("", { status: 404 });
    const result = await handler({
      ...Object.fromEntries(url.searchParams),
      conversationId: swarmSession,
    });
    return result instanceof BoardResponse
      ? new Response(result.body, {
          status: result.status,
          headers: { "Content-Type": result.type || "text/plain" },
        })
      : Response.json(result);
  },
  ui: {
    toggleConversation(memberId) {
      if (navigator.userActivation.isActive)
        swarmPort?.postMessage({ type: "open-member", memberId });
    },
  },
};
// Native progress-reel images use root-relative /api/frame URLs. Request those
// lazily over the frame's private channel without granting any HTTP access.
const frameImages = new Map();
function resolveImage(img) {
  if (!swarmPort || !(img instanceof HTMLImageElement)) return;
  const src = img.getAttribute("src");
  if (!src?.startsWith("/api/frame?")) return;
  const path = new URL(src, "https://board.invalid").searchParams.get("path");
  if (!path || path.length > 4096) return;
  if (frameImages.has(path)) {
    const image = frameImages.get(path);
    if (image) img.src = image;
  } else {
    if (frameImages.size >= 40) return;
    frameImages.set(path, null);
    swarmPort.postMessage({ type: "frame", path });
  }
}
new MutationObserver((records) => {
  for (const mutation of records) {
    if (mutation.type === "attributes") resolveImage(mutation.target);
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      resolveImage(node);
      node.querySelectorAll('img[src^="/api/frame?"]').forEach(resolveImage);
    }
  }
}).observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["src"],
});
window.addEventListener("message", (event) => {
  if (event.source !== parent || event.data !== "t3:swarm:connect" || swarmPort || !event.ports[0])
    return;
  swarmPort = event.ports[0];
  swarmPort.onmessage = ({ data }) => {
    if (data.type === "records") {
      setRecords(data.packet);
      startBoard();
    }
    if (data.type === "frame" && frameImages.has(data.path) && typeof data.src === "string") {
      frameImages.set(data.path, data.src);
      document.querySelectorAll('img[src^="/api/frame?"]').forEach(resolveImage);
    }
    if (data.type === "fonts") {
      for (const font of data.faces) {
        const flex = font.family === "Google Sans Flex";
        const face = new FontFace(font.family, font.bytes, {
          style: font.style,
          weight: flex ? "100 1000" : "300 800",
          stretch: flex ? "92% 100%" : "100%",
          unicodeRange: font.range,
          display: "swap",
        });
        document.fonts.add(face);
      }
    }
    if (data.type === "theme") {
      for (const [name, value] of Object.entries(data.colors))
        document.documentElement.style.setProperty(name, value);
      document.documentElement.dataset.theme = data.dark ? "dark" : "light";
    }
  };
  swarmPort.postMessage({ type: "ready", key: window.t3BoardKey });
});
