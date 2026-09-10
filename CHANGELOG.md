# Changelog

## 0.4.0

- Renamed the project from Ensoul to Soulscrape: package `@hraness/soulscrape`, skill `soulscrape`, repository `hraness/soulscrape`, website soulscrape.com. The packet schema, its `ensoul.*` identifiers, the `*.ensoul-source.json` suffix, and the validator are unchanged.
- Removed the manifest content declaration and disclosure file; provider-enforced publication controls still apply.
- Added `references/questions.md`, an asking protocol that turns a vague request into a question packet with intended use, authorization, done conditions, and stop conditions, and wired it into the skill's scoping step.
- Added `references/web-research.md`, instruction-bound public research with fetch and quoting limits, identity binding before attribution, a citation ledger, and rules for entering findings into the evidence ledger, and wired it into the skill's browsing branch.
- The tag Release workflow now publishes the identical canonical archive to npm through OIDC trusted publishing in the `npm-release` environment and verifies the registry package and its attestations; the dispatch-only staging workflow is gone.
- Added the soulscrape.com site under `site/`, with landing copy generated from the README.

## 0.3.5 and earlier

Published as `@hraness/ensoul`. See the GitHub Releases for those versions.
