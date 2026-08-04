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

test("rejects malformed primary records before recovery without removing them", async () => {
  const base = { version: 1, repository: "/git/repo", operation: "sync", processId: 22, host: "test-host", acquiredAt: "2026-08-03T00:00:00.000Z" };
  const malformed: unknown[] = [
    "{partial", { ...base, processId: 0 }, { ...base, processId: -1 }, { ...base, processId: 1.5 },
    { ...base, repository: "" }, { ...base, operation: "" }, { ...base, host: "" },
    { ...base, acquiredAt: "2026-08-03T00:00:00Z" }, { ...base, acquiredAt: "invalid" }, { ...base, extra: true },
  ];
  for (const record of malformed) {
    const fs = new MemoryFilesystem();
    const text = typeof record === "string" ? record : JSON.stringify(record);
    fs.files.set("/locks/repo", text);
    await assert.rejects(new MutationLockService(fs, new FakeProcess()).acquire("/locks/repo", "/git/repo", "sync"), (error: unknown) => error instanceof MutationLockError && error.code === "lock-invalid");
    assert.equal(fs.files.get("/locks/repo"), text);
  }
});

test("serializes release against acquisition so a replacement lock survives", async () => {
  const fs = new MemoryFilesystem();
  const process = new FakeProcess();
  const service = new MutationLockService(fs, process, 1_000);
  const held = await service.acquire("/locks/repo", "/git/repo", "sync");
  let raced = false;
  fs.onRead = async () => {
    await assert.rejects(service.acquire("/locks/repo", "/git/repo", "promote"), (error: unknown) => error instanceof MutationLockError && error.code === "lock-held");
    raced = true;
  };
  await held.release();
  assert.equal(raced, true);
  const replacement = await service.acquire("/locks/repo", "/git/repo", "promote");
  assert.equal(JSON.parse(fs.files.get("/locks/repo")!).operation, "promote");
  await replacement.release();
});

test("serializes stale recovery and refuses to release a different identity", async () => {
  const fs = new MemoryFilesystem();
  const process = new FakeProcess();
  const service = new MutationLockService(fs, process, 1_000);
  fs.files.set("/locks/repo", JSON.stringify({ version: 1, repository: "/git/repo", operation: "old", processId: 22, host: "test-host", acquiredAt: "2026-08-03T00:00:00.000Z" }));
  fs.onRead = async () => {
    await assert.rejects(service.acquire("/locks/repo", "/git/repo", "racer"), (error: unknown) => error instanceof MutationLockError && error.code === "lock-held");
  };
  const recovered = await service.acquire("/locks/repo", "/git/repo", "recovered");
  assert.equal(JSON.parse(fs.files.get("/locks/repo")!).operation, "recovered");

  const newer = { ...recovered.record, operation: "newer", acquiredAt: "2026-08-04T00:00:01.000Z" };
  fs.files.set("/locks/repo", JSON.stringify(newer));
  await assert.rejects(recovered.release(), (error: unknown) => error instanceof MutationLockError && error.code === "lock-unsafe-recovery");
  assert.deepEqual(JSON.parse(fs.files.get("/locks/repo")!), newer);
});

test("recovers an empty orphan lifecycle directory and a proven-dead owner", async () => {
  const fs = new MemoryFilesystem();
  const process = new FakeProcess();
  const service = new MutationLockService(fs, process, 1_000);
  fs.directories.add("/locks/repo.lifecycle");
  const fromEmpty = await service.acquire("/locks/repo", "/git/repo", "sync");
  await fromEmpty.release();

  fs.directories.add("/locks/repo.lifecycle");
  fs.files.set("/locks/repo.lifecycle/owner.json", JSON.stringify({ version: 1, host: "test-host", processId: 22, token: "crashed", acquiredAt: "2026-08-03T00:00:00.000Z" }));
  const fromDead = await service.acquire("/locks/repo", "/git/repo", "sync");
  await fromDead.release();
});

test("lifecycle recovery fails closed for live, cross-host, and malformed owners", async () => {
  const cases: Array<[string, unknown, MutationLockError["code"]]> = [
    ["live", { version: 1, host: "test-host", processId: 22, token: "live", acquiredAt: "2026-08-03T00:00:00.000Z" }, "lock-held"],
    ["cross-host", { version: 1, host: "other", processId: 22, token: "other", acquiredAt: "2026-08-03T00:00:00.000Z" }, "lock-unsafe-recovery"],
    ["corrupt", "{partial", "lock-invalid"],
  ];
  for (const [name, owner, expected] of cases) {
    const fs = new MemoryFilesystem(); const process = new FakeProcess();
    if (name === "live") process.alive.add(22);
    fs.directories.add("/locks/repo.lifecycle");
    fs.files.set("/locks/repo.lifecycle/owner.json", typeof owner === "string" ? owner : JSON.stringify(owner));
    await assert.rejects(new MutationLockService(fs, process).acquire("/locks/repo", "/git/repo", "sync"), (error: unknown) => error instanceof MutationLockError && error.code === expected, name);
  }
});

test("rejects malformed lifecycle records before recovery without removing them", async () => {
  const base = { version: 1, host: "test-host", processId: 22, token: "dead", acquiredAt: "2026-08-03T00:00:00.000Z" };
  const malformed: unknown[] = [
    "{partial", { ...base, processId: 0 }, { ...base, processId: -1 }, { ...base, processId: 1.5 },
    { ...base, host: "" }, { ...base, token: "" }, { ...base, acquiredAt: "2026-08-03T00:00:00Z" },
    { ...base, acquiredAt: "invalid" }, { ...base, extra: true },
  ];
  for (const owner of malformed) {
    const fs = new MemoryFilesystem();
    const text = typeof owner === "string" ? owner : JSON.stringify(owner);
    fs.directories.add("/locks/repo.lifecycle");
    fs.files.set("/locks/repo.lifecycle/owner.json", text);
    await assert.rejects(new MutationLockService(fs, new FakeProcess()).acquire("/locks/repo", "/git/repo", "sync"), (error: unknown) => error instanceof MutationLockError && error.code === "lock-invalid");
    assert.equal(fs.files.get("/locks/repo.lifecycle/owner.json"), text);
  }
});

test("two recoverers cannot remove a replacement lifecycle owner", async () => {
  const fs = new MemoryFilesystem();
  const process = new FakeProcess();
  fs.directories.add("/locks/repo.lifecycle");
  fs.files.set("/locks/repo.lifecycle/owner.json", JSON.stringify({ version: 1, host: "test-host", processId: 22, token: "dead", acquiredAt: "2026-08-03T00:00:00.000Z" }));
  let raced = false;
  fs.onRead = async (path) => {
    if (path === "/locks/repo.lifecycle/owner.json") {
      await assert.rejects(new MutationLockService(fs, process).acquire("/locks/repo", "/git/repo", "racer"), (error: unknown) => error instanceof MutationLockError && error.code === "lock-held");
      raced = true;
    }
  };
  const winner = await new MutationLockService(fs, process).acquire("/locks/repo", "/git/repo", "winner");
  assert.equal(raced, true);
  assert.equal(JSON.parse(fs.files.get("/locks/repo")!).operation, "winner");
  await winner.release();
});

test("transition mutex blocks concurrent lifecycle recovery without a filesystem race", async () => {
  const fs = new MemoryFilesystem(); const process = new FakeProcess();
  fs.directories.add("/locks/repo.lifecycle");
  fs.files.set("/locks/repo.lifecycle/owner.json", JSON.stringify({ version: 1, host: "test-host", processId: 22, token: "dead", acquiredAt: "2026-08-03T00:00:00.000Z" }));
  let contenderBlocked = false;
  fs.onRead = async (path) => {
    if (path === "/locks/repo.lifecycle/owner.json") {
      await assert.rejects(new MutationLockService(fs, process).acquire("/locks/repo", "/git/repo", "contender"), (error: unknown) => error instanceof MutationLockError && error.code === "lock-held");
      assert.ok(fs.files.has("/locks/repo.transition"), "the transition record must serialize lifecycle recovery");
      contenderBlocked = true;
    }
  };
  const winner = await new MutationLockService(fs, process).acquire("/locks/repo", "/git/repo", "winner");
  assert.equal(contenderBlocked, true);
  await winner.release();
});

test("a stale lifecycle finalizer cannot race recovery and replacement", async () => {
  const fs = new MemoryFilesystem(); const process = new FakeProcess();
  const service = new MutationLockService(fs, process, 1_000);
  const held = await service.acquire("/locks/repo", "/git/repo", "old");
  let blocked = false;
  fs.onRemove = async path => {
    if (path !== "/locks/repo.lifecycle/owner.json") return;
    fs.onRemove = undefined;
    // This is the old finalizer's vulnerable interval: the owner is gone but
    // its directory-finalizer has not run. A recoverer must not delete that
    // directory and publish a replacement under it.
    await assert.rejects(
      new MutationLockService(fs, process).acquire("/locks/repo", "/git/repo", "replacement"),
      (error: unknown) => error instanceof MutationLockError && error.code === "lock-held",
    );
    blocked = true;
  };
  await held.release();
  assert.equal(blocked, true);
  const replacement = await service.acquire("/locks/repo", "/git/repo", "replacement");
  assert.equal(JSON.parse(fs.files.get("/locks/repo")!).operation, "replacement");
  await replacement.release();
});

test("never auto-recovers a crashed transition record", async () => {
  const fs = new MemoryFilesystem(); const process = new FakeProcess();
  fs.files.set("/locks/repo.transition", JSON.stringify({ version: 1, host: "test-host", processId: 22, token: "crashed", acquiredAt: "2026-08-03T00:00:00.000Z" }));
  await assert.rejects(
    new MutationLockService(fs, process).acquire("/locks/repo", "/git/repo", "sync"),
    (error: unknown) => error instanceof MutationLockError && error.code === "lock-unsafe-recovery",
  );
  assert.ok(fs.files.has("/locks/repo.transition"));
});
