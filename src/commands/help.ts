export const HELP = {
  shipyard: "shipyard <setup|status|sync|help> [options] — dispatch a safe Shipyard command.",
  setup: "shipyard-setup --profile NAME --topology staged-pair|single-repository --development-name NAME --development-url URL [--destination-name NAME --destination-url URL] [--repo PATH] [--home PATH] [--rebind] — NAME must already exist under $SHIPYARD_HOME/profiles.",
  status: "shipyard-status [--repo PATH] [--home PATH] — read binding status without locks or writes.",
  sync: "shipyard-sync [--source-ref REF] [--repo PATH] [--home PATH] — fast-forward a clean baseline or import one exact source ref.",
  help: "shipyard-help [setup|status|sync|help] — show focused, read-only command guidance.",
} as const;

export function help(topic = "shipyard"): string {
  return HELP[topic as keyof typeof HELP] ?? `Unknown help topic: ${topic}. Available topics: setup, status, sync, help.`;
}
