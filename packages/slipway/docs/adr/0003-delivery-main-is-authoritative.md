# Keep delivery main authoritative for product history

Product work occurs on an agentic work branch, and exact reviewed cargo commits are cherry-picked to the team-facing delivery PR. After human merge, agentic main fast-forwards to the authoritative delivery-main commit and the agentic PR closes without merge; this preserves a clean agentic baseline while allowing delivery feedback to be implemented and retested agentically before updating the same delivery PR.
