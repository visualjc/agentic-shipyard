import { run } from "./main.js";
const result = await run(process.argv.slice(2), "sync");
process.stdout.write(result.output); process.exitCode = result.code;
