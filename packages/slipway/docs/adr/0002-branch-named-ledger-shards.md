# Identify ledger shards by unique work branch

Each Slipway run is identified by its complete agentic work-branch name and owns a disjoint shard on a parallel ledger branch. This makes resume and status commands match the Git artifact users already recognize and avoids a shared mutable run table; branch reuse is prohibited, renames require an explicit recorded migration, and one run coordinator owns mutable summaries while other agents append immutable events.
