import { build } from "esbuild";
await build({
  entryPoints: [
    "packages/web-core/src/pages/kanban/planning/PlanningBoard.tsx",
  ],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outdir: "dist/planning-board",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true,
});
