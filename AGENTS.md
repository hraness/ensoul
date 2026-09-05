# Contents

- `README.md` documents the public project and its evidence and privacy boundaries.
- `schema/` defines the public source-packet contract.
- `skills/` contains the installable Ensoul Agent Skill.
- `tests/` verifies the source preparation boundary.
- `STYLE.md` defines the public and reader-facing prose contract.

# Guidelines

- Follow `STYLE.md` for public documentation, README, schema descriptions, and Agent Skill prose.
- Keep `@hraness/ensoul` on npm's dual-use staged-publication path. The default workflow builds a candidate artifact only; only an explicit owner dispatch from protected current `main` may request `npm stage publish`, and the workflow must reauthorize both the current actor and triggering actor before setting up npm or minting OIDC.
- Keep only one pending stable npm candidate, require it to be newer than `dist-tags.latest`, and stage it under pinned npm's verified clean built-in `latest` default without passing `--tag`. Reject both top-level `tag` and `publishConfig.tag`; the packed manifest may contain only `publishConfig.access=public` and the canonical public npm registry, and must be independently rechecked inside the checkout-free OIDC job.
- Before a GitHub Release mutation, require the exact candidate to remain npm `latest`, cryptographically verify npm's registry signature plus one publish attestation and one SLSA v1 provenance statement, bind that provenance to the exact archive digest, source commit, Ensoul npm-stage workflow/repository/main/event identities, and reauthorize its completed owner-run attempt.
- Treat GitHub rulesets, environments, and npm trusted-publisher records as prospective bootstrap prerequisites until authenticated provider readback proves them live. The intended zero-routine-approval policy assumes the current owner-only repository; before adding write collaborators, add a provider-enforced release-workflow path restriction or human review boundary.

<!-- hra-local-efficiency:start -->
- Treat the user's request to change this repository as standing authorization for routine task-owned commits, pushes, pull requests, merges, releases, deployments, and production verification after the repository's required validation, review, identity, and rollout gates pass. Do not ask for another confirmation at each delivery step.
- Use the repository's documented delivery workflow and preserve every runtime-enforced approval, branch protection, environment rule, safety policy, and final gate. Ask for user input only when delivery needs a material product decision, missing credentials or authority, an irreversibly destructive action outside task scope, or resolution of a release failure that cannot be handled safely and autonomously.
- Prefer short-lived repository workload identities such as OIDC trusted publishing, GitHub Apps, and narrowly scoped machine identities. Do not add long-lived personal tokens, weaken two-factor authentication, or bypass provider controls to eliminate an interactive prompt. Batch unavoidable human-gated production promotions into intentional stable releases while agents publish validated prerelease or beta channels through workload identities when the repository supports them.
- Preserve useful reasoning fan-out, but avoid unnecessary checkout fan-out. Prefer subagents in the current task for bounded research, review, diagnosis, and focused checks when they can safely share one working tree; create a separate task or worktree only for independently deliverable divergent edits, an isolated verification tree, or a different execution environment.
- Give each expensive focused validation command and external wait one owner. The integration owner reviews that evidence and runs the repository-required aggregate or final gate once after convergence. Reuse evidence only for the exact Git tree, command, lockfiles, toolchain, relevant environment, and validity period, and never to skip a required final integration, merge, release, deployment, or production-verification gate.
- On Hraness development machines, use `$hra-local-efficiency` and the installed host scheduler for heavyweight top-level commands when available. Keep ordinary work in the compute lane; give authenticated browser/dev-server/Chromium work one `browser-auth` owner and Mac-only validation one `mac-native` owner.
- When a CI or policy gate scans complete Git history, check out the exact governed SHA and fetch only the fully qualified governed refs before scanning. Preserve the complete-history gate and reject unexpected refs instead of importing unrelated concurrent heads.
- At closeout, record applicable branch, PR, check, merge, release, deployment, and production evidence. Archive only conclusively finished tasks, never from silence alone, and reclaim only freshly revalidated clean merged worktrees through the guarded exact-path flow.
<!-- hra-local-efficiency:end -->
