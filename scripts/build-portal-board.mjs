import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const outdir = "dist/portal-board";
await mkdir(outdir, { recursive: true });
const result = await build({
  entryPoints: {
    "portal-board":
      "packages/web-core/src/pages/kanban/portal/PortalWorkBoard.tsx",
    "operator-board":
      "packages/web-core/src/pages/kanban/portal/OperatorDeploymentBoard.tsx",
  },
  outdir,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2020"],
  jsx: "automatic",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  write: false,
  metafile: true,
});
const files = [];
for (const output of result.outputFiles) {
  await writeFile(output.path, output.contents);
  files.push({
    name: output.path.split("/").pop(),
    sha256: createHash("sha256").update(output.contents).digest("hex"),
    bytes: output.contents.length,
  });
}
await writeFile(
  `${outdir}/manifest.json`,
  JSON.stringify(
    {
      contracts: {
        "operator-board": "operator-deployments-v1",
        "portal-board": "portal-work-views-v1",
      },
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      dirtySource: !!execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
      }).trim(),
      files,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Built ${outdir} from the portal-only entry; no Rust backend or example/offline adapters bundled.`,
);
