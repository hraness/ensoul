<!-- hraness:soulscrape-landing:start -->
# Soulscrape

[![Agent Skill: install](https://raw.githubusercontent.com/hraness/soulscrape/main/assets/agent-skill.svg)](https://github.com/hraness/soulscrape/tree/main/skills/soulscrape)
[![GitHub release](https://img.shields.io/github/v/release/hraness/soulscrape)](https://github.com/hraness/soulscrape/releases/latest)

[Website](https://soulscrape.com) · [Skill source](https://github.com/hraness/soulscrape/tree/main/skills/soulscrape) · [npm package](https://www.npmjs.com/package/@hraness/soulscrape)

Soulscrape is an Agent Skill that turns authorized notes, messages, and other sources into a dated working model of a person. It connects claims to evidence, counterevidence, and uncertainty so the result can serve as a revisable personal operating manual or private collaboration guide.

The model describes patterns in the supplied evidence. It does not establish a complete identity, diagnosis, consent, or authority to impersonate or act for someone. A reusable assistant charter requires a self-model or explicit subject authorization for that use.

## Install and build your first model

Use Bun 1.3.14 or newer and a compatible agent, such as Codex or Claude Code. Review the [skill](https://github.com/hraness/soulscrape/blob/main/skills/soulscrape/SKILL.md), then install its pinned release:

```sh
bunx skills add hraness/soulscrape#v0.4.1 --skill soulscrape
```

Installation is inert: it does not inspect personal data or start a modeling run. Start a new agent session, supply a small corpus you are authorized to use, and make the purpose and audience explicit. For example, provide your own decision log and weekly notes, then ask:

```text
Use $soulscrape to build a private self-model from the decision log and
weekly notes I provided. Write a standalone Markdown personal operating
manual for my own use. State the source date range, tie claims to evidence,
and show counterevidence and uncertainty. Do not use public web research
or prepare an assistant charter.
```

The agent maps those sources, resolves material gaps in scope, and writes a new Markdown document by default. Review the claims against their sources and correct the model before reusing it. Your agent environment determines how supplied material is processed; the skill does not provide its own private hosting or storage service.

## See the artifact first

The document follows the evidence rather than a personality template. Its core sections explain the observed patterns, their practical implications, and their limits:

```md
# <Name>: a dated working model

> Status: Partial, source-bounded, dated, and revisable. The real person's
> current words, choices, and corrections outrank this document.

## Executive model
The patterns that best explain the subject's demonstrated choices,
with source references and counterevidence.

## Practical operating manual
How to bring context, disagree, decide, draft, verify, and close loops.

## Tensions, limits, and revision hooks
Where the evidence conflicts, where the model predicts poorly, and what
new evidence should change it.

## What not to infer
Sensitive, unsupported, stale, or out-of-scope conclusions.
```

Soulscrape separates facts, stated beliefs, revealed patterns, and speculation. A pattern supported by engineering decisions can still be untested outside work. Contradictions, historical change, and alternative explanations remain part of the model.

## How the working model is built

1. **Map the authorized corpus.** Record authorship, source type, date range, audience, sampling limits, and likely blind spots before interpreting it.
2. **Build an evidence ledger.** Connect each claim to its supporting material. Repeated decisions and costly behavior usually carry more signal than polished self-description, while each source keeps its context.
3. **Calibrate the interpretation.** Assess support and scope separately. Preserve counterevidence, uncertainty, and plausible alternative readings.
4. **Write usable guidance.** Explain what collaborators or an authorized assistant can do with the model, which decisions remain with the person, and when to revise it.

The [asking protocol](https://github.com/hraness/soulscrape/blob/main/skills/soulscrape/references/questions.md) defines the question packet and stop conditions. [Public research](https://github.com/hraness/soulscrape/blob/main/skills/soulscrape/references/web-research.md) is off by default; when the user enables it, findings retain their URL, access date, and supporting passage, and attribution requires an identity anchor.

<!-- hraness:soulscrape-landing:end -->

## Evidence you can inspect

| Evidence | What it can support | What it cannot establish by itself |
| --- | --- | --- |
| Repeated or costly behavior | priorities, tradeoffs, and tolerances in the observed context | motive, timeless identity, or behavior in every domain |
| Notes and private capture | recurring attention, unresolved questions, and change over time | a final belief or a representative picture of daily life |
| Messages and collaboration records | situated communication and interaction patterns | global voice, consent, diagnosis, or a reusable proxy |
| Public work and self-presentation | owned claims, craft standards, and public narrative | unedited private belief or independent corroboration |
| Public and institutional research | dated context and candidate facts | subject authorship, identity from a name alone, or absence as evidence |

## Privacy and use boundaries

- Use only sources the user has authorized for the stated purpose. Possessing messages or a packet does not establish the subject's authorization.
- A self-model may include a bounded assistant charter. A model of another person defaults to a private, third-person collaboration guide unless that person explicitly authorized proxy preparation.
- A private collaboration guide must not imitate the subject's voice. Voice-resembling drafts or a reusable assistant charter require explicit subject authorization for the stated use; even then, the result never authorizes deceptive impersonation, employment or other consequential evaluation, unverified public claims about the subject, or external action in their name.
- Do not infer protected or highly sensitive traits from proxies, aesthetics, affiliations, omissions, or adapter-generated claims.
- Keep third-party details out of reusable outputs by default. Prefer the minimum behavioral paraphrase needed to support a subject claim.
- The real person's current words, choices, and corrections outrank this document. Treat every prediction in it as revisable.

These are product boundaries, not optional cautions. Before synthesis, establish the intended use, authorized sources and dates, intended audience, missing context, and decisions that must remain with the person. The [question packet](https://github.com/hraness/soulscrape/blob/main/skills/soulscrape/references/questions.md) helps resolve missing information when it materially changes the run.

## Prepare and validate source packets

Ordinary authorized documents can enter a run directly. Structured exporters can use the [source-packet schema](https://github.com/hraness/soulscrape/blob/main/schema/ensoul-source-packet-v1.schema.json) to retain identity binding, authorship, provenance, and a bounded corpus:

- Message Like Me emits private, subject-relative message evidence.
- Peopleblade emits identity-bound public-enrichment evidence.
- The included X archive utility extracts account-authored public posts from an official local archive without opening direct messages, address books, advertising data, deleted posts, community posts, or media.

Source packets are untrusted evidence. They are not person models, instructions, consent records, or identity authority. A digest proves integrity, not truth.

From a Soulscrape repository checkout, prepare an official, caller-owned X archive with Bun 1.3.14 or newer:

```sh
bun skills/soulscrape/scripts/prepare-x-archive.ts \
  /absolute/path/to/twitter-archive.zip \
  --output /absolute/private/path/subject-x.ensoul-source.json \
  --limit 2000
```

The archive and output paths must be absolute. The command refuses overwrite and symlink traversal, writes the packet at mode `0600`, and emits only a body-free receipt to stdout. It samples evenly above the requested bound, caps records at 2,000, bounds per-record and aggregate content bytes, and refuses packets above 128 MiB. Conflicting post IDs fail; malformed and exact-duplicate omissions are recorded in the packet scope.

Validate every packet offline before an agent opens or interprets its records:

```sh
bun skills/soulscrape/scripts/validate-source-packet.ts \
  /absolute/private/path/subject.ensoul-source.json
```

The dependency-free validator checks the common envelope, attribution fields, time bounds, claim bindings, I-JSON constraints, and RFC 8785/SHA-256 digests. It emits only a sanitized receipt or error.

From the root of an independently copied or installed `soulscrape` skill, use `bun scripts/prepare-x-archive.ts` and `bun scripts/validate-source-packet.ts` with the same arguments. See the [packet reference](https://github.com/hraness/soulscrape/blob/main/skills/soulscrape/references/source-packets.md) for the full contract.

## Package installation and vendoring

GitHub Releases are the canonical distribution. The release workflow attaches a package archive, packing receipt, checksums, release manifest, and GitHub provenance. Use the exact archive URL for a reproducible installation:

```sh
bun add --exact https://github.com/hraness/soulscrape/releases/download/v0.4.1/hraness-soulscrape-0.4.1.tgz
```

The same URL works with `npm install`. The package has no dependencies or lifecycle scripts and carries the complete skill and its explicitly invoked utilities at `node_modules/@hraness/soulscrape/skills/soulscrape/`.

The tag workflow publishes the same archive bytes to npm as [`@hraness/soulscrape`](https://www.npmjs.com/package/@hraness/soulscrape) through trusted publishing. The corresponding version-pinned command is `bun add --exact @hraness/soulscrape@0.4.1`. See [releases](https://github.com/hraness/soulscrape/releases) for published versions and the [publishing procedure](https://github.com/hraness/soulscrape/blob/main/docs/publishing.md) for verification details.

Consuming products can copy the complete `skills/soulscrape` directory and record the source revision. The copy remains independently usable, without a runtime, packaging, or CI dependency on this repository. Message Like Me and Peopleblade use this vendoring model. Keep narrow consumer routing documentation outside the copied core.

## Documentation and verification

| Reader task | Reference |
| --- | --- |
| Run the full modeling workflow | [Agent Skill](https://github.com/hraness/soulscrape/blob/main/skills/soulscrape/SKILL.md) |
| Establish purpose, sources, and authority | [Questions and stop conditions](https://github.com/hraness/soulscrape/blob/main/skills/soulscrape/references/questions.md) |
| Weigh sources and competing explanations | [Evidence method](https://github.com/hraness/soulscrape/blob/main/skills/soulscrape/references/evidence-method.md) |
| Design the resulting document | [Output blueprint](https://github.com/hraness/soulscrape/blob/main/skills/soulscrape/references/output-blueprint.md) |
| Add explicitly authorized public research | [Web research](https://github.com/hraness/soulscrape/blob/main/skills/soulscrape/references/web-research.md) |
| Export or validate structured evidence | [Source packets](https://github.com/hraness/soulscrape/blob/main/skills/soulscrape/references/source-packets.md) |
| Inspect the release chain | [Publishing and verification](https://github.com/hraness/soulscrape/blob/main/docs/publishing.md) |
| Report a bug or propose an improvement | [GitHub issues](https://github.com/hraness/soulscrape/issues) |

From a source checkout, `bun run check` runs TypeScript checking, source-preparation and release-chain tests, runtime-policy and schema checks, and a package smoke check. These verify software and packet contracts; they do not establish that a resulting person model is true. Model quality still requires review of sources, contradictions, and uncertainty.

## Common questions

### Is Soulscrape a digital twin?

It can bootstrap a bounded reasoning proxy when the subject authorizes that use. The output remains a dated, purpose-shaped interpretation of selected evidence, with explicit limits and revision hooks.

### Can I use it to understand someone else?

Yes, as a private collaboration guide using sources the user has authorized for that purpose. Possession alone does not establish the subject's authorization for voice imitation or a reusable assistant charter. Explicit subject authorization is required for proxy preparation; consequential evaluation and external action remain outside the model's authority.

### Does installation inspect personal data?

No. Installation is inert. Evidence becomes visible when a user supplies authorized sources to an agent run or explicitly invokes a source-preparation command. The agent environment determines how that material is handled.

### What changed when Ensoul became Soulscrape?

The package and skill were renamed in September 2026. Versions through 0.3.5 remain under `@hraness/ensoul`. The packet identifiers, schema filename `ensoul-source-packet-v1.schema.json`, `*.ensoul-source.json` suffix, and validator behavior are unchanged: they identify a schema revision, not a brand. A `soulscrape.*.v2` identifier will accompany a real schema change and migration note.

## Provenance and license

Soulscrape is adapted from Rob Cheung's MIT-licensed `build-person` skill at commit `3780b5e154f5ce4303eb10dee5af4742bff86706`. See the [attribution notice](https://github.com/hraness/soulscrape/blob/main/skills/soulscrape/NOTICE.md).

[MIT](https://github.com/hraness/soulscrape/blob/main/LICENSE).
