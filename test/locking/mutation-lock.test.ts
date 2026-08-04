import assert from "node:assert/strict";
import test from "node:test";
import { MutationLockError, MutationLockService } from "../../src/locking/mutation-lock.js";
import { FakeProcess, MemoryFilesystem } from "../helpers/fakes.js";

test("rejects a concurrent live lock and reclaims only a proven-dead same-host stale lock", async () => {
  const fs = new MemoryFilesystem();
  const process = new FakeProcess();
  const service = new MutationLockService(fs, process, 1_000);
  const first = await service.acquire("/locks/repo", "/git/repo", "sync");
  await assert.rejects(service.acquire("/locks/repo", "/git/repo", "promote"), (error: unknown) => error instanceof MutationLockError && error.code === "lock-held");
  fs.files.set("/locks/repo", JSON.stringify({ ...first.record, processId: 22, acquiredAt: "2026-08-03T00:00:00.000Z" }));
  const recovered = await service.acquire("/locks/repo", "/git/repo", "promote");
  await recovered.release();
});

test("never removes a stale lock without host and process validation", async () => {
  const fs = new MemoryFilesystem();
  const process = new FakeProcess();
  const service = new MutationLockService(fs, process, 1_000);
  const cases: Array<[unknown, MutationLockError["code"]]> = [
    [{ version: 1, repository: "/git/repo", operation: "sync", processId: 22, host: "other-host", acquiredAt: "2026-08-03T00:00:00.000Z" }, "lock-unsafe-recovery"],
    [{ version: 1, repository: "/git/other", operation: "sync", processId: 22, host: "test-host", acquiredAt: "2026-08-03T00:00:00.000Z" }, "lock-invalid"],
    [{ version: 1, repository: "/git/repo", operation: "sync", processId: 22, host: "test-host", acquiredAt: "not-a-date" }, "lock-invalid"],
  ];
  for (const [record, expected] of cases) {
    fs.files.set("/locks/repo", JSON.stringify(record));
    await assert.rejects(service.acquire("/locks/repo", "/git/repo", "sync"), (error: unknown) => error instanceof MutationLockError && error.code === expected);
  }
  process.alive.add(22);
  fs.files.set("/locks/repo", JSON.stringify({ version: 1, repository: "/git/repo", operation: "sync", processId: 22, host: "test-host", acquiredAt: "2026-08-03T00:00:00.000Z" }));
  await assert.rejects(service.acquire("/locks/repo", "/git/repo", "sync"), (error: unknown) => error instanceof MutationLockError && error.code === "lock-held");
});
