import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createGitLedgerStore, GitLedgerStore } from "../../src/adapters/ledger-git.js";
import { createNodeWorkspaceGit } from "../../src/workspace/service.js";

test("ledger and workspace factories defer Git resolution and honor an explicit absolute executable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shipyard-git-portability-"));
  const executable = join(directory, "git");
  try {
    await writeFile(executable, "#!/bin/sh\nprintf '%s\\n' fake-sha\n", { mode: 0o700 });
    await chmod(executable, 0o700);

    // Construction is portable: an unavailable default executable is not
    // resolved until an operation. These explicit instances use the supplied
    // final path instead of the host default.
    const deferred = new GitLedgerStore("/unused");
    assert.ok(deferred instanceof GitLedgerStore);
    const ledger = createGitLedgerStore("/unused", executable);
    assert.equal((await ledger.snapshot([])).head, "fake-sha");
    const workspace = createNodeWorkspaceGit(executable);
    assert.equal(await workspace.productHead("/unused"), "fake-sha");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
