import type { AntigravitySwarmResult } from "@t3tools/contracts";
import hostScript from "./antigravitySwarmHost.js?raw";

const protectScript = (source: string) => source.replace(/<\/script/gi, "<\\/script");
const script = (source: string) => "<script>" + protectScript(source) + "</script>";

/** Only provider-owned modules run here, in an iframe with an opaque origin.
 * The installed backend gets a file snapshot and a read-only sidecar SDK. */
function boardModule(name: string, source: string) {
  const exports: string[] = [];
  const body = source
    .replace(
      /^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm,
      (_, symbols: string, id: string) => {
        const bindings = symbols.trim().replace(/\s+as\s+/g, ":");
        return "const {" + bindings + "}=window.t3BoardModules[" + JSON.stringify(id) + "];";
      },
    )
    .replace(/^export (const|function) (\w+)/gm, (_, kind: string, id: string) => {
      exports.push(id);
      return kind + " " + id;
    })
    .replaceAll("import.meta.url", JSON.stringify("/ui/" + name));
  return script(
    "window.t3BoardModules[" +
      JSON.stringify("./" + name) +
      "]=(()=>{const Buffer=window.SwarmBytes,process=window.t3BoardProcess;const setInterval=(...args)=>({unref:()=>window.setInterval(...args)});\n" +
      body +
      "\nreturn {" +
      exports.join(",") +
      "};})();",
  );
}
export function swarmDocument(
  assets: AntigravitySwarmResult["files"],
  sessionId: string,
  frameKey: string,
) {
  const files = new Map(assets.map((f) => [f.name, f.text]));
  const get = (name: string) => {
    const value = files.get(name);
    if (value === undefined) throw Error("Missing Swarm Board resource: " + name);
    return value;
  };
  const modules = ["channels.mjs", "board_cache.mjs", "main.mjs"]
    .map((name) => boardModule(name, get(name)))
    .join("");
  const preload =
    script(
      "window.t3SwarmSession=" +
        JSON.stringify(sessionId) +
        ";window.t3BoardKey=" +
        JSON.stringify(frameKey) +
        ";",
    ) +
    script(hostScript) +
    script("window.boardNarratorBootstrap=" + JSON.stringify(get("narrator_bootstrap.js")) + ";") +
    modules;
  const csp =
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'\"><meta name=\"referrer\" content=\"no-referrer\">";
  return get("index.html")
    .replace("<head>", "<head>" + csp)
    .replace(/<script src="\/preload\.js"><\/script>/, () => preload)
    .replace(/<script src="\/(app|gif|hive)\.js"><\/script>/g, (_, n: string) =>
      script(get(n + ".js")),
    )
    .replace(
      /<link rel="stylesheet" href="\/(styles|hive)\.css">/g,
      (_, n: string) => "<style>" + get(n + ".css").replace(/<\/style/gi, "<\\/style") + "</style>",
    );
}
