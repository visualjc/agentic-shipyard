#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
let race;try{race=JSON.parse(await readFile(join(process.env.CODEX_HOME,"checkout-race.json"),"utf8"));}catch{}
if (args[0] === "--version") {if(race)execFileSync("/usr/bin/git",["-C",race.source,"checkout","--detach","--force",race.awaySha],{stdio:"ignore"});process.stdout.write("codex-fixture-1"); process.exit(0); }
const value = (name) => args[args.indexOf(name) + 1];
const outputPath = process.env.SHIPYARD_REVIEW_SESSION_DIR ? join(process.env.SHIPYARD_REVIEW_SESSION_DIR, "result.json") : value("-o");
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
const bundlePath = /sealed Shipyard bundle at (.+?\.json)\./.exec(prompt)?.[1];
const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
const envelopePath = bundle.envelope.adapter.envelopePath;
const request = bundle.request;
if(race)execFileSync("/usr/bin/git",["-C",race.source,"checkout","--detach","--force",race.returnSha],{stdio:"ignore"});
let reviewTarget;try{reviewTarget=await readFile(join(process.cwd(),"review-target.txt"),"utf8");}catch{}
await writeFile(join(process.env.CODEX_HOME, ".fixture-observed.json"), JSON.stringify({
  pid: process.pid, session: process.env.SHIPYARD_REVIEW_SESSION,
  sessionDir: process.env.SHIPYARD_REVIEW_SESSION_DIR,
  implementer: process.env.IMPLEMENTER_SESSION,
  parent: process.env.CODEX_SESSION,
  args, envelopePath, bundle, reviewTarget,reviewRoot:process.cwd(),
}));
if (process.env.FIXTURE_MODE === "timeout") await new Promise(() => {});
if (process.env.FIXTURE_MODE === "fail") process.exit(7);
await writeFile(outputPath,JSON.stringify({ findings: [], successful: true }));
