import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Hotspot loading state and metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Hotspot — Every Arrow Costs\. Find It Fast\.<\/title>/i);
  assert.match(html, /STRINGING THE RANGE…/);
  assert.match(html, /Hotspot archery game poster/);
  assert.match(html, /http:\/\/localhost(?::3000)?\/og\.png/);
});

test("builds a self-contained GitHub Pages site at the project path", async () => {
  const [html, source, config, assets] = await Promise.all([
    readFile(new URL("../dist-pages/index.html", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../vite.pages.config.ts", import.meta.url), "utf8"),
    readdir(new URL("../dist-pages/assets/", import.meta.url)),
  ]);

  assert.match(html, /src="\/hotspot\/assets\/[^"]+\.js"/);
  assert.match(html, /href="\/hotspot\/assets\/[^"]+\.css"/);
  assert.match(html, /https:\/\/delcaos\.github\.io\/hotspot\/og\.png/);
  assert.ok(assets.some((name) => name.endsWith(".js")));
  assert.ok(assets.some((name) => name.endsWith(".css")));

  assert.match(config, /base:\s*"\/hotspot\/"/);
  assert.match(source, /const TARGET_RTP = 0\.99/);
  assert.match(source, /const DUST_PAYOUTS = \[0, 0\.01, 0\.02\]/);
  assert.match(source, /const BURST_PAYOUTS = \[0\.55, 0\.65, 0\.75, 0\.85, 0\.95\]/);
  assert.match(source, /J\(a\) = 0\.99N/);
  assert.match(source, /hotspot-archery-state-v7/);
  assert.doesNotMatch(source, /round\.shots\.slice/);
  assert.match(source, /if \(usedPointIds\.has\(selected\.id\)\)/);
});
