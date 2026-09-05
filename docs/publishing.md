# Publish Ensoul

Ensoul binds one source revision, npm package, Git tag, and immutable GitHub Release to the same stable version. Publish npm before creating the tag; the tag workflow refuses to release bytes that are not already public and identical on npm.

## Completed package bootstrap

`@hraness/ensoul` already exists on npm, so its one-time interactive first
publication is historical. Do not use local `npm publish` for a later version.
Every later package must use the checked stage-only workflow below. Never put
an npm password, one-time code, recovery code, session cookie, or long-lived
publishing token in the repository, a command argument, an environment
variable, or a GitHub secret.

The following provider controls are bootstrap prerequisites, not a claim about
current live configuration. Do not stage or tag a release until an authenticated
readback proves all of them are active: npm trusted publishing for
`hraness/ensoul`, `.github/workflows/npm-stage.yml`, and environment `npm-stage`,
allowing `npm stage publish` only; a GitHub environment with administrator bypass
disabled, no reviewers or secrets, and only the selected `main` branch; and a
`main` ruleset requiring a pull request plus the exact `check` status, zero human
approvals, and no bypass actors. A separate creation-only ruleset must permit only
immutable owner User ID `894119` to create `v*` tags, while a no-bypass ruleset
prevents every actor from updating or deleting those tags. Until that readback,
the workflow's protected-ref checks intentionally fail closed.

Zero routine pull-request approvals are intentional while Ensoul remains an
owner-only repository: automated checks and provider path controls carry the
routine gate. These checks do not make workflow files safe from a future
malicious write collaborator. Before granting another person write access, add a
provider-enforced workflow-path restriction or a required human review for
changes to release authority, then verify that boundary through live readback.

## Build agent release candidates

Ensoul declares dual-use content. [npm's current dual-use policy](https://docs.npmjs.com/policies/dual-use/)
therefore forbids direct OIDC publication and requires 2FA to be enforced when a staged
package is promoted to public. Do not replace that provider boundary with direct trusted
publishing, a bypass-2FA token, or a local automation token.

Agents can still build and exercise release candidates without creating an npm stage or
interrupting a maintainer. Dispatch `npm-stage.yml` from exact current `main` with its
default `publish_to_npm=false` input. The verify job runs the package gates and uploads the
exact tarball plus its pack and SHA-256 receipts as a 30-day GitHub Actions artifact; the
stage job is skipped. Give the resulting run one owner, record its exact run ID, and use
`gh run download <run-id>` to install and smoke that candidate. Treat it as an ephemeral
candidate, not a public npm version or release.

Collect validated candidates into a less-frequent stable train. Only when the stable
version is ready for public npm delivery should an agent dispatch the same workflow with
`publish_to_npm=true`, then request the one unavoidable staged-publication approval below.
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
while Actions retains them. Every later mutation requires a successful intent step in a
stable-version job; an unsealed generic record or terminal write without one intent
fails closed.

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

## Publish later versions

1. Update `VERSION`, `package.json`, and version-pinned install text together; merge only after the required check passes.
2. Dispatch `Build or stage npm package` from current `main` with `publish_to_npm=true`. The workflow proves the version is new, builds and smokes one exact artifact, and submits it through npm OIDC with provenance.
3. Review and approve the staged package through npm's interactive stage flow.
4. Verify the live registry artifact against current `main` with `bun scripts/package-smoke.ts`.
5. Create and push `v<VERSION>` only after that verification. The tag workflow keeps product tests and source packaging on the exact tagged commit, but first requires the tag's `release.yml` and `npm-stage.yml` to be byte-identical to current `main`. After packing, it materializes `package-smoke.ts` and `npm-provenance-identity.ts` from that exact current-`main` commit into nonconflicting paths beside the tagged helpers, verifies their Git blob identities, and invokes them with Bun environment/config discovery disabled. Those current helpers validate both archives, compare a canonical SHA-256 digest over each sorted package member's exact path, type, mode, size, and raw bytes, and verify the pinned npm signature audit. The audit must contain no missing or invalid signatures, exactly one npm publish attestation, and exactly one SLSA v1 provenance statement bound to the registry tarball SHA-512, exact source commit, public repository and owner IDs, protected `main`, the npm-stage workflow path, manual-dispatch event, GitHub-hosted builder, and invocation attempt. The invocation is read back through GitHub and must be the completed successful owner-authorized staging attempt. This binds the installed payload without depending on gzip output, tar ordering, incidental container metadata, or an unaudited registry response.
6. Run one normal skills CLI install for the released tag and verify the canonical skills.sh page.

Repository immutable releases are a bootstrap precondition whose live state must
be read back before use. The tag workflow checks the protected annotated tag,
immutable owner identity, exact public repository and workflow IDs, both the
original and attempt-specific triggering actor, current tag target, and current
`main` reachability before its write-scoped job creates any release. The verifier
records the exact current-`main` commit that supplied its helper code. The write job
checks out `main`, imports its live head again, and requires the tagged release and
npm-stage workflows still to equal that head and the recorded helper files still to
equal it. Immediately before creation it rechecks npm `latest`, the tag target, and
both current-main closures, and fails if `main` moved during final authorization. A
pre-existing release is accepted only
when its tag, title, provenance body, immutable state, empty assets, and immutable
GitHub Actions bot identity all match the exact source and workflow run; any other
pre-existing release fails closed. A collaborator rerun cannot reuse the original
owner's attempt authorization.
