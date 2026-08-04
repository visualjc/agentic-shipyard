import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { nodeFilesystem } from "../../src/adapters/filesystem.js";
import { nodeProcess } from "../../src/adapters/process.js";
import { MutationLockError, MutationLockService } from "../../src/locking/mutation-lock.js";

const execFileAsync = promisify(execFile);
const lockModule = new URL("../../src/locking/mutation-lock.js", import.meta.url).href;

test("real filesystem contenders never surface a lifecycle finalizer race or remove a replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-lock-transition-"));
  const lockPath = join(root, "locks", "repository.lock");
  const worker = `
    import { MutationLockError, MutationLockService } from ${JSON.stringify(lockModule)};
    import { nodeFilesystem } from ${JSON.stringify(new URL("../../src/adapters/filesystem.js", import.meta.url).href)};
    import { nodeProcess } from ${JSON.stringify(new URL("../../src/adapters/process.js", import.meta.url).href)};
    const [path, operation] = process.argv.slice(1);
    const service = new MutationLockService(nodeFilesystem, nodeProcess);
    for (let index = 0; index < 120; index += 1) {
      let lock;
      try { lock = await service.acquire(path, "/git/repository", operation); }
      catch (error) {
        if (!(error instanceof MutationLockError)) throw error;
        // A command-shaped contender backs off after either the primary lock or
        // the short transition mutex blocks it, so it cannot starve a release.
        await new Promise(resolve => setTimeout(resolve, 1));
        continue;
      }
      await new Promise(resolve => setTimeout(resolve, index % 3));
      for (let attempt = 0; ; attempt += 1) {
        try { await lock.release(); break; }
        catch (error) {
          if (!(error instanceof MutationLockError) || error.code !== "lock-held" || attempt === 1_000) throw error;
          await new Promise(resolve => setTimeout(resolve, 1));
        }
      }
    }
  `;
  try {
    const outcomes = await Promise.allSettled(
      ["one", "two", "three", "four"].map(operation => execFileAsync(process.execPath, ["--input-type=module", "--eval", worker, lockPath, operation], { encoding: "utf8" })),
    );
    for (const outcome of outcomes) {
      assert.equal(outcome.status, "fulfilled", outcome.status === "rejected" ? String(outcome.reason) : "");
    }
    const replacement = await new MutationLockService(nodeFilesystem, nodeProcess).acquire(lockPath, "/git/repository", "replacement");
    assert.equal(replacement.record.operation, "replacement");
    await replacement.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
