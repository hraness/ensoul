# Soulscrape: rename, edge references, and the shared core

Status: in progress. Owner decision of September 10, 2026.

## Decisions

1. Package `@hraness/soulscrape`, skill `soulscrape`, domain soulscrape.com, repository `hraness/soulscrape` (rename pending authenticated provider verification; numeric ID must remain unchanged). First version 0.4.0.
2. The wire identifiers `ensoul.source-packet.v1`, `ensoul.messages-source.v1`, `ensoul.public-enrichment-source.v1`, `ensoul.x-authored-posts-source.v1`, the schema filename, and the `*.ensoul-source.json` suffix are frozen. They name a schema revision, not a brand; both exporters and the validator pin them. `soulscrape.*.v2` identifiers arrive only with a real schema change.
3. No dual-use declaration on the new coordinate; `DISCLOSURE` removed. Preserve provider-enforced policy and qualify trusted publication independently of the name change. `@hraness/ensoul` stays as history with an npm deprecation notice pointing to the new name.
4. npm publishing uses the unified Hraness shape: `publish_npm` inside the tag Release workflow, environment `npm-release`, after a one-time owner bootstrap publish and `npm trust`.

## 0.4.0 (this change)

- Identity rename across the repository, release chain, tests, and documentation.
- `references/questions.md` and `references/web-research.md`, wired into SKILL.md.
- `publish_npm` and `admit_npm` jobs; `npm-stage.yml` and its intent ledger removed.
- `site/` for soulscrape.com with README-synced landing copy and a published-release datum.

## 0.5.0: the shared core

Message Like Me and PeopleBlade each carry their own implementation of the same canonical-JSON digest, packet validator, and X-archive reader (419, 632, and 445 lines with different limits). Both vendor the skill by copy; Message Like Me is one revision behind and its CI cannot see content drift.

Soulscrape becomes one package with two faces:

```
@hraness/soulscrape
├─ skills/soulscrape/            the Agent Skill (SKILL.md, references, scripts)
└─ src/core/                     zero dependencies, ESM, Node 24 and Bun
     ├─ canonical.ts             JCS + SHA-256, one implementation
     ├─ packet.ts                envelope types + validator (the skill script wraps it)
     ├─ x-archive.ts             bounded ZIP reader with allowlisted members
     └─ ledger.ts                claim, evidence, and stratum types; label rules
```

Consumption without breaking release chains:

- PeopleBlade adds `@hraness/soulscrape` as an immutable release archive with SRI, lists the core dist digests in `reviewedBundledInputs`, drops its hand-rolled JCS and ZIP reader, and derives its Zod contract from the core schema. It keeps the vendored skill copy, renamed to `skills/soulscrape/` at the pin bump, with its manifest-digest test.
- Message Like Me adds the core as a devDependency inlined by its dist build so `dist/` stays dependency-free, replaces `canonical-json.ts` and `x-archive-zip.ts`, and adopts PeopleBlade's manifest-digest vendoring test so drift fails CI.

The skill remains a vendored copy in both products because it must run from any install root; the core is a build-time source of truth, never a runtime skill dependency. Products are adapters that produce packets; Soulscrape models people.

Acceptance for 0.5.0: the validator script re-based on `src/core` produces byte-equal receipts and errors against the existing fixtures; one PR per consumer follows.

## Evidence

- Rename change: see the pull request that introduced this file and `CHANGELOG.md` 0.4.0.
