const prefix = "Message to Antigravity worker";
const uuid = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const header = new RegExp(`^${prefix} (${uuid}) in (${uuid}):\\n`, "iu");
export const maxAntigravityWorkerMessage = 8192;

export function formatAntigravityWorkerMessage(parent: string, child: string, body: string) {
  return `${prefix} ${child} in ${parent}:\n${body.trim()}`;
}

export function parseAntigravityWorkerMessage(text: string) {
  const match = header.exec(text);
  if (!match) return null;
  return { child: match[1]!, parent: match[2]!, message: text.slice(match[0].length) };
}
