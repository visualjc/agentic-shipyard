import { run } from "./main.js";
// This internal launcher deliberately shares the natural-language Shipyard
// grammar; it is not a ninth public command.
const result = await run(process.argv.slice(2), "shipyard");
process.stdout.write(result.output);
process.exitCode = result.code;
