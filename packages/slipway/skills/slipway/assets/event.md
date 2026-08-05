# Slipway event

- Event ID: `<globally unique ID>`
- Kind: `<worker|qa|review|agentic-pr|promotion|feedback|sync|finalization>`
- Writer: `<agent/session>`
- Role: `<coordinator|worker|reviewer>`
- Timestamp: `<UTC timestamp>`
- Work branch: `<complete branch>`
- Candidate SHA: `<40-hex SHA|none>`
- Status or verdict: `<value>`
- Evidence: `<canonical pointer>`

## Result

`<concise observed result>`

## Verification performed

- `<exact command and outcome>`

## Limitations

- `<limitation or none>`

This event is immutable. Corrections are new events that reference this event ID.
