# Publishing Ensoul

Immutable GitHub Releases are canonical. Each new release carries the tested package archive and its provenance. npm is an optional downstream mirror and can lag without blocking a GitHub release or skill installation. Existing releases through `v0.3.2` have no package assets; preserve them unchanged. Canonical attempts `v0.3.3` and `v0.3.4` verified and attested their packages but stopped at GitHub draft lookup. Their protected tags and empty drafts remain as failure evidence. `v0.3.5` discovers prior drafts through authenticated listing and retains the ID returned by creation, so a missing immediate list result cannot strand a new draft.

## Provider prerequisites

For a GitHub release, authenticated provider readback must prove that immutable releases are enabled, `IMMUTABLE_RELEASES_ENABLED=true`, and the repository remains owner-only. `main` requires a pull request and the exact `check` status, zero human approvals, and no bypass actors. A creation-only tag ruleset permits immutable owner User ID `894119` to create `v*`; a separate no-bypass rule prevents updates and deletion. The workflows independently bind public repository ID `1350294135` and both original and triggering owner actors.

The npm mirror additionally requires the trusted publisher `hraness/ensoul`, `.github/workflows/npm-stage.yml`, environment `npm-stage`, allowing staged publication only. Its environment must select only `main`, contain no reviewers or secrets, and disable administrator bypass. These npm prerequisites apply only when invoking the mirror.

Before granting another person write access, add a provider-enforced release-workflow path restriction or a reviewed human approval boundary. Do not infer live provider state from these instructions or a repository variable alone.

## Release workflow

1. Update `package.json` and `VERSION` together, preserve the declaration and disclosure, and pass `bun run check`, independent review, and the protected pull request checks. Merge the task-owned change.
2. Create an annotated `v<VERSION>` tag at its exact merged source and push that protected tag. No npm publication is required.
3. The read-only verification job runs the tagged product gates, packs once, and tests the exact archive through the existing npm/Bun installed-payload smoke. It imports hash-verified package and release helpers from current `main`; tagged release workflows must equal current-main authority.
4. A separate job, with no product checkout or code, reauthorizes the current owner attempt and attests the archive, packing receipt, release manifest, and checksums. The handoff names bind the current run and attempt.
5. The publisher verifies the GitHub attestation signatures, hosted runner certificate, repository, tag source, workflow, exact run/attempt, and all four subjects. It checks current-main workflow/helper closure, protected tag identity, stable version ordering and live owner authority before each mutation. It discovers drafts through bounded authenticated release enumeration (the tag endpoint omits them), retains the exact release ID, uploads only missing matching assets, checks provider digests and downloaded bytes, then publishes immutable Latest.
6. Verify the live five assets and an isolated installation. Update the README's published skill pin after that version exists; the previous published pin remains usable during preparation.

The five assets are `hraness-ensoul-<VERSION>.tgz`, `npm-pack.json`, `release-manifest.json`, `SHA256SUMS`, and `provenance.jsonl`. The manifest uses `hraness-github-release-v1`, names the exact source and verification authority, and records SHA-256 and SHA-512 of the archive. Checksums provide integrity; the verified GitHub certificate provides provenance. Neither an unsigned manifest nor a checksum is sufficient authority.

A retry never moves a tag, overwrites an asset, deletes a release, or recreates an immutable version. Matching assets in the same run/attempt draft are reused after exact verification. A conflicting record or an earlier-attempt draft fails safely and needs bounded recovery against the original attested run; rerunning does not relabel earlier provenance. Keep all evidence when a provider response is ambiguous.

## Optional npm mirror

Ensoul's dual-use classification review was submitted to npm on September 9, 2026. Keep the declaration and current promotion authentication while it is pending. Do not disable authentication, remove the declaration unilaterally, or replace workload identities with email codes or personal tokens.

After canonical publication, dispatch `Mirror canonical package to npm staging` from exact current `main`. By default, `publish_to_npm=false` selects GitHub Latest, or the exact `release_tag` input, then verifies its canonical archive and completed owner release attempt. It retains the full source checks in an isolated checkout of that release and runs the current-main package verifier against those exact source bytes. The resulting handoff does not write to npm. The immutable source must remain an ancestor of the protected current-main workflow authority, which is rechecked before staging. This permits a delayed mirror after main advances without rebuilding its archive.

Set `publish_to_npm=true` only when an npm mirror is wanted. The checkout-free OIDC job preserves the retained-intent ledger and independently checks the packed configuration, canonical release asset digests, source, and current-main authority immediately before staging. npm's interactive promotion remains applicable while required by its policy. It has no effect on GitHub availability. Direct unattended mirroring can be enabled after npm confirms eligibility and the corresponding trusted-publisher controls are verified.

Keep only one pending stable stage: the workflow requires its version to be newer than
the current public `dist-tags.latest`, records a successful version-bound Actions intent
immediately before the terminal npm mutation step, and rejects a later dispatch while
retained Actions history contains an unresolved intent newer than public `latest`. The
history scan includes every attempt of the current run as well as completed `main`
dispatches, so rerunning a failed job cannot hide its earlier write intent. The workflow
re-reads `latest` at the mutation boundary,
rejects packed top-level or `publishConfig.tag` overrides, proves pinned npm's dist-tag
is its clean built-in `latest` default under empty user and global configuration, and
does not pass npm's non-default `--tag` option.

The only generic-name jobs that reached the historical terminal staging command are
sealed to their provider-owned records: failed write run `33262478732`, attempt `1`,
source `e8308cb3f89fd38377d68196b1d75a64675d2c6b`, version `0.3.0`; successful
retry run `33263116309` with that same attempt, source, and version; and successful run
`33558844386`, attempt `1`, source
`46c8b14d03fecdfe8d75e5a61d5f7bfcc255e674`, version `0.3.1`. The failed
client result remains an intent because an ambiguous provider write must be treated as
possibly successful. Public `latest` has already released these older intents, but the
workflow validates their exact run, attempt, source, job result, and terminal-step result
while Actions retains them. Every later terminal write is inspected before the job display
name is trusted, so renaming a job cannot hide a mutation. A failure, cancellation,
timeout, or success result requires exactly one successful durable intent at the
immediately preceding positive Actions step number in an exact stable-version job; an
unsealed generic record, missing intent, unsafe step number, or reversed order fails
closed.

If an npm write fails, returns ambiguously, or a staged candidate is rejected, use an
authenticated npm session or npmjs.com to resolve that exact attempted version first.
Reject a stage that exists, or prove that the failed write created none; this provider
operation may require two-factor authentication. Then dispatch the current `main`
replacement with `publish_to_npm=true` and
`resolved_stage_version=<cleared version>`. The history guard accepts only one exact
outstanding intent, and the next successful step records that clearance durably before
continuing. A crash before the clearance step leaves the intent locked; a crash after it
does not make later runs repeat the resolution. Leave the input empty normally. A
successful public promotion releases matching older intents automatically when the
version becomes `dist-tags.latest`.

npm 11.19.0 allows multiple pending stages and exposes no atomic one-pending setting.
Its trusted-publishing OIDC token can publish a stage but cannot authorize `npm stage
list`, so the checkout-free workflow cannot use npm as a provider-side inventory read.
The retained Actions-intent ledger therefore serializes only this canonical workflow;
it does not prove that npm forbids or that OIDC can observe an out-of-band stage. Treat
any locally or externally created stage as a release incident: promote or reject it
through an authenticated maintainer session before another workflow dispatch. Human
approval order controls `latest`; workflow concurrency cannot serialize an external
mutation.

The OIDC-bearing stage job contains no checkout or repository code. Before it sets up npm,
it reads the current Actions attempt and fails closed unless both the actor and triggering
actor are immutable owner User ID `894119`, the workflow/repository IDs are exact, and the
attempt is an intentional protected-`main` dispatch. It then independently parses the
downloaded tarball and permits exactly `publishConfig.access=public` plus
`publishConfig.registry=https://registry.npmjs.org`; a packed `tag`, scoped registry,
proxy, authentication, or other npm configuration is rejected before OIDC publication.
