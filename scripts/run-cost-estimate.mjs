import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");

const outfile = join(tmpdir(), "monitor-pangan-cost-estimate.mjs");
await esbuild.build({
  entryPoints: [new URL("./cost-estimate.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile,
  plugins: [resolveTypeScript()],
});
await import(pathToFileURL(outfile).href);

/** The app imports `.js` paths that live on disk as `.ts`. */
function resolveTypeScript() {
  return {
    name: "resolve-typescript",
    setup(build) {
      build.onResolve({ filter: /^\..*\.js$/ }, (args) => {
        const candidate = join(args.resolveDir, args.path.replace(/\.js$/, ".ts"));
        if (!existsSync(candidate)) {
          return null;
        }
        return { path: candidate };
      });
    },
  };
}
