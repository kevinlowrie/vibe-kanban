import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
await build({
  stdin: {
    contents: `import {StrictMode} from 'react';import {createRoot} from 'react-dom/client';import {PlanningBoard} from './src/pages/kanban/planning/PlanningBoard';export function mountFixture(el,host){const root=createRoot(el);const update=h=>root.render(<StrictMode><PlanningBoard host={h}/></StrictMode>);update(host);return {update,dispose:()=>root.unmount()};}`,
    resolveDir: process.cwd() + "/packages/web-core",
    loader: "tsx",
  },
  bundle: true,
  format: "esm",
  outfile: "dist/planning-board/qa-host.js",
  jsx: "automatic",
});
const { chromium } = await import(
  pathToFileURL(process.env.PORTAL_PLAYWRIGHT_MODULE).href
);
const fixture = {
  schedule: {
    revision: 1,
    items: [
      {
        id: "api",
        projectId: "p1",
        title: "API spine",
        startDate: "2026-11-16",
        endDate: "2026-11-17",
        dependsOn: [],
      },
      {
        id: "ui",
        projectId: "p1",
        title: "Portal delivery",
        startDate: "2026-11-18",
        endDate: "2026-11-20",
        dependsOn: ["api"],
      },
      {
        id: "trace",
        projectId: "p2",
        title: "Trace proof",
        startDate: "2026-11-16",
        endDate: "2026-11-17",
        dependsOn: [],
      },
    ],
  },
  tasks: [
    {
      id: "api",
      status: "in_progress",
      sprintId: "s1",
      workflow: "Implement → QA",
      repository: "middle",
      prStage: "Review pending",
    },
    {
      id: "ui",
      status: "blocked",
      sprintId: "s1",
      blocker: "API acceptance pending",
      workflow: "Build → release",
      repository: "client",
      prStage: "Draft",
    },
    { id: "trace", status: "backlog", sprintId: "s2" },
  ],
  projects: [
    { id: "p1", name: "Portal" },
    { id: "p2", name: "Telemetry" },
  ],
  sprints: [
    { id: "s1", name: "Sprint 1" },
    { id: "s2", name: "Sprint 2" },
  ],
  observedAt: new Date().toISOString(),
  coverage: "Fixture only · 2 projects, 3 tasks · no real work data",
};
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/PlanningBoard.css"><div id="root"></div><script type="module">
import {mountFixture} from '/qa-host.js';
let data=${JSON.stringify(fixture)};let callback;window.applies=0;window.fail=false;window.chatCalls=0;
const host={load:async signal=>{signal.throwIfAborted();return structuredClone(data);},onScopeChange:fn=>{callback=fn;return()=>{};},apply:async p=>{window.applies++;if(window.fail)throw Error('secret upstream error');if(p.baseRevision!==data.schedule.revision)throw Error('stale');for(const c of p.changes){Object.assign(data.schedule.items.find(i=>i.id===c.id),c.after);}data.schedule.revision++;data.observedAt=new Date().toISOString();return structuredClone(data);}};
window.changeScope=()=>{data={...data,schedule:{revision:7,items:[]},tasks:[],projects:[],sprints:[],observedAt:new Date().toISOString(),coverage:'Other tenant fixture'};callback();};
window.setStale=()=>{data.observedAt='2000-01-01T00:00:00Z';};
window.enableChat=()=>{host.proposeChat=async()=>{window.chatCalls++;return {baseRevision:data.schedule.revision,changes:[{id:'api',before:{startDate:'2026-11-18',endDate:'2026-11-19'},after:{startDate:'2026-11-17',endDate:'2026-11-18'}}]};};view.update({...host});};
const view=mountFixture(document.querySelector('#root'),host);window.replaceHost=()=>view.update({...host});window.syncFailure=()=>view.update({...host,load:()=>{throw Error('private sync error');}});window.delayHost=()=>view.update({...host,load:()=>new Promise(resolve=>{window.resolveOld=()=>{const old=structuredClone(data);old.schedule.items[0].title='OLD TENANT RESULT';resolve(old);};})});window.dispose=view.dispose;
</script>`;
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/") {
      res.setHeader("content-type", "text/html");
      res.end(html);
    } else if (
      [
        "/PlanningBoard.js",
        "/PlanningBoard.css",
        "/qa-host.js",
        "/qa-host.css",
      ].includes(req.url)
    ) {
      res.setHeader(
        "content-type",
        req.url.endsWith(".js") ? "text/javascript" : "text/css",
      );
      res.end(await readFile("dist/planning-board" + req.url));
    } else res.writeHead(404).end();
  } catch {
    res.writeHead(500).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
let checks = 0;
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.getByText("3 of 3 tasks visible").waitFor();
  checks++;
  await page.evaluate(() => window.replaceHost());
  await page.getByText("3 of 3 tasks visible").waitFor();
  checks++;
  await page.evaluate(() => window.syncFailure());
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByText("private sync error").count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Refresh", exact: true })
      .isDisabled(),
    false,
  );
  await page.evaluate(() => window.replaceHost());
  await page.getByText("3 of 3 tasks visible").waitFor();
  checks++;
  assert.equal(
    await page
      .getByRole("button", { name: "Preview suggestion", exact: true })
      .isDisabled(),
    true,
  );
  checks++;
  await page.evaluate(() => window.delayHost());
  await page.waitForFunction(() => typeof window.resolveOld === "function");
  await page.evaluate(() => window.replaceHost());
  await page.getByText("3 of 3 tasks visible").waitFor();
  await page.evaluate(() => window.resolveOld());
  await page.waitForTimeout(50);
  assert.equal(
    await page.getByText("OLD TENANT RESULT", { exact: true }).count(),
    0,
  );
  checks++;
  await page.getByLabel("Blocked only").check();
  await page.getByText("1 of 3 tasks visible").waitFor();
  await page.getByLabel("Blocked only").uncheck();
  await page
    .getByLabel("Workflow", { exact: true })
    .selectOption("Implement → QA");
  await page.getByText("1 of 3 tasks visible").waitFor();
  await page.getByLabel("Workflow", { exact: true }).selectOption("");
  checks++;
  await page.getByLabel("Project", { exact: true }).selectOption("p2");
  await page.getByText("1 of 3 tasks visible").waitFor();
  await page.getByLabel("Project", { exact: true }).selectOption("");
  checks++;
  await page
    .getByRole("button", { name: "API spine", exact: true })
    .first()
    .click();
  await page.getByLabel("Start date").fill("2026-11-18");
  await page.getByLabel("End date").fill("2026-11-19");
  await page.getByRole("button", { name: "Preview date change" }).click();
  await page.getByRole("region", { name: "Schedule change preview" }).waitFor();
  assert.equal(
    await page
      .getByRole("region", { name: "Schedule change preview" })
      .locator("li")
      .count(),
    2,
  );
  assert.equal(await page.evaluate(() => window.applies), 0);
  checks++;
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(
    await page.getByRole("region", { name: "Schedule change preview" }).count(),
    0,
  );
  checks++;
  await page.getByRole("button", { name: "Preview date change" }).click();
  await page
    .getByRole("button", { name: "Apply schedule", exact: true })
    .click();
  await page.getByText("Host confirmed the updated schedule.").waitFor();
  assert.equal(await page.evaluate(() => window.applies), 1);
  checks++;
  await page
    .getByRole("button", { name: "API spine", exact: true })
    .first()
    .click();
  await page.getByLabel("Start date").fill("2026-11-20");
  await page.getByLabel("End date").fill("2026-11-21");
  await page.getByRole("button", { name: "Preview date change" }).click();
  await page.evaluate(() => (window.fail = true));
  await page
    .getByRole("button", { name: "Apply schedule", exact: true })
    .click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByText("secret upstream error").count(), 0);
  checks++;
  await page.evaluate(() => (window.fail = false));
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Close editor" }).click();
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await dt.evaluate((d) => d.setData("text/plain", "api"));
  await page
    .getByRole("button", {
      name: "Move dropped task to 2026-11-20",
      exact: true,
    })
    .dispatchEvent("drop", { dataTransfer: dt });
  await page.getByRole("region", { name: "Schedule change preview" }).waitFor();
  checks++;
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/planning-mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  checks++;
  await page.evaluate(() => window.enableChat());
  await page.getByText("3 of 3 tasks visible").waitFor();
  await page.getByLabel("Planning request").fill("Move the API earlier");
  await page
    .getByRole("button", { name: "Preview suggestion", exact: true })
    .click();
  await page.getByRole("region", { name: "Schedule change preview" }).waitFor();
  assert.equal(await page.evaluate(() => window.chatCalls), 1);
  assert.equal(await page.evaluate(() => window.applies), 2);
  checks++;
  await page.evaluate(() => window.setStale());
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByText(/^STALE/).waitFor();
  assert.equal(
    await page
      .getByRole("button", {
        name: "Move dropped task to 2026-11-20",
        exact: true,
      })
      .isDisabled(),
    true,
  );
  checks++;
  await page.evaluate(() => window.changeScope());
  await page.getByText("0 of 0 tasks visible").waitFor();
  assert.equal(
    await page.getByRole("button", { name: "API spine", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("region", { name: "Schedule change preview" }).count(),
    0,
  );
  checks++;
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      checks,
      errors,
      scope:
        "fixture browser UI only; no live auth, LLM, persistence or workers",
    }),
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
