export const roles = ["implementer", "reviewer", "status"];

const recordPolicy = {
  implementer: ["contract", "task"],
  reviewer: ["contract", "acceptance", "review"],
  status: [],
};

export function evaluateHostIdentity({ host, authenticatedIdentity, forbiddenPatterns }) {
  const identity = authenticatedIdentity || "unknown";
  const forbidden = forbiddenPatterns.find((pattern) => pattern.test(identity));
  if (forbidden) {
    return {
      host,
      status: "blocked",
      allowed: false,
      reason: `authenticated identity violates profile boundary: ${identity}`,
    };
  }
  if (identity === "unknown") {
    return { host, status: "unverified", allowed: false, reason: "host identity is not inspectable" };
  }
  return { host, status: "ready", allowed: true, reason: "identity passed profile policy" };
}

export function createDispatch({ host, role, productSha, ledgerSha, records, adapterMarker }) {
  const required = recordPolicy[role];
  if (!required) throw new Error(`unknown dispatch role: ${role}`);
  return {
    schemaVersion: 1,
    host,
    role,
    productSha,
    ledgerSha,
    records: required.map((key) => {
      if (!records[key]) throw new Error(`missing ${key} record for ${role}`);
      return { key, path: records[key] };
    }),
    adapterMarker,
  };
}

export function validateDispatch({ dispatch, currentProductSha }) {
  if (dispatch.productSha !== currentProductSha) throw new Error("stale dispatch product SHA");
  if (!dispatch.ledgerSha) throw new Error("dispatch lacks ledger SHA");
  return true;
}

export function initialExplorerState() {
  return { hostIndex: 0, roleIndex: 0, stale: false, forbiddenIdentity: false };
}

export function reduceExplorer(state, action) {
  switch (action.type) {
    case "cycle-host":
      return { ...state, hostIndex: (state.hostIndex + 1) % 3 };
    case "cycle-role":
      return { ...state, roleIndex: (state.roleIndex + 1) % roles.length };
    case "toggle-stale":
      return { ...state, stale: !state.stale };
    case "toggle-identity":
      return { ...state, forbiddenIdentity: !state.forbiddenIdentity };
    default:
      return state;
  }
}

export function deriveExplorerView(state) {
  const hosts = ["claude", "codex", "cursor"];
  const host = hosts[state.hostIndex];
  const role = roles[state.roleIndex];
  const authenticatedIdentity = state.forbiddenIdentity ? "jim@justgames.io" : "personal@example.test";
  const identity = evaluateHostIdentity({
    host,
    authenticatedIdentity,
    forbiddenPatterns: [/@justgames\.io$/i, /^justgamesjim$/i],
  });
  const currentProductSha = "a".repeat(40);
  const dispatch = createDispatch({
    host,
    role,
    productSha: state.stale ? "b".repeat(40) : currentProductSha,
    ledgerSha: "c".repeat(40),
    records: {
      contract: "deliveries/PROBE/contract.md",
      task: "deliveries/PROBE/task.md",
      acceptance: "deliveries/PROBE/acceptance.md",
      review: "deliveries/PROBE/review.md",
    },
    adapterMarker: `${host}-adapter-v1`,
  });
  let freshness;
  try {
    validateDispatch({ dispatch, currentProductSha });
    freshness = { status: "fresh" };
  } catch (error) {
    freshness = { status: "blocked", reason: error.message };
  }
  return { host, role, identity, freshness, dispatch };
}

