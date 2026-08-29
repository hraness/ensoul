# Publish Ensoul

Ensoul binds one source revision, npm package, Git tag, and immutable GitHub Release to the same stable version. Publish npm before creating the tag; the tag workflow refuses to release bytes that are not already public and identical on npm.

## Bootstrap the npm package

The first public `@hraness/ensoul` version cannot use trusted staging because npm requires the package to exist before a trusted publisher can be configured.

From current `main`, after the required check passes:

1. Create one exact artifact and smoke that same file.

   ```sh
   ensoul_artifact="$(mktemp -d)"
   ensoul_pack_json="$ensoul_artifact/npm-pack.json"
   npm pack \
     --ignore-scripts \
     --json \
     --pack-destination "$ensoul_artifact" \
     --registry=https://registry.npmjs.org > "$ensoul_pack_json"
   ensoul_archive="$ensoul_artifact/hraness-ensoul-0.3.0.tgz"
   bun scripts/package-smoke.ts \
     --archive "$ensoul_archive" \
     --pack-json "$ensoul_pack_json"
   ```

2. Review the complete receipt and publish that exact archive with the signed-in Hraness maintainer session.

   ```sh
   ensoul_npm_cache="$(mktemp -d)"
   npm publish "$ensoul_archive" \
     --access public \
     --cache "$ensoul_npm_cache" \
     --ignore-scripts \
     --registry=https://registry.npmjs.org
   ```

Complete npm's interactive two-factor challenge. Never put an npm password, one-time code, recovery code, session cookie, or long-lived publishing token in the repository, a command argument, an environment variable, or a GitHub secret.

After bootstrap, configure npm trusted publishing for `hraness/ensoul` and `.github/workflows/npm-stage.yml`, allowing `npm stage publish` only.

## Publish later versions

1. Update `VERSION`, `package.json`, and version-pinned install text together; merge only after the required check passes.
2. Dispatch `Stage npm package` from current `main`. The workflow proves the version is new, builds and smokes one exact artifact, and submits it through npm OIDC with provenance.
3. Review and approve the staged package through npm's interactive stage flow.
4. Verify the live registry artifact against current `main` with `bun scripts/package-smoke.ts`.
5. Create and push `v<VERSION>` only after that verification. The tag workflow re-runs the tests, validates both archives, compares a canonical SHA-256 digest over each sorted package member's exact path, type, mode, size, and raw bytes, and creates an immutable GitHub Release. This binds the installed payload without depending on gzip output, tar ordering, or incidental container metadata.
6. Run one normal skills CLI install for the released tag and verify the canonical skills.sh page.

Repository immutable releases are a precondition. The tag workflow checks the setting before it creates any release.
