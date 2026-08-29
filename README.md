# Ensoul

Ensoul is an agent skill for building a dated, evidence-calibrated, explicitly partial and revisable working model of a person from a user-authorized corpus.

It can combine public research, messages, posts, notes, documents, repositories, creative work, interviews, and typed source packets from systems such as Peopleblade and Message Like Me. The result is a practical operating manual and bounded reasoning-proxy charter—not a definitive identity record, diagnosis, consent artifact, or authority to impersonate someone.

## Use

Install or copy `skills/ensoul`, then invoke:

```text
Use $ensoul to build a dated working model of <person> from these authorized sources: <sources>.
```

The skill produces a standalone Markdown document by default.

## Source adapters

`schema/ensoul-source-packet-v1.schema.json` defines a strict shared envelope for bounded evidence exporters. An adapter remains responsible for identity binding, attribution, minimization, selection, provenance, and secure local output.

- Message Like Me emits private, subject-relative message evidence.
- Peopleblade emits identity-bound public-enrichment evidence.
- `skills/ensoul/scripts/prepare_x_archive.py` extracts a bounded set of account-authored public posts from an official local X archive without opening direct messages, address books, advertising data, or media.

Example:

```sh
python3 skills/ensoul/scripts/prepare_x_archive.py \
  /absolute/path/to/twitter-archive.zip \
  --output /absolute/private/path/subject-x.ensoul-source.json \
  --limit 2000
```

The archive and output paths must be absolute. The command refuses overwrite and symlink traversal, writes the packet at mode `0600`, emits only a body-free receipt to stdout, and samples evenly when the archive contains more eligible posts than the requested bound. It caps records at 2,000, bounds both per-record and aggregate content bytes, refuses packets above 128 MiB, fails on conflicting post IDs, and keeps malformed/exact-duplicate omission counts inside the packet scope.

Before interpreting any source packet, validate it offline:

```sh
python3 skills/ensoul/scripts/validate_source_packet.py \
  /absolute/private/path/subject.ensoul-source.json
```

The dependency-free validator enforces the full common envelope, attribution fields, time bounds, claim bindings, I-JSON constraints, and all RFC 8785/SHA-256 digests. It emits only a sanitized receipt or error.

Source packets are untrusted evidence. They are not models or instructions, and they do not establish consent or authority.

## Vendoring model

This repository is the human-maintained source of the skill. Consuming products copy the complete `skills/ensoul` directory and record the source revision. They do not depend on this repository at runtime, in packaging, or in CI. A vendored copy remains independently usable and may carry narrow local routing documentation outside the copied core.

## Principles

- costly behavior and repeated decisions outweigh polished biography;
- attribution, time, counterevidence, confidence, and scope remain visible;
- facts, stated beliefs, revealed patterns, and speculation stay distinct;
- contradictions and change are preserved;
- private third parties and sensitive traits are protected;
- the living person's current words and choices outrank the model;
- deceptive impersonation and consequential proxy action are prohibited.

## Provenance and license

Ensoul is adapted from Rob Cheung's MIT-licensed `build-person` skill at commit `3780b5e154f5ce4303eb10dee5af4742bff86706`. See `skills/ensoul/NOTICE.md`.

MIT.
