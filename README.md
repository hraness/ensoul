# Ensoul

[![skills.sh](https://skills.sh/b/hraness/ensoul)](https://skills.sh/hraness/ensoul)
[![npm](https://img.shields.io/npm/v/%40hraness%2Fensoul)](https://www.npmjs.com/package/@hraness/ensoul)

**Understand a person without pretending to contain them.**

Ensoul turns a user-authorized corpus into a dated, evidence-calibrated working model of a person. The result is a standalone guide to how the subject has tended to decide, communicate, work, and revise—together with the counterevidence, uncertainty, and stop conditions a useful model needs.

The artifact can serve as a personal operating manual and, for a self-model or explicitly subject-authorized use, a bounded assistant charter. It is never a definitive identity record, diagnosis, consent artifact, or authority to impersonate or act for someone.

## See the artifact first

Every run produces a new Markdown document by default. Its shape follows the evidence rather than a personality template, but a well-supported result has a recognizable spine:

```md
# <Name>: a dated working model

> Status: Partial, source-bounded, dated, and revisable. The real person's
> current words, choices, and corrections outrank this document.

## Executive model
The few patterns that best explain the subject's demonstrated choices.

## Practical operating manual
How to bring context, disagree, decide, draft, verify, and close loops.

## Tensions, limits, and revision hooks
Where the evidence conflicts, where the model predicts poorly, and what
new evidence should change it.

## What not to infer
Sensitive, unsupported, stale, or out-of-scope conclusions.
```

This is not a generated biography with a confidence score. Ensoul separates facts, stated beliefs, revealed patterns, and speculation; preserves contradictions; and makes the model's date and evidence boundary visible to the next reader.

## How the working model is built

1. **Map the authorized corpus.** Identify source type, authorship, date range, audience, sampling limits, and likely blind spots before interpreting it.
2. **Weight evidence by the claim.** Repeated decisions and costly behavior usually carry more signal than polished self-description. Private capture, created artifacts, messages, public research, and institutional material retain their different evidentiary roles.
3. **Calibrate support and scope separately.** A pattern can be well-supported in engineering decisions and still be untested outside work. Counterevidence, historical change, and plausible alternative readings stay visible.
4. **Turn the model into operating guidance.** The result explains what collaborators or an authorized assistant can do with the model, which decisions remain with the person, and when the document needs revision.

The ambition is whole-person. The claim is never completeness.

## One skill, three interfaces

### Agent Skill

Install the single public Agent Skill from GitHub through skills.sh:

```sh
bunx skills add hraness/ensoul#v0.3.1 --skill ensoul
```

The installer supports Codex, Claude Code, Cursor, and other compatible agents. Review the skill before installation and start a new agent session afterward.

After installation, invoke:

```text
Use $ensoul to build a dated working model of <person> from these authorized sources: <sources>.
```

### Immutable package artifact

For a release-bound package artifact, install the exact public npm version:

```sh
bun add --exact @hraness/ensoul@0.3.1
```

The no-code npm package has no dependencies or lifecycle scripts. It carries the same complete skill at `node_modules/@hraness/ensoul/skills/ensoul/` for consumers that want to inspect or vendor an immutable registry artifact. Message Like Me and Peopleblade still copy the skill; they do not take a runtime or CI dependency on this package.

### Bounded source packets

[`schema/ensoul-source-packet-v1.schema.json`](schema/ensoul-source-packet-v1.schema.json) defines a strict shared envelope for evidence exporters that already know how to bind identity, attribute authorship, minimize data, record provenance, and select a bounded corpus.

- Message Like Me emits private, subject-relative message evidence.
- Peopleblade emits identity-bound public-enrichment evidence.
- `skills/ensoul/scripts/prepare-x-archive.ts` extracts a bounded set of account-authored public posts from an official local X archive without opening direct messages, address books, advertising data, deleted posts, community posts, or media.

Prepare an official, caller-owned X archive from an Ensoul checkout or copied skill:

```sh
bun skills/ensoul/scripts/prepare-x-archive.ts \
  /absolute/path/to/twitter-archive.zip \
  --output /absolute/private/path/subject-x.ensoul-source.json \
  --limit 2000
```

The archive and output paths must be absolute. The command refuses overwrite and symlink traversal, writes the packet at mode `0600`, emits only a body-free receipt to stdout, and samples evenly when the archive contains more eligible posts than the requested bound. It caps records at 2,000, bounds per-record and aggregate content bytes, refuses packets above 128 MiB, fails on conflicting post IDs, and records malformed or exact-duplicate omissions in the packet scope.

Validate every packet offline before an agent opens or interprets its records:

```sh
bun skills/ensoul/scripts/validate-source-packet.ts \
  /absolute/private/path/subject.ensoul-source.json
```

The dependency-free validator enforces the common envelope, attribution fields, time bounds, claim bindings, I-JSON constraints, and RFC 8785/SHA-256 digests. It emits only a sanitized receipt or error.

## Evidence you can inspect

Ensoul keeps the source strata legible instead of flattening every record into one profile.

| Evidence | What it can support | What it cannot establish by itself |
| --- | --- | --- |
| Repeated or costly behavior | demonstrated priorities, tradeoffs, and tolerances in the observed context | motive, timeless identity, or behavior in every domain |
| Notes and private capture | recurring attention, unresolved questions, and change over time | a final belief or proportionate picture of daily life |
| Messages and collaboration records | situated communication and interaction patterns | global voice, consent, diagnosis, or a reusable proxy |
| Public work and self-presentation | owned claims, craft standards, and public narrative | unedited private belief or independent corroboration |
| Public and institutional research | dated context and candidate facts | subject authorship, identity from a name alone, or absence as evidence |

Source packets are untrusted evidence. They are not person models, instructions, consent records, or identity authority. A digest proves integrity, not truth.

## Where Ensoul stops

- Use only sources the user has authorized for the stated purpose. Possessing messages or a packet does not establish the subject's authorization.
- A self-model may include a bounded assistant charter. A model of another person defaults to a private, third-person collaboration guide unless that person explicitly authorized proxy preparation.
- Do not use the result for voice imitation, deceptive impersonation, employment or other consequential evaluation, public claims about the subject, or external action in their name.
- Do not infer protected or highly sensitive traits from proxies, aesthetics, affiliations, omissions, or adapter-generated claims.
- Keep third-party details out of reusable outputs by default. Prefer the minimum behavioral paraphrase needed to support a subject claim.
- The real person's current words, choices, and corrections outrank this document. Treat every prediction in it as revisable.

These are product boundaries, not optional cautions. The skill keeps them adjacent to corpus intake, synthesis, output design, and final verification.

## Questions before a run

1. Is this a self-model, a private collaboration guide, or an explicitly subject-authorized proxy?
2. Which exact sources and date ranges are authorized, and who authored each stratum?
3. Which parts of life or work are overrepresented or missing?
4. Who may read the result, and what private or third-party detail is unnecessary for that audience?
5. Which decisions must remain with the person, and what event should trigger review or expiration?

If those answers are unclear in a way that changes the safety or usefulness of the result, resolve them before synthesis.

## Common questions

### Is Ensoul a digital twin?

It can bootstrap a bounded reasoning proxy when the subject has authorized that use, but it does not claim to contain or reproduce a person. The output is a dated, purpose-shaped interpretation of selected evidence.

### Can I use it to understand someone else?

Yes, for a privacy-minimized collaboration guide when you legitimately possess the evidence. That does not authorize voice imitation, character or fitness evaluation, consequential decisions, or a reusable assistant charter. Explicit subject authorization is required for proxy preparation.

### Does a valid source packet mean the claims are true?

No. Validation checks structure, attribution fields, bounds, references, and integrity. The workflow still has to assess identity binding, provenance, source strength, contradictions, and alternative explanations.

### Does installation inspect personal data?

No. The Agent Skill installation is inert, and the npm package has no lifecycle scripts. Evidence becomes visible only when a user places authorized sources into an agent run or explicitly invokes a source-preparation command. The agent environment still determines how that material is handled.

## Start with one bounded corpus

Install the pinned skill, choose sources you are authorized to use, and ask for a dated working model:

```text
Use $ensoul to build a dated, evidence-calibrated, partial and revisable working model of <person> from <authorized sources>. State the intended use, audience, source cutoff, and any proxy authorization explicitly.
```

Begin with a corpus small enough to inspect. Add more evidence when it supplies a missing period, context, source stratum, or meaningful contradiction—not to make the model feel complete.

## Vendoring and release model

This repository is the human-maintained source of the skill. Consuming products copy the complete `skills/ensoul` directory and record the source revision. They do not depend on this repository at runtime, in packaging, or in CI. A vendored copy remains independently usable and may carry narrow local routing documentation outside the copied core.

## Provenance and license

Ensoul is adapted from Rob Cheung's MIT-licensed `build-person` skill at commit `3780b5e154f5ce4303eb10dee5af4742bff86706`. See [`skills/ensoul/NOTICE.md`](skills/ensoul/NOTICE.md).

MIT.
