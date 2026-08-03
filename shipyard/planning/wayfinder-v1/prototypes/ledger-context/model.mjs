export const roles = ["planner", "implementer", "reviewer", "promoter"];

const roleRecords = {
  planner: ["premise", "prd", "spec"],
  implementer: ["spec", "task", "acceptance"],
  reviewer: ["premise", "spec", "acceptance", "review"],
  promoter: ["acceptance", "review", "promotion", "linkage"],
};

export function resolveBinding({ commonDir, bindings }) {
  const matches = bindings.filter((binding) => binding.commonDir === commonDir);
  if (matches.length === 0) throw new Error("unbound repository; run shipyard-setup first");
  if (matches.length > 1) throw new Error("ambiguous repository binding; repair setup");
  return matches[0];
}

export function resolveDelivery({ commonDir, branch, explicitId, bindings, deliveries }) {
  const binding = resolveBinding({ commonDir, bindings });
  const inBinding = deliveries.filter((delivery) => delivery.bindingId === binding.id);

  if (explicitId) {
    const match = inBinding.find((delivery) => delivery.id === explicitId);
    if (!match) throw new Error(`delivery ${explicitId} does not belong to this binding`);
    return { binding, delivery: match, resolution: "explicit" };
  }

  const branchMatches = inBinding.filter(
    (delivery) => delivery.status === "active" && delivery.productBranch === branch,
  );
  if (branchMatches.length === 1) {
    return { binding, delivery: branchMatches[0], resolution: "worktree-branch" };
  }
  if (branchMatches.length > 1) throw new Error(`ambiguous branch ${branch}`);

  const active = inBinding.filter((delivery) => delivery.status === "active");
  if (active.length === 1) return { binding, delivery: active[0], resolution: "only-active" };
  if (active.length > 1) {
    throw new Error(`ambiguous delivery: ${active.map((delivery) => delivery.id).join(", ")}; provide an explicit ID`);
  }
  throw new Error("no active delivery; provide an archived delivery ID if reading history");
}

export function createEnvelope({ binding, delivery, role, actualProductSha }) {
  const keys = roleRecords[role];
  if (!keys) throw new Error(`unknown role: ${role}`);
  if (delivery.productSha !== actualProductSha) {
    throw new Error(
      `stale delivery state: recorded ${delivery.productSha.slice(0, 12)}, actual ${actualProductSha.slice(0, 12)}`,
    );
  }
  if (!delivery.ledgerSha) throw new Error("delivery has no pinned ledger SHA");

  const records = keys.map((key) => {
    const path = delivery.records[key];
    if (!path) throw new Error(`delivery ${delivery.id} lacks the ${key} record required by ${role}`);
    return { key, path };
  });

  return {
    schemaVersion: 1,
    profile: binding.profile,
    topology: binding.topology,
    repository: binding.repository,
    deliveryId: delivery.id,
    role,
    productBranch: delivery.productBranch,
    productSha: delivery.productSha,
    ledgerRef: delivery.ledgerRef,
    ledgerSha: delivery.ledgerSha,
    records,
  };
}

export function validateEnvelope({ envelope, delivery, actualProductSha }) {
  if (envelope.deliveryId !== delivery.id) throw new Error("envelope delivery no longer matches");
  if (envelope.productSha !== actualProductSha) throw new Error("stale envelope product SHA");
  if (envelope.productSha !== delivery.productSha) throw new Error("envelope differs from delivery product SHA");
  if (envelope.ledgerSha !== delivery.ledgerSha) throw new Error("stale envelope ledger SHA");
  return true;
}

export function initialExplorerState(fixture) {
  return {
    fixture,
    locationIndex: 0,
    explicitIndex: 0,
    roleIndex: 0,
    stale: false,
  };
}

export function reduceExplorer(state, action) {
  switch (action.type) {
    case "cycle-location":
      return { ...state, locationIndex: (state.locationIndex + 1) % state.fixture.locations.length };
    case "cycle-explicit":
      return { ...state, explicitIndex: (state.explicitIndex + 1) % state.fixture.explicitIds.length };
    case "cycle-role":
      return { ...state, roleIndex: (state.roleIndex + 1) % roles.length };
    case "toggle-stale":
      return { ...state, stale: !state.stale };
    default:
      return state;
  }
}

export function deriveExplorerView(state) {
  const location = state.fixture.locations[state.locationIndex];
  const explicitId = state.fixture.explicitIds[state.explicitIndex];
  const role = roles[state.roleIndex];
  try {
    const resolved = resolveDelivery({
      commonDir: location.commonDir,
      branch: location.branch,
      explicitId,
      bindings: state.fixture.bindings,
      deliveries: state.fixture.deliveries,
    });
    const actualProductSha = state.stale
      ? `stale-${resolved.delivery.productSha}`
      : resolved.delivery.productSha;
    const envelope = createEnvelope({ ...resolved, role, actualProductSha });
    return { location, explicitId, role, resolution: resolved.resolution, envelope, error: null };
  } catch (error) {
    return { location, explicitId, role, resolution: null, envelope: null, error: error.message };
  }
}

