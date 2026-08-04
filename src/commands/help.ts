export const HELP = {
  shipyard: "shipyard <request> — record a Codex-only governed planning lane through a reviewed bound host composition. The standalone package fails closed when that composition is unavailable. Resume only with `shipyard resume DELIVERY_ID`, using the exact ID returned in status.",
  setup: "shipyard-setup --profile NAME --topology staged-pair|single-repository --development-name NAME --development-url URL [--destination-name NAME --destination-url URL] [--repo PATH] [--home PATH] [--rebind] — NAME must already exist under $SHIPYARD_HOME/profiles.",
  status: "shipyard-status [--lane large|small|bug|review-only] [--repo PATH] [--home PATH] — read binding and exact dependency status without locks or writes. Defaults to large (the full Codex planning dependency set).",
  sync: "shipyard-sync [--source-ref REF] [--repo PATH] [--home PATH] — fast-forward a clean baseline or import one exact source ref.",
  help: "shipyard-help [setup|status|sync|review|promote|finalize|help] — show focused, read-only command guidance.",
  review: "shipyard-review --delivery-id ID [--repo PATH] [--home PATH] — dispatch only the bound exact-SHA independent-review operation.",
  promote: "shipyard-promote --delivery-id ID --action initial|revision|certify [--repo PATH] [--home PATH] — dispatch only the topology-selected trusted promotion operation.",
  finalize: "shipyard-finalize --delivery-id ID [--repo PATH] [--home PATH] — observe a human merge and dispatch only the bound finalization operation.",
} as const;

export function help(topic = "shipyard"): string {
  return HELP[topic as keyof typeof HELP] ?? `Unknown help topic: ${topic}. Available topics: setup, status, sync, review, promote, finalize, help.`;
}
