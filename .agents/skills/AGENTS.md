# Contents

- `write-phase-plan/` – dependency-ordered plan authoring with explicit scope, acceptance criteria, validation, and status.
- `phase-orchestrator/` – parent workflow for delegated phased execution, integration, and delivery.
- `phase-implementer/`, `phase-reviewer/`, and `phase-final-reviewer/` – bounded implementation, independent phase review, and end-to-end review workers.

# Guidelines

- Keep portable repository-support workflows under `.agents/skills/`; keep the single canonical public Ensoul skill under `skills/ensoul/`.
- Mark every repository-support skill with `metadata.internal: true` so public `skills add hraness/ensoul` discovery exposes only Ensoul.
- Keep the five orchestration skills installed and reviewed as one interoperable pack.
- Preserve the pinned upstream provenance and MIT license under `phase-orchestrator/`.
- Defer repository commands, validation, version control, and delivery policy to the repository's checked workflows.
