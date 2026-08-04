#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
const outputPath = process.env.SHIPYARD_REVIEW_SESSION_DIR ? join(process.env.SHIPYARD_REVIEW_SESSION_DIR, "result.json") : value("-o");
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
const envelopePath = /Reviewer envelope only: (.+?\.json)\. Review request/.exec(prompt)?.[1];
const request = { reviewId: "r-1", productSha: /SHA: ([a-f0-9]+)/.exec(prompt)?.[1] };
await writeFile(join(process.cwd(), ".fixture-observed.json"), JSON.stringify({
  pid: process.pid, session: process.env.SHIPYARD_REVIEW_SESSION,
  sessionDir: process.env.SHIPYARD_REVIEW_SESSION_DIR,
  implementer: process.env.IMPLEMENTER_SESSION,
  parent: process.env.CODEX_SESSION,
  args, envelopePath,
}));
if (process.env.FIXTURE_MODE === "timeout") await new Promise(() => {});
if (process.env.FIXTURE_MODE === "fail") process.exit(7);
await writeFile(outputPath,JSON.stringify({ reviewId: request.reviewId, productSha: request.productSha,
  reviewer: "fixture", startedAt: "2026-08-04T00:00:00.000Z", finishedAt: "2026-08-04T00:00:00.000Z",
  findings: [], successful: true }));
