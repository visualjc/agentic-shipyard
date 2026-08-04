import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { NodeSyncGit } from "../../../src/adapters/sync-git.js";
import { NodeSyncStatusReader } from "../../../src/adapters/sync-status.js";
import { GitLedgerStore } from "../../../src/adapters/ledger-git.js";
import { canonicalSourceRef, sourceProvenanceContents, sourceProvenancePath, sourceReceiptContents, sourceReceiptPath } from "../../../src/sync/provenance.js";
import { SyncService } from "../../../src/sync/service.js";
import { MutationLockService } from "../../../src/locking/mutation-lock.js";
import { FakeProcess, MemoryFilesystem } from "../../helpers/fakes.js";
import type { Profile } from "../../../src/contracts/types.js";
import { profileFingerprint } from "../../../src/profile/fingerprint.js";

const run = promisify(execFile); const git = "/usr/bin/git";
async function command(path: string, args: string[]) { return (await run(git, ["-C", path, ...args], { encoding: "utf8" })).stdout.trim(); }
async function fixture(format = "sha1") {
  const root = await mkdtemp(join(tmpdir(), "shipyard-sync-")); const remote = join(root, "destination.git"); const repo = join(root, "development");
  await run(git, ["init", `--object-format=${format}`, "--bare", remote], { encoding: "utf8" }); await run(git, ["clone", remote, repo], { encoding: "utf8" });
  await command(repo, ["config", "user.email", "test@example.test"]); await command(repo, ["config", "user.name", "Test"]); await writeFile(join(repo, "app.ts"), "one\n"); await command(repo, ["add", "."]); await command(repo, ["commit", "-m", "initial"]); await command(repo, ["branch", "-M", "main"]); await command(repo, ["push", "origin", "main"]); await command(repo, ["remote", "rename", "origin", "upstream"]); await command(repo, ["remote", "add", "origin", remote]);
  await writeFile(join(repo, "app.ts"), "two\n"); await command(repo, ["commit", "-am", "destination"]); await command(repo, ["push", "upstream", "main"]); await command(repo, ["reset", "--hard", "HEAD~1"]); await command(repo, ["fetch", "upstream", "main"]);
  return { root, repo };
}
for (const format of ["sha1", "sha256"]) test(`concrete adapter fast-forwards an exact clean ${format} destination baseline`, async (t) => {
  let f: Awaited<ReturnType<typeof fixture>>; try { f = await fixture(format); } catch (error) { if (format === "sha256") return t.skip(`Git lacks sha256 support: ${String(error)}`); throw error; }
  try { const adapter = new NodeSyncGit(); const before = await adapter.observe(f.repo, "upstream", "main", "main"); assert.equal(before.ancestry, "behind"); await adapter.fastForward(f.repo, before.destinationSha, mutationProof(before)); const after = await adapter.observe(f.repo, "upstream", "main", "main"); assert.equal(after.ancestry, "equal"); assert.equal(after.developmentSha, before.destinationSha); assert.equal(after.clean, true); assert.equal(await (await import("node:fs/promises")).readFile(join(f.repo, "app.ts"), "utf8"), "two\n"); } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("concrete adapter imports an exact staged source without moving main", async () => {
  const f = await fixture();
  try {
    await command(f.repo, ["update-ref", "refs/shipyard/staged-development", "refs/heads/main"]); await command(f.repo, ["update-ref", "refs/shipyard/staged-destination", "refs/remotes/upstream/main"]); await command(f.repo, ["update-ref", "refs/shipyard/staged-source", "refs/remotes/upstream/main"]);
    const adapter = new NodeSyncGit(); const observation = await adapter.observe(f.repo, "upstream", "main", "main"); const before = await command(f.repo, ["rev-parse", "main"]);
    const local = canonicalSourceRef("upstream", "refs/tags/v1"); const imported = await adapter.importStaged(f.repo, f.repo, "refs/shipyard/staged-source", local, observation.destinationSha, mutationProof(observation));
    assert.equal(await command(f.repo, ["rev-parse", "main"]), before); assert.equal(await command(f.repo, ["rev-parse", local]), imported);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("direct staged import rejects refspec and arbitrary-local-ref bypasses without mutation", async (t) => {
  for (const mode of ["refspec", "arbitrary-local", "overwrite", "staged-proof"] as const) await t.test(mode, async () => {
    const f = await fixture();
    try {
      await command(f.repo, ["update-ref", "refs/shipyard/staged-development", "refs/heads/main"]); await command(f.repo, ["update-ref", "refs/shipyard/staged-destination", "refs/remotes/upstream/main"]); await command(f.repo, ["update-ref", "refs/shipyard/staged-source", "refs/remotes/upstream/main"]);
      const adapter = new NodeSyncGit(); const observation = await adapter.observe(f.repo, "upstream", "main", "main"); const before = await exactState(f.repo);
      const stagedRef = mode === "refspec" ? "+refs/shipyard/staged-source" : "refs/shipyard/staged-source";
      const localRef = mode === "arbitrary-local" ? "refs/heads/hostile-feature" : canonicalSourceRef("upstream", "refs/tags/v1");
      if (mode === "overwrite") await command(f.repo, ["update-ref", localRef, observation.developmentSha]);
      if (mode === "staged-proof") await command(f.repo, ["update-ref", "refs/shipyard/staged-development", observation.destinationSha]);
      const protectedState = await exactState(f.repo);
      await assert.rejects(adapter.importStaged(f.repo, f.repo, stagedRef, localRef, observation.destinationSha, mutationProof(observation)));
      assert.deepEqual(await exactState(f.repo), protectedState);
      if (mode !== "overwrite" && mode !== "staged-proof") assert.deepEqual(protectedState, before);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});

test("a failing status observation is never reported as a clean worktree", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-sync-status-error-")); const executable = join(root, "git");
  try { await writeFile(executable, "#!/bin/sh\ncase \"$*\" in *\"status --porcelain\"*) exit 1;; *\"symbolic-ref\"*) echo main;; *\"remote get-url\"*) echo https://github.com/acme/dest.git;; *\"show-object-format\"*) echo sha1;; *\"refs/heads/main\"*) printf '%040d\\n' 1;; *\"refs/remotes/upstream/main\"*) printf '%040d\\n' 1;; *) exit 0;; esac\n"); await chmod(executable, 0o700); const adapter = new NodeSyncGit(executable); await assert.rejects(adapter.observe("/repo", "upstream", "main", "main")); } finally { await rm(root, { recursive: true, force: true }); }
});

test("local sync status reports stale then fresh baseline facts without fetching or mutating", async () => {
  const f = await fixture();
  try {
    const remoteUrl = "https://github.com/acme/destination.git"; await command(f.repo, ["remote", "set-url", "upstream", remoteUrl]); const repository = { owner: "acme", name: "destination", remote: { name: "upstream", url: remoteUrl }, defaultBranch: "main" }; const localProfile: Profile = { schemaVersion: 1, name: "test", actor: { login: "actor" }, topology: { kind: "single-repository", repository }, allowedOperations: ["status", "sync"], pathPolicy: { schemaVersion: 1, rules: [{ owner: "product", pattern: "**" }] } }; const request = { repositoryPath: f.repo, destinationRemote: "upstream", developmentBranch: "main", destinationBranch: "main", expectedRemoteUrl: remoteUrl, profile: localProfile } as const;
    const reader = new NodeSyncStatusReader(); const beforeState = await exactState(f.repo); const stale = await reader.read(request); assert.equal(stale.baseline, "stale"); assert.deepEqual(await exactState(f.repo), beforeState);
    const adapter = new NodeSyncGit(); const observation = await adapter.observe(f.repo, "upstream", "main", "main"); await adapter.fastForward(f.repo, observation.destinationSha, mutationProof(observation)); const synchronizedState = await exactState(f.repo); const fresh = await reader.read(request); assert.equal(fresh.baseline, "fresh"); assert.equal(fresh.destinationSha, observation.destinationSha); assert.deepEqual(await exactState(f.repo), synchronizedState);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("local sync status verifies canonical provenance, pinned receipt, and local source ref read-only", async () => {
  const f = await fixture();
  try {
    const remoteUrl = "https://github.com/acme/destination.git"; await command(f.repo, ["remote", "set-url", "upstream", remoteUrl]); const repository = { owner: "acme", name: "destination", remote: { name: "upstream", url: remoteUrl }, defaultBranch: "main" }; const localProfile: Profile = { schemaVersion: 1, name: "test", actor: { login: "actor" }, topology: { kind: "single-repository", repository }, allowedOperations: ["status", "sync"], pathPolicy: { schemaVersion: 1, rules: [{ owner: "product", pattern: "**" }] } }; const request = { repositoryPath: f.repo, destinationRemote: "upstream", developmentBranch: "main", destinationBranch: "main", expectedRemoteUrl: remoteUrl, profile: localProfile } as const;
    const source = "refs/tags/v1"; const sourceSha = await command(f.repo, ["rev-parse", "main"]); const observedAt = "2026-08-04T00:00:00.000Z"; const localRef = canonicalSourceRef("upstream", source); const receiptPath = sourceReceiptPath(observedAt, "upstream", source); const ledger = new GitLedgerStore(f.repo); const snapshot = await ledger.snapshot([]); const receiptHead = await ledger.transact({ expectedHead: snapshot.head, writes: [{ path: receiptPath, contents: sourceReceiptContents({ schemaVersion: 1, remoteName: "upstream", requestedRef: source, sha: sourceSha, observedAt }) }] }); const provenance = { schemaVersion: 1 as const, remoteName: "upstream", remoteUrl, requestedRef: source, localRef, sha: sourceSha, objectFormat: "sha1" as const, observedAt, ledgerCheckpointSha: receiptHead }; await ledger.transact({ expectedHead: receiptHead, writes: [{ path: sourceProvenancePath("upstream", source), contents: sourceProvenanceContents(provenance) }] }); await command(f.repo, ["update-ref", localRef, sourceSha]);
    const reader = new NodeSyncStatusReader(); const before = await exactState(f.repo); const fresh = await reader.read(request); assert.equal(fresh.source?.fresh, true); assert.equal(fresh.source?.provenance.sha, sourceSha); assert.deepEqual(await exactState(f.repo), before);
    await command(f.repo, ["update-ref", "-d", localRef]); const missingState = await exactState(f.repo); const stale = await reader.read(request); assert.equal(stale.source?.fresh, false); assert.equal(stale.blocker?.code, "sync-source-stale"); assert.deepEqual(await exactState(f.repo), missingState);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("every Node sync Git command is killed on timeout or bounded output", async (t) => {
  for (const mode of ["hang", "flood"] as const) await t.test(mode, async () => {
    const root = await mkdtemp(join(tmpdir(), `shipyard-sync-${mode}-`)); const executable = join(root, "git");
    try {
      await writeFile(executable, mode === "hang" ? "#!/bin/sh\nwhile :; do :; done\n" : "#!/bin/sh\nwhile :; do echo github_pat_never_surface; done\n"); await chmod(executable, 0o700);
      const adapter = new NodeSyncGit(executable, { commandTimeoutMs: 150, commandMaxOutputBytes: 128 }); const started = Date.now(); let message = "";
      try { await adapter.observe("/repo", "upstream", "main", "main"); assert.fail("expected bounded Git failure"); } catch (error) { message = String(error); }
      assert.match(message, mode === "hang" ? /timed out.*killed/i : /output limit.*killed/i); assert.doesNotMatch(message, /github_pat/); assert.ok(Date.now() - started < 3_000);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

test("dirty, wrong-branch, divergent, and path-policy failures preserve the exact ref snapshot", async (t) => {
  for (const scenario of ["dirty", "wrong-branch", "diverged", "path-policy"] as const) await t.test(scenario, async () => {
    const f = await fixture();
    try {
      if (scenario === "diverged") { await writeFile(join(f.repo, "side.ts"), "side\n"); await command(f.repo, ["add", "side.ts"]); await command(f.repo, ["commit", "-m", "side"]); }
      await command(f.repo, ["update-ref", "refs/shipyard/staged-development", "main"]); await command(f.repo, ["update-ref", "refs/shipyard/staged-destination", "refs/remotes/upstream/main"]);
      if (scenario === "dirty") await writeFile(join(f.repo, "dirty.txt"), "dirty\n");
      if (scenario === "wrong-branch") await command(f.repo, ["checkout", "-b", "feature/test"]);
      const repository = { owner: "acme", name: "destination", remote: { name: "upstream", url: await command(f.repo, ["remote", "get-url", "upstream"]) }, defaultBranch: "main" };
      const profile: Profile = { schemaVersion: 1, name: "test", actor: { login: "actor" }, topology: { kind: "single-repository", repository }, allowedOperations: ["sync"], pathPolicy: { schemaVersion: 1, rules: [{ owner: "product", pattern: scenario === "path-policy" ? "src/**" : "**" }] } };
      const authority = { profileName: "test", commonDirectory: `${f.repo}/.git`, profileFingerprint: profileFingerprint(profile), actorLogin: "actor", topology: profile.topology } as const;
      const destinationSha = await command(f.repo, ["rev-parse", "refs/shipyard/staged-destination"]); const fs = new MemoryFilesystem();
      const service = new SyncService({ authority: { resolve: async () => authority }, profiles: { read: async () => profile }, git: new NodeSyncGit(), transport: { stage: async () => ({ repositoryPath: f.repo, destinationRef: "refs/shipyard/staged-destination", destinationSha, release: async () => {} }) }, ledger: { objectFormat: async () => "sha1", snapshot: async () => ({ head: undefined, records: {} }), read: async () => ({}), transact: async () => { throw new Error("ledger must not run"); } }, locks: new MutationLockService(fs, new FakeProcess()), lockPath: () => "/lock" });
      const before = await command(f.repo, ["for-each-ref", "--format=%(refname):%(objectname)"]); await assert.rejects(service.sync({ repositoryPath: f.repo })); const after = await command(f.repo, ["for-each-ref", "--format=%(refname):%(objectname)"]); assert.equal(after, before);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});

test("prepared-ref, tree-application, and ref-commit failures restore refs, index, and worktree exactly", async (t) => {
  for (const mode of ["prepare", "read-tree", "commit"] as const) await t.test(mode, async () => {
    const f = await fixture(); const wrapper = join(f.root, `git-${mode}`);
    try {
      const script = `#!/bin/sh\nif [ "$*" = "-C ${f.repo} update-ref --stdin" ]; then\n${mode === "prepare" || mode === "commit" ? `while IFS= read -r line; do case "$line" in start) echo 'start: ok';; prepare) ${mode === "prepare" ? "exit 1" : "echo 'prepare: ok'"};; commit) exit 1;; abort) echo 'abort: ok'; exit 0;; esac; done; exit 0` : "exec /usr/bin/git \"$@\""}\nfi\n${mode === "read-tree" ? `case "$*" in *"read-tree -u -m"*) exit 1;; esac` : ""}\nexec /usr/bin/git "$@"\n`;
      await writeFile(wrapper, script); await chmod(wrapper, 0o700); const adapter = new NodeSyncGit(wrapper); const beforeObservation = await adapter.observe(f.repo, "upstream", "main", "main"); const before = await exactState(f.repo);
      await assert.rejects(adapter.fastForward(f.repo, beforeObservation.destinationSha, mutationProof(beforeObservation))); assert.deepEqual(await exactState(f.repo), before);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});

test("direct adapter rejects a descendant destination that is not the proof's tracked destination", async () => {
  const f = await fixture();
  try {
    const adapter = new NodeSyncGit(); const observation = await adapter.observe(f.repo, "upstream", "main", "main");
    const hostile = await command(f.repo, ["commit-tree", `${observation.destinationSha}^{tree}`, "-p", observation.destinationSha, "-m", "hostile descendant"]);
    await command(f.repo, ["update-ref", "refs/shipyard/hostile-destination", hostile]); const before = await exactState(f.repo);
    await assert.rejects(adapter.fastForward(f.repo, hostile, mutationProof(observation)), /destination does not match/i);
    assert.deepEqual(await exactState(f.repo), before);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("post-read-tree proof drift aborts the prepared transaction before either ref moves", async (t) => {
  for (const fact of ["dirty", "branch", "development", "tracking", "remote", "format"] as const) await t.test(fact, async () => {
    const f = await fixture(); const wrapper = join(f.root, `git-post-read-tree-${fact}`); const marker = join(f.root, "proof-drift");
    try {
      const observation = await new NodeSyncGit().observe(f.repo, "upstream", "main", "main"); const expectedDevelopment = observation.developmentSha; const expectedTracking = observation.destinationSha;
      const interception = fact === "branch" ? `*"symbolic-ref --short HEAD"*) if [ -f '${marker}' ]; then echo raced; exit 0; fi;;`
        : fact === "development" ? `*"rev-parse refs/heads/main"*) if [ -f '${marker}' ]; then echo '${expectedTracking}'; exit 0; fi;;`
          : fact === "tracking" ? `*"rev-parse refs/remotes/upstream/main"*) if [ -f '${marker}' ]; then echo '${expectedDevelopment}'; exit 0; fi;;`
            : fact === "remote" ? `*"remote get-url upstream"*) if [ -f '${marker}' ]; then echo https://example.test/raced.git; exit 0; fi;;`
              : fact === "format" ? `*"rev-parse --show-object-format"*) if [ -f '${marker}' ]; then echo sha256; exit 0; fi;;` : "";
      const action = fact === "dirty" ? `touch '${join(f.repo, "raced-untracked")}'` : `touch '${marker}'`;
      const script = `#!/bin/sh\ncase "$*" in ${interception} esac\ncase "$*" in *"read-tree -u -m"*) /usr/bin/git "$@"; result=$?; ${action}; exit $result;; esac\nexec /usr/bin/git "$@"\n`;
      await writeFile(wrapper, script); await chmod(wrapper, 0o700); const adapter = new NodeSyncGit(wrapper);
      await assert.rejects(adapter.fastForward(f.repo, observation.destinationSha, mutationProof(observation)), /proof changed/i);
      assert.equal(await command(f.repo, ["rev-parse", "refs/remotes/upstream/main"]), expectedTracking);
      assert.equal(await command(f.repo, ["rev-parse", "refs/heads/main"]), expectedDevelopment);
      if (fact === "dirty") assert.equal(await readFile(join(f.repo, "raced-untracked"), "utf8"), "");
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});

test("a tracked edit during ref commit rejects and atomically restores both refs without discarding the edit", async () => {
  const f = await fixture(); const wrapper = join(f.root, "git-commit-edit-race"); const marker = join(f.root, "commit-race-fired");
  try {
    const initial = await new NodeSyncGit().observe(f.repo, "upstream", "main", "main");
    const script = `#!/bin/sh\nif [ "$*" = "-C ${f.repo} update-ref --stdin" ] && [ ! -f '${marker}' ]; then\nwhile IFS= read -r line; do case "$line" in start) echo 'start: ok';; prepare) echo 'prepare: ok';; commit) /usr/bin/git -C '${f.repo}' update-ref refs/heads/main '${initial.destinationSha}' '${initial.developmentSha}'; /usr/bin/git -C '${f.repo}' update-ref refs/remotes/upstream/main '${initial.destinationSha}' '${initial.destinationSha}'; printf 'concurrent edit\\n' > '${join(f.repo, "app.ts")}'; touch '${marker}'; exit 0;; abort) exit 0;; esac; done\nfi\nexec /usr/bin/git "$@"\n`;
    await writeFile(wrapper, script); await chmod(wrapper, 0o700); const adapter = new NodeSyncGit(wrapper);
    await assert.rejects(adapter.fastForward(f.repo, initial.destinationSha, mutationProof(initial)), /proof changed|recovery/i);
    assert.equal(await command(f.repo, ["rev-parse", "refs/heads/main"]), initial.developmentSha);
    assert.equal(await command(f.repo, ["rev-parse", "refs/remotes/upstream/main"]), initial.destinationSha);
    assert.equal(await readFile(join(f.repo, "app.ts"), "utf8"), "concurrent edit\n");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("hung, flooding, early-closing, and spawn-failing ref transaction children terminate safely", async (t) => {
  for (const mode of ["hang", "flood", "early"] as const) await t.test(mode, async () => {
    const f = await fixture(); const wrapper = join(f.root, `git-${mode}`);
    try {
      const action = mode === "hang" ? "while :; do :; done" : mode === "flood" ? "while :; do echo flood; done" : "exit 0";
      await writeFile(wrapper, `#!/bin/sh\nif [ "$*" = "-C ${f.repo} update-ref --stdin" ]; then\nwhile IFS= read -r line; do case "$line" in start) echo 'start: ok';; prepare) ${action};; esac; done\nfi\nexec /usr/bin/git "$@"\n`); await chmod(wrapper, 0o700);
      const adapter = new NodeSyncGit(wrapper, { transactionTimeoutMs: 200, transactionMaxOutputBytes: 128 }); const observation = await adapter.observe(f.repo, "upstream", "main", "main"); const before = await exactState(f.repo);
      await assert.rejects(adapter.fastForward(f.repo, observation.destinationSha, mutationProof(observation)), mode === "hang" ? /timed out/i : mode === "flood" ? /output limit/i : /before prepare/i); assert.deepEqual(await exactState(f.repo), before);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
  await t.test("spawn-error", async () => {
    const f = await fixture();
    try {
      const transactionSpawner = ((_executable: string, args: readonly string[], options: Parameters<typeof spawn>[2]) => spawn("/definitely/missing/shipyard-git", [...args], options)) as unknown as typeof spawn;
      const adapter = new NodeSyncGit(git, { transactionSpawner, transactionTimeoutMs: 1_000 }); const observation = await adapter.observe(f.repo, "upstream", "main", "main"); const before = await exactState(f.repo);
      await assert.rejects(adapter.fastForward(f.repo, observation.destinationSha, mutationProof(observation)), /could not be started/i); assert.deepEqual(await exactState(f.repo), before);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});

test("ref transaction diagnostics redact credentials and remain bounded", async () => {
  const f = await fixture(); const wrapper = join(f.root, "git-diagnostic");
  try {
    await writeFile(wrapper, `#!/bin/sh\nif [ "$*" = "-C ${f.repo} update-ref --stdin" ]; then\nwhile IFS= read -r line; do case "$line" in prepare) echo 'https://user:secret@example.test AUTHORIZATION: bearer token-value' >&2; exit 9;; esac; done\nfi\nexec /usr/bin/git "$@"\n`); await chmod(wrapper, 0o700); const adapter = new NodeSyncGit(wrapper); const observation = await adapter.observe(f.repo, "upstream", "main", "main"); let message = "";
    try { await adapter.fastForward(f.repo, observation.destinationSha, mutationProof(observation)); assert.fail("expected transaction failure"); } catch (error) { message = String(error); }
    assert.doesNotMatch(message, /user:secret|token-value/); assert.match(message, /REDACTED/); assert.ok(message.length < 700);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("staged object materialization never creates a temporary ref, including fetch and verification failures", async (t) => {
  for (const mode of ["success", "fetch", "verify", "delete-trap", "refspec"] as const) await t.test(mode, async () => {
    const f = await fixture(); const wrapper = join(f.root, `git-materialize-${mode}`);
    try {
      await command(f.repo, ["update-ref", "refs/shipyard/staged-development", "refs/heads/main"]); await command(f.repo, ["update-ref", "refs/shipyard/staged-destination", "refs/remotes/upstream/main"]); const destinationSha = await command(f.repo, ["rev-parse", "refs/shipyard/staged-destination"]);
      const guard = mode === "fetch" ? `case "$*" in *"fetch --no-tags --no-write-fetch-head"*) exit 7;; esac` : mode === "delete-trap" ? `case "$*" in *"update-ref -d refs/shipyard/staged-import"*) exit 8;; esac` : "";
      await writeFile(wrapper, `#!/bin/sh\n${guard}\nexec /usr/bin/git "$@"\n`); await chmod(wrapper, 0o700); const adapter = new NodeSyncGit(wrapper); const observation = await adapter.observe(f.repo, "upstream", "main", "main"); const before = await exactState(f.repo); const expected = mode === "verify" ? "f".repeat(40) : destinationSha;
      const stagedRef = mode === "refspec" ? "+refs/shipyard/staged-destination" : "refs/shipyard/staged-destination";
      if (mode === "fetch" || mode === "verify" || mode === "refspec") await assert.rejects(adapter.materializeStaged(f.repo, f.repo, stagedRef, expected, mutationProof(observation))); else await adapter.materializeStaged(f.repo, f.repo, stagedRef, expected, mutationProof(observation));
      assert.deepEqual(await exactState(f.repo), before); assert.equal(await command(f.repo, ["for-each-ref", "--format=%(refname)", "refs/shipyard/staged-import"]), "");
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});

test("source ledger failure leaves every product ref, index, and worktree byte unchanged", async () => {
  const f = await fixture();
  try {
    await command(f.repo, ["update-ref", "refs/shipyard/staged-development", "main"]); await command(f.repo, ["update-ref", "refs/shipyard/staged-destination", "refs/remotes/upstream/main"]); await command(f.repo, ["update-ref", "refs/shipyard/staged-source", "refs/remotes/upstream/main"]);
    const repository = { owner: "acme", name: "destination", remote: { name: "upstream", url: await command(f.repo, ["remote", "get-url", "upstream"]) }, defaultBranch: "main" }; const profile: Profile = { schemaVersion: 1, name: "test", actor: { login: "actor" }, topology: { kind: "single-repository", repository }, allowedOperations: ["sync"], pathPolicy: { schemaVersion: 1, rules: [{ owner: "product", pattern: "**" }] } }; const authority = { profileName: "test", commonDirectory: `${f.repo}/.git`, profileFingerprint: profileFingerprint(profile), actorLogin: "actor", topology: profile.topology } as const;
    const sourceSha = await command(f.repo, ["rev-parse", "refs/shipyard/staged-source"]); const destinationSha = await command(f.repo, ["rev-parse", "refs/shipyard/staged-destination"]); const fs = new MemoryFilesystem(); const service = new SyncService({ authority: { resolve: async () => authority }, profiles: { read: async () => profile }, git: new NodeSyncGit(), transport: { stage: async () => ({ repositoryPath: f.repo, destinationRef: "refs/shipyard/staged-destination", destinationSha, sourceRef: "refs/shipyard/staged-source", sourceSha, release: async () => {} }) }, ledger: { objectFormat: async () => "sha1", snapshot: async () => ({ head: undefined, records: {} }), read: async () => ({}), transact: async () => { throw new Error("injected ledger failure"); } }, locks: new MutationLockService(fs, new FakeProcess()), lockPath: () => "/lock" });
    const before = await exactState(f.repo); await assert.rejects(service.sync({ repositoryPath: f.repo, sourceRef: "refs/heads/release" }), /injected ledger failure/); assert.deepEqual(await exactState(f.repo), before); await assert.rejects(command(f.repo, ["rev-parse", "--verify", "refs/shipyard/source/upstream"]));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

async function exactState(repository: string) { return { refs: await command(repository, ["for-each-ref", "--format=%(refname):%(objectname)"]), index: await command(repository, ["write-tree"]), status: await command(repository, ["status", "--porcelain=v1"]), app: await readFile(join(repository, "app.ts"), "utf8") }; }
function mutationProof(observation: Awaited<ReturnType<NodeSyncGit["observe"]>>) { return { destinationRemote: "upstream", developmentBranch: "main", destinationBranch: "main", expectedDevelopmentSha: observation.developmentSha, expectedDestinationTrackingSha: observation.destinationSha, expectedRemoteUrl: observation.remoteUrl!, objectFormat: observation.objectFormat } as const; }
