#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const args=process.argv.slice(2);
if(args[0]==="--version"){process.stdout.write("codex-tree-fixture-1");process.exit(0);}
const home=process.env.CODEX_HOME,mode=(await readFile(join(home,"tree-mode.txt"),"utf8")).trim(),marker=join(home,`.descendant-${mode}`),sessionDir=process.env.SHIPYARD_REVIEW_SESSION_DIR;
await writeFile(join(home,`.tree-session-${mode}.txt`),sessionDir??"");
spawn(process.execPath,["-e",`setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'survived'),700)`],{stdio:"ignore"});
if(mode==="oversize")process.stdout.write("x".repeat(1_000_001));
await new Promise(()=>{});
