import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("AstraFlow key stays on the server", () => {
  it("the chat page talks to the Worker, never to AstraFlow", () => {
    const page = ["web/index.html", "web/draft.js"].map(read).join("\n");
    expect(page).not.toMatch(/umodelverse|astraflow/i);
    expect(page).not.toMatch(/authorization|bearer|\bsk-[a-z0-9]/i);
    expect(read("web/draft.js")).toContain('fetch("/chat"');
  });

  it("no wrangler config ships the key as a plain var", () => {
    for (const config of ["wrangler.jsonc", "wrangler.preview.jsonc"]) {
      expect(read(config)).not.toMatch(/ASTRAFLOW_API_KEY/);
    }
  });
});
