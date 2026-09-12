# Planning modules — one file per owner, deliberately

Each file here is a **pure function**: slots in, and either "what is still
missing" or "here is the call to make" out. None of them calls an agent.

That boundary is the point. The planner (`../planner.ts`) does the dispatching,
mints confirmation tokens and records hops, so these stay unit-testable with no
database and no network — and three people can work in this directory at once
without ever touching the same file.

| file | owner | intents |
|---|---|---|
| `lots.ts` | core | `lot_status`, `impact_summary` |
| `declare.ts` | Harsh | `declare_waste` |
| `credits.ts` | Ayush | `credit_status`, `retire_credit` |
| `matching.ts` | core | `run_matching` |

Return `AssistantMessage` (`{ key, params }`), never a finished sentence. The
verifier returns English prose in `reasons` and it stays English on a Punjabi
screen because `t()` cannot reach inside it. We are not repeating that.
