import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { nodeFilesystem } from "../../src/adapters/filesystem.js";
import { nodeProcess } from "../../src/adapters/process.js";
import { MutationLockError, MutationLockService } from "../../src/locking/mutation-lock.js";

const execFileAsync = promisify(execFile);
const lockModule = new URL("../../src/locking/mutation-lock.js", import.meta.url).href;
const filesystemModule = new URL("../../src/adapters/filesystem.js", import.meta.url).href;
const processModule = new URL("../../src/adapters/process.js", import.meta.url).href;

async function waitForJson(path: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try { return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>; }
    catch (error: unknown) {
      if (Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try { await access(path); return; }
    catch (error: unknown) {
      if (Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
}

test("real filesystem contenders never surface a lifecycle finalizer race or remove a replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-lock-transition-"));
  const lockPath = join(root, "locks", "repository.lock");
  const worker = `
    import { MutationLockError, MutationLockService } from ${JSON.stringify(lockModule)};
    import { nodeFilesystem } from ${JSON.stringify(filesystemModule)};
    import { nodeProcess } from ${JSON.stringify(processModule)};
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

test("real processes recover a dead lifecycle owner while a replacement races its finalizer", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-lock-recovery-"));
  const lockPath = join(root, "locks", "repository.lock");
  const lifecycleDirectory = `${lockPath}.lifecycle`;
  const coordination = join(root, "coordination");
  const worker = `
    import { access, mkdir, writeFile } from "node:fs/promises";
    import { join } from "node:path";
    import { MutationLockError, MutationLockService } from ${JSON.stringify(lockModule)};
    import { nodeFilesystem } from ${JSON.stringify(filesystemModule)};
    import { nodeProcess } from ${JSON.stringify(processModule)};
    const [path, directory, name, mode] = process.argv.slice(1);
    const service = new MutationLockService(nodeFilesystem, nodeProcess, 1);
    const statusPath = join(directory, name + ".json");
    const signal = async (value) => { await writeFile(statusPath, JSON.stringify(value), "utf8"); };
    const waitFor = async path => { for (;;) { try { await access(path); return; } catch { await new Promise(resolve => setTimeout(resolve, 2)); } } };
    try {
      if (mode === "recover") {
        const lock = await service.acquire(path, "/git/repository", name);
        await signal({ outcome: "success", operation: lock.record.operation });
        await waitFor(join(directory, "release"));
        await lock.release();
        await signal({ outcome: "released", operation: lock.record.operation });
      } else {
        await writeFile(join(directory, "racer-ready"), "ready", "utf8");
        let attempted = false;
        for (;;) {
          try {
            const lock = await service.acquire(path, "/git/repository", "replacement");
            await lock.release();
            await signal({ outcome: "success", operation: "replacement" });
            break;
          } catch (error) {
            if (!(error instanceof MutationLockError)) throw error;
            if (!attempted) { attempted = true; await writeFile(join(directory, "racer-attempted"), error.code, "utf8"); }
            await new Promise(resolve => setTimeout(resolve, 1));
          }
        }
      }
    } catch (error) {
      if (error instanceof MutationLockError) await signal({ outcome: "blocker", code: error.code });
      else {
        await signal({ outcome: "error", name: error instanceof Error ? error.name : typeof error, message: String(error) });
        process.exitCode = 1;
      }
    }
  `;
  try {
    await mkdir(lifecycleDirectory, { recursive: true });
    await mkdir(coordination, { recursive: true });
    await writeFile(join(lifecycleDirectory, "owner.json"), JSON.stringify({
      version: 1, host: nodeProcess.hostName(), processId: 99_999_999, token: "dead-owner", acquiredAt: new Date(Date.now() - 60_000).toISOString(),
    }), "utf8");

    const recoverers = ["recoverer-one", "recoverer-two", "recoverer-three"].map(name =>
      execFileAsync(process.execPath, ["--input-type=module", "--eval", worker, lockPath, coordination, name, "recover"], { encoding: "utf8" }),
    );
    const initial = await Promise.all(["recoverer-one", "recoverer-two", "recoverer-three"].map(name => waitForJson(join(coordination, `${name}.json`))));
    assert.equal(initial.filter(result => result.outcome === "success").length, 1);
    assert.ok(initial.every(result => result.outcome === "success" || (result.outcome === "blocker" && result.code === "lock-held")));

    const racer = execFileAsync(process.execPath, ["--input-type=module", "--eval", worker, lockPath, coordination, "racer", "race"], { encoding: "utf8" });
    await waitForFile(join(coordination, "racer-attempted"));
    await writeFile(join(coordination, "release"), "release", "utf8");

    const outcomes = await Promise.allSettled([...recoverers, racer]);
    for (const outcome of outcomes) assert.equal(outcome.status, "fulfilled", outcome.status === "rejected" ? String(outcome.reason) : "");
    const finalRecovery = await Promise.all(["recoverer-one", "recoverer-two", "recoverer-three"].map(name => waitForJson(join(coordination, `${name}.json`))));
    assert.equal(finalRecovery.filter(result => result.outcome === "released").length, 1);
    assert.equal((await waitForJson(join(coordination, "racer.json"))).outcome, "success");

    const replacement = await new MutationLockService(nodeFilesystem, nodeProcess).acquire(lockPath, "/git/repository", "final-replacement");
    assert.equal(replacement.record.operation, "final-replacement");
    await replacement.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
