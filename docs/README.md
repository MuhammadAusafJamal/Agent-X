# Agent X — Design & Delivery Docs

These are the working documents for building Agent X. Read them in this order:

| Document | What it answers |
| --- | --- |
| [architecture.md](architecture.md) | What the system is, how the pieces fit, and every decision that supersedes the original spec |
| [data-model.md](data-model.md) | Every entity, field, and enum — the contract the whole system is built on |
| [roadmap.md](roadmap.md) | The nine phases, what each one demos, and what blocks what |
| [phases/](phases/) | One file per phase, containing its epics with deliverables and acceptance criteria |

## Epic IDs

`E<phase>.<n>` — for example `E3.2` is the second epic of Phase 3. IDs are stable: if an epic is dropped, its ID is retired rather than reused, so references in commits and PRs never go stale.

Every epic states:

- **Goal** — the one sentence describing what exists after it lands
- **Depends on** — the epics that must be done first
- **Deliverables** — what gets built
- **Files** — where it lives
- **Acceptance** — the checks that decide when it is done

## Working rules

- Phases land in order. Each one ends at something demoable, so a hackathon clock running out mid-plan still leaves a working demo.
- An epic is done when every acceptance box is checked — not when the code exists.
- Branching, commit format, and coding conventions live in [../CONTRIBUTING.md](../CONTRIBUTING.md). Work lands on `feature/<slug>` off `develop`.
- **Nothing is committed until explicitly asked**, per `CONTRIBUTING.md`.

## Status legend

Used in [roadmap.md](roadmap.md) and in the epic headings.

| Mark | Meaning |
| --- | --- |
| `TODO` | Not started |
| `WIP` | In progress |
| `DONE` | All acceptance criteria met |
| `BLOCKED` | Waiting on a dependency or an unresolved decision |
