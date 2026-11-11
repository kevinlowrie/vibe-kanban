/** Local artifact QA. Set PORTAL_PLAYWRIGHT_MODULE to an installed Playwright module if not on this workspace's path. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const moduleName = process.env.PORTAL_PLAYWRIGHT_MODULE;
const { chromium } = await import(
  moduleName?.startsWith("/")
    ? pathToFileURL(moduleName).href
    : (moduleName ?? "playwright")
);
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/portal-board.css"><link rel="stylesheet" href="/operator-board.css"></head><body><div id="work"></div><div id="operator"></div><script type="module">
import {mountPortalWorkBoard} from '/portal-board.js';
import {mountOperatorDeploymentBoard} from '/operator-board.js';
let session = {userId:'test-user',tenantId:'tenant-a',idToken:'synthetic-test-token'};
const listeners = new Set();
window.changeTestSession = (value) => {session=value; for(const fn of listeners)fn();};
window.disposeWork = mountPortalWorkBoard(document.getElementById('work'), {getSession:async()=>session,onSessionChange:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}});
window.operatorBoard = mountOperatorDeploymentBoard(document.getElementById('operator'));
</script></body></html>`;
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(html);
      return;
    }
    if (
      ![
        "/portal-board.js",
        "/portal-board.css",
        "/operator-board.js",
        "/operator-board.css",
      ].includes(path)
    ) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader(
      "content-type",
      path.endsWith(".js") ? "text/javascript" : "text/css",
    );
    response.end(await readFile(`dist/portal-board${path}`));
  } catch {
    response.writeHead(500).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PORTAL_BROWSER_EXECUTABLE
    ? { executablePath: process.env.PORTAL_BROWSER_EXECUTABLE }
    : {}),
});
let assertions = 0;
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let delayA = false,
    refuse = false;
  const releases = [];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const tenant = url.searchParams.get("tenant_id");
    const resource = url.pathname.split("/").pop();
    assert.equal(route.request().method(), "GET");
    assert.equal(
      route.request().headers().authorization,
      "Bearer synthetic-test-token",
    );
    if (delayA && tenant === "tenant-a")
      await new Promise((resolve) => releases.push(resolve));
    if (refuse) {
      await route
        .fulfill({
          status: 403,
          json: { error: { message: "secret-error-must-not-render" } },
        })
        .catch(() => {});
      return;
    }
    const suffix = tenant === "tenant-a" ? "A" : "B";
    const data = {
      projects: {
        projects: [{ id: "p", name: `Project ${suffix}`, status: "active" }],
      },
      issues: {
        issues: [
          {
            id: "i",
            title: `Task ${suffix} <img src=x onerror=alert(1)>`,
            status: "in_progress",
            projectId: "p",
            updatedAt: null,
          },
        ],
      },
      blocked: { blocked: [] },
      approvals: { approvals: [] },
    };
    await route.fulfill({ json: data[resource] }).catch(() => {});
  });
  await page.goto(origin);
  await page
    .getByRole("heading", { name: "Task A <img src=x onerror=alert(1)>" })
    .waitFor();
  assert.equal(await page.locator("#work img").count(), 0);
  assertions++;
  delayA = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.evaluate(() =>
    window.changeTestSession({
      userId: "test-user-b",
      tenantId: "tenant-b",
      idToken: "synthetic-test-token",
    }),
  );
  assert.equal(
    await page
      .getByRole("heading", { name: "Task A <img src=x onerror=alert(1)>" })
      .count(),
    0,
  );
  assertions++;
  for (const release of releases) release();
  delayA = false;
  await page
    .getByRole("heading", { name: "Task B <img src=x onerror=alert(1)>" })
    .waitFor();
  assertions++;
  await page.evaluate(() => window.changeTestSession(null));
  assert.equal(await page.locator("#work .vpb-card").count(), 0);
  assertions++;
  await page.getByText("Sign in to view your work.", { exact: true }).waitFor();
  refuse = true;
  await page.evaluate(() =>
    window.changeTestSession({
      userId: "test-user-b",
      tenantId: "tenant-b",
      idToken: "synthetic-test-token",
    }),
  );
  await page
    .getByText("You do not have access to this workspace.", { exact: true })
    .waitFor();
  assert.equal(
    (await page.locator("body").innerText()).includes("secret-error"),
    false,
  );
  assertions++;
  const fixed = Date.parse("2026-11-11T07:00:00Z");
  await page.clock.install({ time: fixed });
  const snapshot = {
    observed_at: "2026-11-11T06:59:00Z",
    provenance: "Kubernetes Deployment replica readiness",
    stale: false,
    items: [
      {
        deployment_id: "kevinlowrie",
        display_name: "Kevin Lowrie",
        status: "healthy",
      },
      {
        deployment_id: "class101",
        display_name: "Class101 <img src=x onerror=bad()>",
        status: "unknown",
      },
    ],
  };
  assert.equal(
    await page.evaluate(
      (value) => window.operatorBoard.render(value),
      snapshot,
    ),
    true,
  );
  assertions++;
  assert.equal(
    await page
      .getByRole("region", { name: "Replicas ready", exact: true })
      .locator(".vpb-card")
      .count(),
    1,
  );
  assertions++;
  assert.equal(await page.locator("#operator img").count(), 0);
  assertions++;
  await mkdir("dist/portal-board/qa", { recursive: true });
  await page
    .locator("#operator")
    .screenshot({ path: "dist/portal-board/qa/operator-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assertions++;
  await page
    .locator("#operator")
    .screenshot({ path: "dist/portal-board/qa/operator-mobile.png" });
  await page.clock.fastForward(240001);
  await page
    .getByText("Snapshot is stale. Current deployment readiness is unknown.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page
      .getByRole("region", { name: "Replicas ready", exact: true })
      .locator(".vpb-card")
      .count(),
    0,
  );
  assertions++;
  assert.equal(
    await page
      .getByRole("region", { name: "Unknown", exact: true })
      .locator(".vpb-card")
      .count(),
    2,
  );
  assertions++;
  for (const eventName of ["visibilitychange", "focus"]) {
    await page.evaluate(
      (value) =>
        window.operatorBoard.render({
          ...value,
          observed_at: new Date(Date.now()).toISOString(),
        }),
      snapshot,
    );
    assert.equal(
      await page
        .getByRole("region", { name: "Replicas ready", exact: true })
        .locator(".vpb-card")
        .count(),
      1,
    );
    const currentTime = await page.evaluate(() => Date.now());
    await page.clock.setSystemTime(currentTime + 300001); // Wall clock only; deliberately do NOT run the expiry timer.
    await page.evaluate(
      (name) =>
        (name === "focus" ? window : document).dispatchEvent(new Event(name)),
      eventName,
    );
    await page
      .getByText(
        "Snapshot is stale. Current deployment readiness is unknown.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await page
        .getByRole("region", { name: "Unknown", exact: true })
        .locator(".vpb-card")
        .count(),
      2,
    );
    assertions++;
  }
  assert.equal(
    await page.evaluate(
      (value) =>
        window.operatorBoard.render({
          ...value,
          observed_at: new Date(Date.now() + 1).toISOString(),
        }),
      snapshot,
    ),
    false,
  );
  assertions++;
  assert.equal(await page.locator("#operator .vpb-card").count(), 0);
  assertions++;
  await page.evaluate(
    (value) =>
      window.operatorBoard.render({
        ...value,
        observed_at: new Date(Date.now()).toISOString(),
      }),
    snapshot,
  );
  await page.evaluate(() => window.operatorBoard.clear());
  assert.equal(await page.locator("#operator .vpb-card").count(), 0);
  assertions++;
  assert.equal(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
    0,
  );
  assertions++;
  await page.evaluate(() => {
    window.disposeWork();
    window.operatorBoard.dispose();
  });
  assert.equal(await page.locator("#work").innerHTML(), "");
  assert.equal(await page.locator("#operator").innerHTML(), "");
  assertions++;
  // Data-only mount: the host retains authentication and supplies scoped DTOs.
  let dataNetworkRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/")) dataNetworkRequests++;
  });
  await page.evaluate(async () => {
    const { mountPortalWorkBoardWithData } = await import("/portal-board.js");
    let scope = "tenant-a";
    let invalidate;
    let delayed = false;
    const pending = [];
    window.setDataScope = (value) => {
      scope = value;
      invalidate();
    };
    window.delayData = () => {
      delayed = true;
    };
    window.releaseData = () => {
      delayed = false;
      pending.forEach((fn) => fn());
    };
    window.disposeData = mountPortalWorkBoardWithData(
      document.getElementById("work"),
      {
        onSessionChange: (fn) => {
          invalidate = fn;
          return () => {
            invalidate = () => {};
          };
        },
        loadViews: async (signal) => {
          const selected = scope;
          if (delayed) await new Promise((resolve) => pending.push(resolve));
          if (selected === null) throw new Error("host private error");
          return {
            userId: "synthetic-user",
            tenantId: selected,
            projects: [],
            issues: [
              {
                id: "task",
                title: `Data task ${selected}`,
                status: "todo",
                projectId: null,
                updatedAt: null,
              },
            ],
            blocked: [],
            approvals: [],
          };
        },
      },
    );
  });
  await page
    .getByRole("heading", { name: "Data task tenant-a", exact: true })
    .waitFor();
  assertions++;
  await page.evaluate(() => window.delayData());
  await page
    .locator("#work")
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  await page.evaluate(() => window.setDataScope("tenant-b"));
  assert.equal(await page.locator("#work .vpb-card").count(), 0);
  assertions++;
  await page.evaluate(() => window.releaseData());
  await page
    .getByRole("heading", { name: "Data task tenant-b", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("heading", { name: "Data task tenant-a", exact: true })
      .count(),
    0,
  );
  assertions++;
  await page.evaluate(() => window.setDataScope(null));
  assert.equal(await page.locator("#work .vpb-card").count(), 0);
  await page
    .getByText("Work views are unavailable. Try refreshing.", { exact: true })
    .waitFor();
  assert.equal(
    (await page.locator("#work").innerText()).includes("host private error"),
    false,
  );
  assertions++;
  await page.evaluate(() => window.setDataScope("../invalid-tenant"));
  await page
    .getByText("Work views are unavailable. Try refreshing.", { exact: true })
    .waitFor();
  assert.equal(await page.locator("#work .vpb-card").count(), 0);
  assert.equal(dataNetworkRequests, 0);
  assertions++;
  await page.evaluate(() => window.disposeData());
  assert.equal(await page.locator("#work").innerHTML(), "");
  assertions++;
  assert.equal(errors.length, 0, errors.join("\n"));
  assertions++;
  console.log(
    JSON.stringify(
      {
        passed: true,
        assertions,
        viewports: ["1440x1000", "390x844"],
        coverage: [
          "hostile text",
          "repeat refresh",
          "account/tenant switch",
          "logout",
          "auth refusal",
          "freshness expiry",
          "visibility resume",
          "invalid future snapshot",
          "clear",
          "teardown",
          "no storage",
        ],
        boundary:
          "Local built artifact with synthetic authenticated contract fixtures; not a live auth/backend test.",
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
