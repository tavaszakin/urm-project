# URM public release prepared 2026-10-30

Prepared, not deployed. See [provenance.json](provenance.json) for verified
hosting IDs, configuration, release/source commits and rollback targets.

## Candidate scope

The release starts at freshly fetched remote `main` (`5483006`) and copies the
public application from local `public-site` (`2559765`), including all six dirty
Simulator edits. Source worktrees remain unchanged. It also includes local
`main`'s `/compute` and `/flow-diagram` rewrites, the repository deployment skill,
and regression fixtures required by the existing test commands.

Historical research archives, unrelated worktree experiments, diagnostic skills,
and generated comparison/screenshots are excluded. Application source files were
compared byte-for-byte with the public source; no intended application mismatch
was found. Runtime dependency files were preserved.

`vercel.json` disables automatic Git builds for `release/*` branches. This keeps
PR previews from reaching the outdated production API. `main` stays enabled.
Vercel and Render both track `main`; Render previews are off. GitHub has no
Actions workflows or repository webhooks. These facts support a release-branch
push/draft PR without production publication. Recheck before pushing/merging.

## Validation

- Clean npm lockfile installation and production build passed. A second build
  verified the actual production API URL is bundled.
- 89 backend tests passed, including contract, second-smallest, substitution,
  recursion, minimization, encoding and predecessor checks.
- 84 layout tests passed, including the approved 54-program corpus.
- Backend and layout tests also passed from an export of committed files, with
  no ignored worktree helper dependencies.
- Existing `scripts/smoke_live.py` compiled all 23 representative public cases
  (20 canonical menu kinds) against the candidate backend.
- Existing second-smallest frontend checks passed for arities 3–6, program/CFG
  structure and generated SVGs.
- [Candidate browser evidence](candidate-browser.json): direct `/`, `/compute`,
  `/flow-diagram`, refreshes, Simulator labels, removed subtitle, addition,
  bounded subtraction, all four second-smallest computations, and generated flow
  SVGs with exact expected node counts. Real browser CORS/API requests, no API
  interception, no browser errors.
- [Legacy browser evidence](legacy-browser.json): the unchanged public frontend
  successfully ran addition and subtraction against the candidate API through
  browser-only request redirection. Production servers were not changed.
- Skill schema, JS syntax and inventory behavior passed. Inventory cases include
  unknown live SHA, clean tree, frontend-only edit, dirty backend and untracked
  dependency changes. The skill keeps final production approval explicit.

Pre-existing findings remain visible: ESLint reports 66 errors and 11 warnings;
npm reports 11 build/development dependency advisories (8 high, 2 moderate,
1 low), and zero production dependency advisories. The diagram checks report
existing crossings, overlaps and attachment defects; successful generation does
not imply clean geometry. No dependency upgrades or layout redesign were made.
The build also reports the existing large-bundle warning.

## Confirmed hosting and remaining checks

Vercel uses the existing `urm-project` project, frontend root, Vite and Node 24.x.
Production/Preview/Development share `VITE_API_URL=https://urm-backend.onrender.com`
without branch overrides. Production-domain auto-assignment is currently true.

Render uses existing `urm-backend`, root `urmwebpage`, build
`pip install -r ../requirements.txt`, start
`uvicorn main:app --host 0.0.0.0 --port 10000`, commit auto-deploy on `main`, and
previews off. No environment variables/Python pin are configured. Keep these
working commands. The parent-relative requirements path conflicts with current
root-isolation documentation; the approved candidate build must verify it.
If that build fails, do not change the root or runtime without a concrete review.

CLI authentication/read access is confirmed for GitHub, Vercel and Render.
Render SSH requires a registered public key and was refused; no key was added.
Exact live interpreter version remains unknown, although live source already
requires Python >=3.10 and Pydantic 2, as does this candidate. Tests used Python
3.14.3, FastAPI 0.135.3, Pydantic 2.12.5 and Uvicorn 0.43.0 locally. Check the
approved Render build logs for the actual runtime and resolved dependencies.

Vercel reports retained READY rollback candidates. Render lists the active and
previous deploys but does not expose artifact availability in returned metadata;
verify rollback retention immediately before the live change. An old-SHA rebuild
is a fallback, with the caveat that Python requirements are unpinned.

## Exact proposed production actions: approval required

1. Reverify PR head, remote `main`, domains/live IDs and automation values. Record
   the active Vercel and Render deploys as rollback targets.
2. Set Render auto-deploy from `yes` to `no`, and Vercel
   `autoAssignCustomDomains` from `true` to `false`; read back both. Keep project,
   service, domains, branch, root, runtime, build and startup settings intact.
3. Deploy the reviewed PR head SHA to `srv-d7a1t14hg0os73bat3mg` using a specific
   commit. Keep the old frontend public. Wait for live status; check the build
   log/runtime, health, actual CORS, all public compiler kinds, second-smallest
   execution and the old frontend. Stop if any check fails.
4. Merge the reviewed PR into `main` only after the backend passes. Record the
   resulting production SHA and verify its backend input blobs match the deployed
   candidate. Render's tracked branch remains `main`, despite this one specific
   candidate-SHA deployment.
5. Inspect the resulting staged Vercel Production build. If no build is created,
   create one from the exact merged checkout with `--prod --skip-domain`, using
   the existing project IDs. Check READY state, Production API destination, direct
   routes/reloads, computations and diagrams without browser interception. Verify
   the public domain still points at the old deployment.
6. Promote only the verified staged build in the existing Vercel project. Verify
   the actual public domain, API calls, Simulator labels and diagrams.
7. Restore Render auto-deploy `yes` and Vercel auto-assignment `true` only after
   checking the tracked branch contains the successful release. Read back both
   settings and record final frontend/backend SHAs and deployment IDs.

No step above has been executed by release preparation. The PR is a draft and
must not be merged before approval. A failure stops subsequent publication.
If rollback is needed, present/use the approved rollback option: Vercel target
`dpl_EqLwZKfGcxfMPRaPepv9wTRroL4S`; Render target
`dep-d8ge73poagis738r2hdg` subject to artifact availability. Restore the old
frontend before an API rollback when practical. Reconcile Git before restoring
automation that could redeploy a failed revision.

## Future releases

Open this repository on a branch containing the skill and invoke
`$deploy-public-site` or ask to publish the latest URM website. Repository-local
skill discovery is documented in [official OpenAI guidance](https://learn.chatgpt.com/docs/build-skills).
The skill prepares, validates and reviews, asks once for the concrete production
actions, then executes and verifies those authorized actions.

Frontend-only releases prove backend equality against the live Render SHA, test
the live API, and use `[skip render]` in the final production commit message to
avoid an unnecessary backend deployment while preserving Render's automation.
