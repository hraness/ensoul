# Publishing Soulscrape

Immutable GitHub Releases are canonical. Each stable tag produces one tested package archive with GitHub provenance, publishes it as an immutable Release, and then publishes the identical bytes to npm as `@hraness/soulscrape` through trusted publishing, all inside the tag workflow. The intended routine release uses OIDC without a dispatch or long-lived token. Qualify that route against the actual package policy first; preserve any provider-required staged approval or authentication. A product rename or missing manifest declaration does not waive those controls.

Releases through `v0.3.5` were published under the previous name `@hraness/ensoul`; their tags, assets, and npm versions are preserved unchanged. The rename from `hraness/ensoul` to `hraness/soulscrape` must preserve numeric repository identity `1350294135`. The workflows bind that number and the new name; authenticated provider readback must establish the rename before release.

## Provider prerequisites

Authenticated provider readback must prove that immutable releases are enabled, `IMMUTABLE_RELEASES_ENABLED=true`, and the repository remains owner-only. `main` requires a pull request and the exact `check` status, zero human approvals, and no bypass actors. A creation-only tag ruleset permits immutable owner User ID `894119` to create `v*`; a separate no-bypass rule prevents updates and deletion. The workflows independently bind public repository ID `1350294135` and both the original and triggering owner actors.

npm publication requires:

- the GitHub environment `npm-release` with a single deployment policy that admits tags matching `v*`, administrator bypass disabled, no reviewers, and no secrets;
- one npm trusted publisher for `@hraness/soulscrape`: repository `hraness/soulscrape`, workflow file `release.yml`, environment `npm-release`, permission to publish;
- package publishing access set to require two-factor authentication and disallow tokens.

Before granting another person write access, add a provider-enforced release-workflow path restriction or a reviewed human approval boundary. Do not infer live provider state from these instructions or a repository variable alone.

## One-time bootstrap of the npm coordinate

The [npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/) require npm 11.15 or later, an existing package, package write access, and account two-factor authentication. npm cannot bind a trusted publisher before the package exists. The owner performs the first publication of `@hraness/soulscrape` once, then binds the workflow:

1. Merge the release change and pass the repository and site gates.
2. Establish the coordinate using the separately reviewed `0.4.0-bootstrap.1` prerelease with `--tag bootstrap` and the provider-required interactive authentication or staged approval. Registry readback for this publication returned both `bootstrap` and `latest` pointing to that prerelease. The first stable release gate admits either the sole `bootstrap` tag or those two tags, only when the complete registry metadata contains exactly this one version, with the matching package name, version, and reviewed archive integrity below. Extra versions, unrelated tags, or a different archive fail admission. This exception applies only to the `0.4.0` candidate. Do not publish `0.4.0` interactively: its admission gate requires provenance from the exact protected tag push, which a local publication cannot provide.
3. Bind the workflow identity and verify it:

   ```sh
   npm trust github @hraness/soulscrape --repo hraness/soulscrape --file release.yml --environment npm-release --allow-publish --yes
   npm trust list @hraness/soulscrape --json
   ```

4. Verify the package policy and environment, then push the stable tag for the unchanged reviewed source. The tag workflow must create the first stable version with its own OIDC provenance. An existing identical stable version is admissible only if its attestations already bind the required workflow, tag source, and run identity.

The reviewed bootstrap archive has integrity `sha512-mzPKNSBBJTlA7y5iEBcaA+Aw+V818UH49+jtQAygjGOPO60GfzF1daMHE8RYdW1+quyswli1H4fnPNmfA93tzw==`. Later releases retain the ordinary stable-version ordering check against `latest`. A candidate that appears between registry reads requires reconciliation before retrying; the existing exact-byte idempotency and provenance admission gates still apply.

The bootstrap is the sole traditional-credential exception. Do not store an npm password, session cookie, one-time password, recovery code, or token in GitHub.

## Release workflow

1. Update `package.json` and `VERSION` together, add the `CHANGELOG.md` entry, and pass `bun run check`, independent review, and the protected pull request checks. Merge the task-owned change.
2. Create an annotated `v<VERSION>` tag at its exact merged source and push that protected tag.
3. `verify` runs the tagged product gates, packs once, and tests the exact archive through the npm/Bun installed-payload smoke. It imports hash-verified package and release helpers from current `main`; the tagged release workflow must equal current-main authority.
4. `attest`, with no product checkout or code, reauthorizes the current owner attempt and attests the archive, packing receipt, release manifest, and checksums. Its uploaded artifact is addressed by numeric ID so that a rerun of failed jobs reuses the exact attested bytes.
5. `publish` verifies the GitHub attestation signatures, hosted runner certificate, repository, tag source, workflow, exact run/attempt, and all four subjects, then creates the draft, uploads the five assets, checks provider digests, and publishes immutable Latest.
6. `publish_npm`, checkout-free and the only npm-publishing job that requests an OIDC token, reauthorizes the attempt again, reads the immutable Latest release and requires the archive asset digest to equal the verified archive, downloads the attested artifact by ID and rebinds all five files to the trusted digests, independently parses the packed tarball and manifest, and then runs one `npm publish` with provenance from a clean directory with empty user and global configuration and without `--tag`. If the registry already holds that version with the identical integrity, the job succeeds without publishing; if it holds different bytes, the job fails and never overwrites.
7. `admit_npm` checks out the tagged source, downloads the registry package, verifies its content against the source with the package smoke, and verifies the registry signatures and both npm attestations against the exact tag push, repository ID, source commit, and this workflow path.

The five assets are `hraness-soulscrape-<VERSION>.tgz`, `npm-pack.json`, `release-manifest.json`, `SHA256SUMS`, and `provenance.jsonl`. The manifest uses `hraness-github-release-v1`, names the exact source and verification authority, and records SHA-256 and SHA-512 of the archive. Checksums provide integrity; the verified GitHub certificate provides provenance. Neither an unsigned manifest nor a checksum is sufficient authority.

A retry never moves a tag, overwrites an asset, deletes a release, recreates an immutable version, or republishes an npm version. Matching assets in the same run/attempt draft are reused after exact verification. A conflicting record or an earlier-attempt draft fails safely and needs bounded recovery against the original attested run; rerunning does not relabel earlier provenance. Keep all evidence when a provider response is ambiguous.

## Recover a failed npm publication

If `publish_npm` fails after the GitHub Release exists, inspect the exact registry state first:

```sh
npm view @hraness/soulscrape@<VERSION> dist.integrity dist.attestations.url
```

- Absent version: fix the cause (usually the trusted-publisher binding or environment policy) and rerun only the failed jobs. The attested artifact is downloaded by ID, so the rerun publishes the same bytes.
- Present version with the exact integrity from `release-manifest.json`: rerun the failed jobs; `publish_npm` recognizes the state and `admit_npm` verifies it.
- Present version with different bytes: stop. npm versions are immutable; the next release must use a new version, and the mismatch is an incident to record.

## Verify a canonical artifact after npm recovery

The signed release manifest retains the original run and attempt even when a later npm job fails. The read-only `mirror` helper admits a failed original attempt only when its complete, bounded job inventory proves that `Authorize owner release tag`, `Verify`, `Attest verified package`, and `Publish canonical GitHub release` each succeeded exactly once for the signed run, attempt, and source. Missing, duplicate, unfinished, or mismatched canonical jobs fail admission.

The helper separately requires the same run's latest attempt to be completed and successful, with the same owner, source, tag, repository, and workflow identity and an attempt number at least as recent as the signed receipt. This does not change the original provenance or admit an unfinished recovery. Signature verification, archive bytes, immutable release identity, annotated tag, source reachability, and current-main checks still apply. Publication retains its existing in-progress, owner-authorized current-attempt requirements.

## Website

`site/` is a Next.js application for soulscrape.com. Its landing copy is generated from the README block between the `hraness:soulscrape-landing` markers by `bun run sync:readme`; CI fails when the committed `site/app/landing.generated.ts` drifts from the README. `site/published-release.json` names the release the site advertises; update it only after that release's assets and installation have been verified live.
