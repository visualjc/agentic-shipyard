import assert from "node:assert/strict";
import { execFile as rawExecFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { GitLedgerStore } from "../../../src/adapters/ledger-git.js";
import { run } from "../../../src/cli/main.js";
import { createBoundOrchestrationOperation, createRuntime } from "../../../src/cli/runtime.js";
import { profileFingerprint } from "../../../src/profile/fingerprint.js";
import { MutationLockService } from "../../../src/locking/mutation-lock.js";
import { MemoryFilesystem, FakeProcess } from "../../helpers/fakes.js";

const execFile = promisify(rawExecFile);

test("the default bound composition records and conservatively routes without a provider or product write", async (t) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "shipyard-planning-composition-"));
  t.after(async () => { await rm(repositoryPath, { recursive: true, force: true }); });
  await git(repositoryPath, ["init"]); await git(repositoryPath, ["config", "user.email", "shipyard@example.invalid"]); await git(repositoryPath, ["config", "user.name", "Shipyard Test"]);
  await git(repositoryPath, ["commit", "--allow-empty", "-m", "initial"]);
  const commonDirectory = await realpath((await git(repositoryPath, ["rev-parse", "--git-common-dir"])).trim());
  const profile = { schemaVersion: 1 as const, name: "bound", actor: { login: "visualjc" }, topology: { kind: "single-repository" as const, repository: { owner: "visualjc", name: "shipyard", remote: { name: "origin", url: "https://github.com/visualjc/shipyard.git" }, defaultBranch: "main" } }, allowedOperations: ["setup", "status", "help"] as const, pathPolicy: { schemaVersion: 1 as const, rules: [{ owner: "product" as const, pattern: "src/**" }] } };
  const binding = { schemaVersion: 1 as const, profileName: profile.name, commonDirectory, topology: profile.topology, profileFingerprint: profileFingerprint(profile), boundAt: "2026-08-04T00:00:00.000Z" };
  const ledger = new GitLedgerStore(repositoryPath);
  await ledger.transact({ expectedHead: undefined, writes: [{ path: "bootstrap.json", contents: "{}" }], message: "initialize private ledger" });
  const productBefore = (await git(repositoryPath, ["rev-parse", "HEAD"])).trim();
  const locks = new MutationLockService(new MemoryFilesystem(), new FakeProcess());
  const operation = createBoundOrchestrationOperation({
    bindings: { async resolve(path: string) { assert.equal(path, repositoryPath); return binding; } } as any,
    profiles: { async read(name: string) { assert.equal(name, profile.name); return profile; } } as any,
    dependencyStatus: { async inspect() { return { schemaVersion: 1 as const, findings: [], ready: true, nextSafeAction: "shipyard" }; } },
    locks, planningLockPath: () => "/planning.lock",
  });
  const baseRuntime = createRuntime(join(repositoryPath, "unused-home"));
  const runtime = { ...baseRuntime, operations: { ...baseRuntime.operations, orchestrate: operation } };
  const first = await run(["add", "an", "ambiguous", "capability"], "shipyard", repositoryPath, runtime);
  assert.equal(first.code, 0, first.output);
  const status = JSON.parse(first.output) as Awaited<ReturnType<typeof operation.start>>;
  assert.equal(status.lane, "large"); assert.equal(status.phase, "awaiting-clarification"); assert.equal(status.nextSafeCommand, "$wayfinder");
  assert.equal((await git(repositoryPath, ["rev-parse", "HEAD"])).trim(), productBefore, "planning must not write a product ref");
  const recorded = await ledger.snapshot([`planning/${status.recordId}.json`]);
  assert.ok(recorded.records[`planning/${status.recordId}.json`]);
  assert.equal((await git(repositoryPath, ["rev-parse", "--verify", "refs/heads/shipyard-ledger"])).trim(), status.ledgerSha);
  const replay = await run(["resume", status.recordId], "shipyard", repositoryPath, runtime);
  assert.equal(replay.code, 0, replay.output);
  const resumed = JSON.parse(replay.output) as Awaited<ReturnType<typeof operation.resume>>;
  assert.equal(resumed.recordId, status.recordId, "resume adopts the original checkpoint without pretending Wayfinder ran");
  assert.equal(resumed.ledgerSha, status.ledgerSha, "resume must not silently advance an unresolved record");
  const small = await operation.start({ repositoryPath, requestText: "small settled scope requirements: add one bounded field" });
  const large = await operation.start({ repositoryPath, requestText: "large foggy integration scope requirements" });
  const bug = await operation.start({ repositoryPath, requestText: "bug reproduction regression: observed failure" });
  assert.deepEqual([small.lane, small.phase, small.nextSafeCommand], ["small", "classified", "$grill-with-docs"]);
  assert.deepEqual([large.lane, large.phase, large.nextSafeCommand], ["large", "classified", "$wayfinder"]);
  assert.deepEqual([bug.lane, bug.phase, bug.nextSafeCommand], ["bug", "classified", "$diagnosing-bugs"]);
  const held = await locks.acquire("/planning.lock", commonDirectory, "other");
  await assert.rejects(operation.start({ repositoryPath, requestText: "another request" }), /mutation lock/i);
  await held.release();
});

test("the default composition bootstraps a missing private ledger without a product write", async (t) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "shipyard-planning-no-ledger-"));
  t.after(async () => { await rm(repositoryPath, { recursive: true, force: true }); });
  await git(repositoryPath, ["init"]); await git(repositoryPath, ["config", "user.email", "shipyard@example.invalid"]); await git(repositoryPath, ["config", "user.name", "Shipyard Test"]); await git(repositoryPath, ["commit", "--allow-empty", "-m", "initial"]);
  const commonDirectory = await realpath((await git(repositoryPath, ["rev-parse", "--git-common-dir"])).trim()), profile = { schemaVersion: 1 as const, name: "bound", actor: { login: "visualjc" }, topology: { kind: "single-repository" as const, repository: { owner: "visualjc", name: "shipyard", remote: { name: "origin", url: "https://github.com/visualjc/shipyard.git" }, defaultBranch: "main" } }, allowedOperations: ["setup", "status", "help"] as const, pathPolicy: { schemaVersion: 1 as const, rules: [{ owner: "product" as const, pattern: "src/**" }] } }, binding = { schemaVersion: 1 as const, profileName: profile.name, commonDirectory, topology: profile.topology, profileFingerprint: profileFingerprint(profile), boundAt: "2026-08-04T00:00:00.000Z" }, before = (await git(repositoryPath, ["rev-parse", "HEAD"])).trim();
  const operation = createBoundOrchestrationOperation({ bindings: { async resolve() { return binding; } } as any, profiles: { async read() { return profile; } } as any, dependencyStatus: { async inspect() { return { schemaVersion: 1 as const, findings: [], ready: true, nextSafeAction: "shipyard" }; } }, locks: new MutationLockService(new MemoryFilesystem(), new FakeProcess()), planningLockPath: () => "/planning.lock" });
  const status = await operation.start({ repositoryPath, requestText: "work" });
  assert.equal(status.phase, "awaiting-clarification");
  assert.equal(status.nextSafeCommand, "$wayfinder");
  assert.equal((await new GitLedgerStore(repositoryPath).snapshot(["planning/bootstrap.json"])).records["planning/bootstrap.json"], "{\"kind\":\"planning-bootstrap\",\"schemaVersion\":1}");
  assert.equal((await git(repositoryPath, ["rev-parse", "HEAD"])).trim(), before);
});

test("selected-lane dependency failures never bootstrap the private ledger, while non-large lanes remain usable", async (t) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "shipyard-planning-selected-lane-"));
  t.after(async () => { await rm(repositoryPath, { recursive: true, force: true }); });
  await git(repositoryPath, ["init"]); await git(repositoryPath, ["config", "user.email", "shipyard@example.invalid"]); await git(repositoryPath, ["config", "user.name", "Shipyard Test"]); await git(repositoryPath, ["commit", "--allow-empty", "-m", "initial"]);
  const commonDirectory = await realpath((await git(repositoryPath, ["rev-parse", "--git-common-dir"])).trim());
  const profile = { schemaVersion: 1 as const, name: "bound", actor: { login: "visualjc" }, topology: { kind: "single-repository" as const, repository: { owner: "visualjc", name: "shipyard", remote: { name: "origin", url: "https://github.com/visualjc/shipyard.git" }, defaultBranch: "main" } }, allowedOperations: ["setup", "status", "help"] as const, pathPolicy: { schemaVersion: 1 as const, rules: [{ owner: "product" as const, pattern: "src/**" }] } };
  const binding = { schemaVersion: 1 as const, profileName: profile.name, commonDirectory, topology: profile.topology, profileFingerprint: profileFingerprint(profile), boundAt: "2026-08-04T00:00:00.000Z" };
  const locks = new MutationLockService(new MemoryFilesystem(), new FakeProcess());
  const operation = createBoundOrchestrationOperation({
    bindings: { async resolve() { return binding; } } as any,
    profiles: { async read() { return profile; } } as any,
    dependencyStatus: { async inspect(selected: any) { return selected.lane === "large" ? { schemaVersion: 1 as const, findings: [{ dependency: "ccpm" as const, state: "missing" as const, remediation: "install ccpm" }], ready: false, nextSafeAction: "shipyard-setup" } : { schemaVersion: 1 as const, findings: [], ready: true, nextSafeAction: "shipyard" }; } },
    locks, planningLockPath: () => "/planning.lock",
  });
  const blocked = await operation.start({ repositoryPath, requestText: "large foggy integration scope requirements" });
  assert.equal(blocked.phase, "dependency-blocked");
  assert.equal(blocked.ledgerSha, undefined);
  assert.equal((await new GitLedgerStore(repositoryPath).snapshot([])).head, undefined, "large-lane prerequisite failure must not bootstrap a ledger");
  const small = await operation.start({ repositoryPath, requestText: "small settled scope requirements" });
  assert.equal(small.lane, "small");
  assert.ok((await new GitLedgerStore(repositoryPath).snapshot(["planning/bootstrap.json"])).head, "small lane may bootstrap after its own receipt is ready");
});

test("planning lock is released when a pre-write validation error occurs", async (t) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "shipyard-planning-lock-release-"));
  t.after(async () => { await rm(repositoryPath, { recursive: true, force: true }); });
  await git(repositoryPath, ["init"]); await git(repositoryPath, ["config", "user.email", "shipyard@example.invalid"]); await git(repositoryPath, ["config", "user.name", "Shipyard Test"]); await git(repositoryPath, ["commit", "--allow-empty", "-m", "initial"]);
  const commonDirectory = await realpath((await git(repositoryPath, ["rev-parse", "--git-common-dir"])).trim());
  const profile = { schemaVersion: 1 as const, name: "bound", actor: { login: "visualjc" }, topology: { kind: "single-repository" as const, repository: { owner: "visualjc", name: "shipyard", remote: { name: "origin", url: "https://github.com/visualjc/shipyard.git" }, defaultBranch: "main" } }, allowedOperations: ["setup", "status", "help"] as const, pathPolicy: { schemaVersion: 1 as const, rules: [{ owner: "product" as const, pattern: "src/**" }] } };
  const binding = { schemaVersion: 1 as const, profileName: profile.name, commonDirectory, topology: profile.topology, profileFingerprint: profileFingerprint(profile), boundAt: "2026-08-04T00:00:00.000Z" };
  const operation = createBoundOrchestrationOperation({ bindings: { async resolve() { return binding; } } as any, profiles: { async read() { return profile; } } as any, dependencyStatus: { async inspect() { return { schemaVersion: 1 as const, findings: [], ready: true, nextSafeAction: "shipyard" }; } }, locks: new MutationLockService(new MemoryFilesystem(), new FakeProcess()), planningLockPath: () => "/planning.lock" });
  await assert.rejects(operation.start({ repositoryPath, requestText: "" }), /Planning request is invalid/);
  const recovered = await operation.start({ repositoryPath, requestText: "small settled scope requirements" });
  assert.equal(recovered.lane, "small");
});

async function git(repositoryPath: string, args: readonly string[]): Promise<string> { return (await execFile("/usr/bin/git", ["-C", repositoryPath, ...args], { encoding: "utf8" })).stdout; }

test("configured Codex review classification records intent only with a bound observer", async (t) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "shipyard-review-host-"));
  t.after(async () => { await rm(repositoryPath, { recursive: true, force: true }); });
  await git(repositoryPath, ["init"]); await git(repositoryPath, ["config", "user.email", "shipyard@example.invalid"]); await git(repositoryPath, ["config", "user.name", "Shipyard Test"]); await git(repositoryPath, ["commit", "--allow-empty", "-m", "initial"]);
  const commonDirectory = await realpath((await git(repositoryPath, ["rev-parse", "--git-common-dir"])).trim()), home = join(repositoryPath, "home"), codeHome = join(repositoryPath, "codex-home"), executable = join(repositoryPath, "codex"), target = { number: 7, url: "https://github.com/visualjc/shipyard/pull/7", headSha: "a".repeat(40), baseBranch: "main", owner: "visualjc", name: "shipyard" };
  const modelOutput = JSON.stringify({ decision: { kind: "review", scope: "settled", requirements: "compatible", regression: null, requestedHead: target.headSha, reasons: [{ code: "exact-review", evidence: "explicit pull request" }] }, reviewTarget: target });
  await writeFile(executable, `#!/bin/sh\nif [ "$1" = "--version" ]; then printf 'codex-cli 0.144.4\\n'; exit 0; fi\nout=''\nwhile [ "$#" -gt 0 ]; do if [ "$1" = "-o" ]; then shift; out="$1"; fi; shift; done\nprintf '%s' '${modelOutput}' > "$out"\n`); await chmod(executable, 0o700); await mkdir(home, { recursive: true }); await mkdir(codeHome, { recursive: true }); await writeFile(join(home, "planning-host.json"), JSON.stringify({ executable, runtimePath: "/usr/bin:/bin", codeHome }));
  const profile = { schemaVersion: 1 as const, name: "bound", actor: { login: "visualjc" }, topology: { kind: "single-repository" as const, repository: { owner: "visualjc", name: "shipyard", remote: { name: "origin", url: "https://github.com/visualjc/shipyard.git" }, defaultBranch: "main" } }, allowedOperations: ["setup", "status", "help", "review"] as const, pathPolicy: { schemaVersion: 1 as const, rules: [{ owner: "product" as const, pattern: "src/**" }] } }, binding = { schemaVersion: 1 as const, profileName: profile.name, commonDirectory, topology: profile.topology, profileFingerprint: profileFingerprint(profile), boundAt: "2026-08-04T00:00:00.000Z" };
  let observations = 0;
  const operation = createBoundOrchestrationOperation({ bindings: { async resolve() { return binding; } } as any, profiles: { async read() { return profile; } } as any, dependencyStatus: { async inspect() { return { schemaVersion: 1 as const, findings: [], ready: true, nextSafeAction: "shipyard" }; } }, planningHostPath: join(home, "planning-host.json"), reviews: { async observe() { observations += 1; return target; } }, locks: new MutationLockService(new MemoryFilesystem(), new FakeProcess()), planningLockPath: () => "/planning.lock" });
  const recorded = await operation.start({ repositoryPath, requestText: "review pull request 7" });
  assert.equal(observations, 2); assert.equal(recorded.phase, "review-intent-recorded"); assert.equal(recorded.nextSafeCommand, `shipyard-review --delivery-id ${recorded.recordId}`); assert.ok((await new GitLedgerStore(repositoryPath).snapshot([`planning/${recorded.recordId}/review-intent.json`])).records[`planning/${recorded.recordId}/review-intent.json`]);
  await rm(join(home, "planning-host.json"));
  let resumeLockAcquires = 0, resumeDependencyInspections = 0;
  const resumeOnly = createBoundOrchestrationOperation({
    bindings: { async resolve() { return binding; } } as any,
    profiles: { async read() { return profile; } } as any,
    dependencyStatus: { async inspect() { resumeDependencyInspections += 1; return { schemaVersion: 1 as const, findings: [], ready: true, nextSafeAction: "shipyard" }; } },
    planningHostPath: join(home, "planning-host.json"),
    locks: { async acquire() { resumeLockAcquires += 1; throw new Error("resume must not acquire a planning mutation lock"); } } as any,
    planningLockPath: () => { throw new Error("resume must not calculate a planning mutation lock"); },
  });
  const resumed = await resumeOnly.resume({ repositoryPath, deliveryId: recorded.recordId });
  assert.equal(resumed.recordId, recorded.recordId, "resume reads its durable checkpoint without loading a planning host");
  assert.equal(resumeLockAcquires, 0, "resume is a read-only checkpoint projection, not a new planning mutation");
  assert.ok(resumeDependencyInspections >= 1, "resume revalidates the checkpoint lane's dependency receipt without constructing a planning host");
  await writeFile(join(home, "planning-host.json"), JSON.stringify({ executable, runtimePath: "/usr/bin:/bin", codeHome }));
  const withoutObserverRepository = await mkdtemp(join(tmpdir(), "shipyard-review-no-observer-"));
  t.after(async () => { await rm(withoutObserverRepository, { recursive: true, force: true }); });
  await git(withoutObserverRepository, ["init"]); await git(withoutObserverRepository, ["config", "user.email", "shipyard@example.invalid"]); await git(withoutObserverRepository, ["config", "user.name", "Shipyard Test"]); await git(withoutObserverRepository, ["commit", "--allow-empty", "-m", "initial"]);
  const noObserverBinding = { ...binding, commonDirectory: await realpath((await git(withoutObserverRepository, ["rev-parse", "--git-common-dir"])).trim()) };
  const withoutObserver = createBoundOrchestrationOperation({ bindings: { async resolve() { return noObserverBinding; } } as any, profiles: { async read() { return profile; } } as any, dependencyStatus: { async inspect() { return { schemaVersion: 1 as const, findings: [], ready: true, nextSafeAction: "shipyard" }; } }, planningHostPath: join(home, "planning-host.json"), locks: new MutationLockService(new MemoryFilesystem(), new FakeProcess()), planningLockPath: () => "/planning.lock" });
  await assert.rejects(withoutObserver.start({ repositoryPath: withoutObserverRepository, requestText: "review pull request 7" }), /bound read-only review observer/);
  assert.deepEqual((await git(withoutObserverRepository, ["ls-tree", "-r", "--name-only", "refs/heads/shipyard-ledger"])).trim().split("\n").filter(Boolean), ["planning/bootstrap.json"]);
});

test("missing planning host and universal dependency blockers fail before classifier or ledger bootstrap", async (t) => {
  for (const scenario of ["host", "missing-executable", "wrong-version", "dependency"] as const) {
    const repositoryPath = await mkdtemp(join(tmpdir(), `shipyard-preflight-${scenario}-`));
    t.after(async () => { await rm(repositoryPath, { recursive: true, force: true }); });
    await git(repositoryPath, ["init"]); await git(repositoryPath, ["config", "user.email", "shipyard@example.invalid"]); await git(repositoryPath, ["config", "user.name", "Shipyard Test"]); await git(repositoryPath, ["commit", "--allow-empty", "-m", "initial"]);
    const profile = { schemaVersion: 1 as const, name: "bound", actor: { login: "visualjc" }, topology: { kind: "single-repository" as const, repository: { owner: "visualjc", name: "shipyard", remote: { name: "origin", url: "https://github.com/visualjc/shipyard.git" }, defaultBranch: "main" } }, allowedOperations: ["setup", "status", "help"] as const, pathPolicy: { schemaVersion: 1 as const, rules: [{ owner: "product" as const, pattern: "src/**" }] } }, binding = { schemaVersion: 1 as const, profileName: profile.name, commonDirectory: await realpath((await git(repositoryPath, ["rev-parse", "--git-common-dir"])).trim()), topology: profile.topology, profileFingerprint: profileFingerprint(profile), boundAt: "2026-08-04T00:00:00.000Z" };
    let inspections = 0; const hostPath = join(repositoryPath, "planning-host.json"), codeHome = join(repositoryPath, "codex-home");
    if (scenario === "missing-executable" || scenario === "wrong-version") { await mkdir(codeHome); const executable = join(repositoryPath, scenario === "missing-executable" ? "missing-codex" : "wrong-codex"); if (scenario === "wrong-version") { await writeFile(executable, "#!/bin/sh\nprintf '0.0.0\\n'\n"); await chmod(executable, 0o700); } await writeFile(hostPath, JSON.stringify({ executable, runtimePath: "/usr/bin:/bin", codeHome })); }
    const operation = createBoundOrchestrationOperation({ bindings: { async resolve() { return binding; } } as any, profiles: { async read() { return profile; } } as any, dependencyStatus: { async inspect() { inspections += 1; return scenario === "dependency" ? { schemaVersion: 1 as const, findings: [{ dependency: "codex" as const, state: "missing" as const, remediation: "install fixed Codex" }], ready: false, nextSafeAction: "shipyard-setup" } : { schemaVersion: 1 as const, findings: [], ready: true, nextSafeAction: "shipyard" }; } }, ...(scenario === "dependency" ? {} : { planningHostPath: scenario === "host" ? join(repositoryPath, "missing-planning-host.json") : hostPath }), locks: new MutationLockService(new MemoryFilesystem(), new FakeProcess()), planningLockPath: () => "/planning.lock" });
    if (scenario !== "dependency") await assert.rejects(operation.start({ repositoryPath, requestText: "small settled scope requirements" }), /planning host|Configured Codex|Planning classification/i);
    else { const status = await operation.start({ repositoryPath, requestText: "small settled scope requirements" }); assert.equal(status.phase, "dependency-blocked"); }
    if (scenario === "host") assert.equal(inspections, 0, "an absent configuration must prevent classification setup"); else assert.ok(inspections >= 1); assert.equal((await new GitLedgerStore(repositoryPath).snapshot([])).head, undefined, `${scenario} must not bootstrap a ledger`);
  }
});
