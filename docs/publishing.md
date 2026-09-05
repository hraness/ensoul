# Publish Ensoul

Ensoul binds one source revision, npm package, Git tag, and immutable GitHub Release to the same stable version. Publish npm before creating the tag; the tag workflow refuses to release bytes that are not already public and identical on npm.

## Completed package bootstrap

`@hraness/ensoul` already exists on npm, so its one-time interactive first
publication is historical. Do not use local `npm publish` for a later version.
Every later package must use the checked stage-only workflow below. Never put
an npm password, one-time code, recovery code, session cookie, or long-lived
publishing token in the repository, a command argument, an environment
variable, or a GitHub secret.

Configure npm trusted publishing for `hraness/ensoul`,
`.github/workflows/npm-stage.yml`, and environment `npm-stage`, allowing
`npm stage publish` only. The GitHub environment must disable administrator
bypass, have no reviewers or secrets, and admit only the selected `main` branch.
The repository's `main` ruleset requires a pull request and the exact `check`
status but zero human approvals, with no bypass actors. A separate creation-only
ruleset permits only immutable owner User ID `894119` to create `v*` tags; a
no-bypass ruleset prevents every actor from updating or deleting those tags.

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
the current public `dist-tags.latest` and submits it explicitly under `latest`.

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
5. Create and push `v<VERSION>` only after that verification. The tag workflow re-runs the tests, requires that exact version to remain `dist-tags.latest`, validates both archives, compares a canonical SHA-256 digest over each sorted package member's exact path, type, mode, size, and raw bytes, and creates an immutable GitHub Release. It also runs pinned npm's signature audit in an isolated install, requires no missing or invalid signatures, and verifies exactly one npm publish attestation plus one SLSA v1 provenance statement against the registry tarball SHA-512, exact source commit, public repository and owner IDs, protected `main`, the npm-stage workflow path, manual-dispatch event, GitHub-hosted builder, and invocation attempt. The invocation is read back through GitHub and must be the completed successful owner-authorized staging attempt. This binds the installed payload without depending on gzip output, tar ordering, incidental container metadata, or an unaudited registry response.
6. Run one normal skills CLI install for the released tag and verify the canonical skills.sh page.

Repository immutable releases are a precondition. The tag workflow checks the
protected annotated tag, immutable owner identity, exact public repository and
workflow IDs, both the original and attempt-specific triggering actor, current
tag target, and current `main` reachability before its write-scoped job creates
any release. A failed job rerun by another collaborator therefore cannot reuse
the original owner's authority.
