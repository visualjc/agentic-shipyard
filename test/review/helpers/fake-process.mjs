#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args[0] === "--version") { process.stdout.write("codex-fixture-1"); process.exit(0); }
const value = (name) => args[args.indexOf(name) + 1];
const outputPath = process.env.SHIPYARD_REVIEW_SESSION_DIR ? join(process.env.SHIPYARD_REVIEW_SESSION_DIR, "result.json") : value("-o");
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
const bundlePath = /sealed Shipyard bundle at (.+?\.json)\./.exec(prompt)?.[1];
const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
const envelopePath = bundle.envelope.adapter.envelopePath;
const request = bundle.request;
await writeFile(join(process.cwd(), ".fixture-observed.json"), JSON.stringify({
  pid: process.pid, session: process.env.SHIPYARD_REVIEW_SESSION,
  sessionDir: process.env.SHIPYARD_REVIEW_SESSION_DIR,
  implementer: process.env.IMPLEMENTER_SESSION,
  parent: process.env.CODEX_SESSION,
  args, envelopePath, bundle,
}));
if (process.env.FIXTURE_MODE === "timeout") await new Promise(() => {});
if (process.env.FIXTURE_MODE === "fail") process.exit(7);
await writeFile(outputPath,JSON.stringify({ reviewId: request.reviewId, productSha: request.productSha,
  reviewer: "fixture", startedAt: "2026-08-04T00:00:00.000Z", finishedAt: "2026-08-04T00:00:00.000Z",
  findings: [], successful: true }));
