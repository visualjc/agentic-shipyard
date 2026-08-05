# Capability preflight

Discover skills in the current host and configured skill roots before every lane. Match canonical skill name and readable `SKILL.md`; do not assume that a similarly named command is equivalent. If duplicates differ, report the paths and block selection until the user chooses.

The Matt baseline must resolve to the selected version of [mattpocock/skills](https://github.com/mattpocock/skills). In particular, `code-review` means that repository's `skills/engineering/code-review/SKILL.md` contract: independent Standards and Spec axes against a fixed point. A host built-in `/code-review`, `intent-pr-review`, `pr-change-walkthrough`, or another reviewer is not an automatic substitute. Report the discovered path and source; block on an ambiguous or conflicting canonical name.

## Core

Setup requires Git plus `setup-matt-pocock-skills`. Status and resume require only Git and the Slipway records. Missing delivery capabilities must not hide portfolio state.

## Lane requirements

Read the authoritative lane/capability matrix in [classification.md](classification.md). For a pstack build override, require the configured pstack/Poteto Mode skill and selected execution playbook. For provider operations, require Git, GitHub CLI or the configured provider capability, and the confirmed project cargo policy.

## Missing capability

Record the canonical name, purpose, searched locations, detected alternatives, and safe installation source if known. For a missing Matt baseline capability, the safe upstream source is `https://github.com/mattpocock/skills`; use its documented host installation method and record the resolved version. Stop before the first action that depends on it. Do not improvise a replacement workflow, install from an unverified source, or silently switch build providers. After installation, rediscover and rerun the preflight.

Classification, setup, status, safe pause, and unrelated lanes remain available.
