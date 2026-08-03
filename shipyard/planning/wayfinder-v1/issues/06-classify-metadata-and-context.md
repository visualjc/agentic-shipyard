# Classify metadata and context by ownership

Type: grilling  
Status: resolved

## Question

How does Shipyard decide which agentic artifacts may synchronize or promote,
especially when repository context differs between development and destination?

## Answer

Profiles choose `development-only` or `shared` metadata policy. The former hard
blocks all Shipyard records from the destination. The latter permits only paths
explicitly classified as shareable. Shared never means automatic publication.

Paths are classified as product, development record, development-generated,
company-only, context overlay, or scratch. Existing destination product paths
may follow product policy; new or changed paths that cannot be classified block
sync or promotion. Secrets and scratch data are prohibited in every policy.

Context has three layers: team-owned tracked repository context,
profile-owned development context, and delivery/worktree context. One Git path
has one owner. Personal meanings should move to profile or delivery overlays
rather than diverge from company content at the same tracked path. Exceptional
same-path dual ownership blocks automatic reconciliation and requires an
explicit result.

Shipyard may report and explain context drift, but it never silently rewrites or
semantically merges context documents.

## Comments

- Imported from the completed Shipyard grilling session on 2026-08-03.

