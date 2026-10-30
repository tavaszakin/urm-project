---
name: deploy-public-site
description: Prepare, validate, and publish this URM repository's public website to its existing Vercel project and Render service. Use for requests to publish the latest URM website, frontend-only releases, or release rollback.
---

# Deploy the URM public website

Preserve existing hosting projects, production branches, domains, API address,
and working trees. Read [project.md](references/project.md) for project-specific
checks and [hosting.md](references/hosting.md) for access and provider operations.
These references are discovery hints, not proof of current deployment settings.

## Prepare a reviewable release

1. Inspect applicable instructions, Git status/worktrees/remotes and branch
   ancestry. Resolve intended source from the request and recent diffs; do not
   assume the current checkout contains the public website. Preserve dirty edits.
2. Verify authenticated reads of GitHub, Vercel and Render. Record project/service
   IDs, production branch tracking, domains/aliases, live deployment IDs/SHAs,
   retained rollback builds, runtime/build/API settings, and exact automation
   values. GitHub deployment history alone does not establish the live version.
   Continue local preparation if provider authentication is missing.
3. Fetch production without resetting local branches. Create an isolated release
   worktree from the latest remote production tip. Incorporate intended public
   application changes and dirty edits without modifying their source worktree.
   Include routing and required test fixtures; exclude unrelated experiments and
   historical research. Compare the resulting tree to production and the source.
4. Inspect current scripts, dependencies and runtime requirements before choosing
   preflight commands. Run a clean frontend install/build, backend contract and
   execution tests, layout regressions, and second-smallest arities 3–6. Reuse
   `urmwebpage/scripts/smoke_live.py` for the public compiler catalog. Report
   existing defects and dependency findings; do not silently upgrade or redesign.
5. Run `scripts/release_inventory.py --base <production-sha>
   --backend-base <render-live-sha>`. Inspect runtime/API/import changes as well
   as its conservative classification. Omitting the Render SHA leaves backend
   redeployment unknown. Skip Render for frontend-only changes only after proving
   the candidate backend matches the live backend and live API checks pass.
6. Test old public frontend against new backend, then new frontend against new
   backend. `scripts/smoke_frontend.mjs` covers direct routes, refreshes, execution
   and flow SVGs; `--legacy` supports the old frontend. API overrides affect only
   the test browser and must be disclosed. Use staging when feasible. Local SPA
   fallback does not prove Vercel rewrites; repeat on the staged provider build.
7. Record source/base/candidate SHAs, included dirty changes, excluded paths,
   tests, hosting IDs/live SHAs, API/runtime settings, automation snapshot and
   rollback targets under `docs/releases/`. Never commit credentials, pulled env
   files or `.vercel`. Commit only reviewed candidate paths.
8. Before pushing or opening a PR, inspect GitHub workflows/hooks AND provider
   tracking/automation to prove it cannot publish production. A draft PR is not
   a deployment control. Preview builds also need a compatible backend. If safety
   cannot be established, keep the branch local and prepare a PR body instead.
   Otherwise push the release branch and open a draft PR into production.

## Approve, publish and verify

Present the exact candidate/PR, checks, issues, rollback targets and intended
production mutations. Obtain final approval for production settings changes,
merge, live backend deployment and frontend promotion unless those exact actions
are already authorized. Invoking the skill requests preparation; it does not
waive production approval. Complete independent preparation before asking.

After approval, execute the approved actions rather than ending at instructions:

1. Reverify candidate SHA, production tip, provider identities and automation.
   Reconcile material drift before publishing. Complete user-required runtime
   and recovery gates before changing production settings; a successful deploy
   record alone does not prove its rollback artifact is still retrievable.
2. Prevent simultaneous publication using verified provider controls and record
   every changed value. Keep branches/domains intact. Ensure merging cannot
   expose the frontend before backend checks pass.
3. Deploy the reviewed candidate SHA to the existing Render service if needed,
   while the old frontend remains public. Poll to a terminal state. Check
   health, CORS, compiler contract, execution and old-client compatibility. On
   failure, stop frontend publication and present/use the approved rollback.
4. Merge the reviewed PR only after backend checks pass. Verify the merged tree's
   backend inputs match the deployed candidate, recording both SHAs. Create or
   select the resulting Vercel production-target build with domain assignment skipped and
   the Production API/environment. Verify its SHA, READY state, actual routes,
   browser/API checks and unchanged public aliases. Never promote a staging-API
   build. Promote only this verified deployment in the existing project.
5. Check the actual public domain, reloads, Simulator, execution and diagrams;
   record deployed IDs/SHAs and API destination. Restore and reread the original
   automation values only when the tracked Git tip is safe. After rollback,
   reconcile Git first; document any intentional pause instead of republishing
   the failed revision.

For rollback, use hosting.md. Restore the old frontend before rolling back an
API it depends on. Hosting rollback does not revert Git. After ambiguous mutation
responses, inspect whether the action happened before retrying it.
