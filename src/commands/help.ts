export const HELP = {
  shipyard: "shipyard <setup|status|help> [options] — dispatch a safe Shipyard command.",
  setup: "shipyard-setup --profile NAME --topology staged-pair|single-repository --development-name NAME --development-url URL [--destination-name NAME --destination-url URL] [--repo PATH] [--home PATH] [--rebind]",
  status: "shipyard-status [--repo PATH] [--home PATH] — read binding status without locks or writes.",
  help: "shipyard-help [setup|status|help] — show focused, read-only command guidance.",
} as const;

export function help(topic = "shipyard"): string {
  return HELP[topic as keyof typeof HELP] ?? `Unknown help topic: ${topic}. Available topics: setup, status, help.`;
}
