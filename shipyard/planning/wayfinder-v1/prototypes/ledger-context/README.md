# Disposable ledger/context prototype

Question: can Shipyard use deterministic repository state plus short ledger
transactions to resolve deliveries and construct pinned, role-specific context,
or does v1 require a persistent stateful broker?

Exercise the real local-Git scenario in one command:

```sh
node prototype.mjs --exercise
```

Explore the pure resolver state by hand:

```sh
node prototype.mjs
```

The interactive keys cycle location, explicit delivery, role, and simulated
product freshness. The full derived envelope or failure is redrawn after every
action.

Both modes are throwaway evidence. `--exercise` creates and removes a synthetic
temporary repository; it does not use GitHub or existing source repositories.

