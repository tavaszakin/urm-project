# Hosting access and release controls

Prefer connected provider tools when sufficient; otherwise authenticated CLIs or
official APIs. Verify access with successful reads, not binary presence. Check
current help/docs before mutations. Never probe deploy hooks: GET can deploy.

## Access

- GitHub: `gh auth status`, then `gh api repos/tavaszakin/urm-project` for actual
  repository permissions. If needed, `gh auth login --hostname github.com --web`.
  Write/merge needs repo access and compliance with current branch protections.
- Vercel: install CLI with npm, then `vercel login` and `vercel whoami`. If global
  npm permissions fail, a user-owned prefix avoids sudo. Verify existing team,
  project, deployment/promotion and configuration access. `vercel link` changes a
  local association: select the verified existing project, never create a new one.
  Do not commit `.vercel` or pulled environment files.
  With the current project root setting, run provider commands from repository
  root; running from `urmwebpage/frontend` can double the configured root path.
  On this Mac the installed CLI is `~/.local/bin/vercel`; use it explicitly if
  shell PATH does not include that directory. `vercel api` supports authenticated
  reads and approved mutations. Inspect only named non-sensitive env values;
  avoid saving entire environment responses or pulling unrelated secrets.
- Render: install official CLI (`brew install render` here), run `render login`,
  inspect workspaces/services as JSON, and verify the existing service identity.
  CLI tokens stay outside the repository. Secure `RENDER_API_KEY` storage is an
  automation alternative; never request tokens in chat or commit them.
  Service/deploy reads and deploy creation work without SSH. Runtime shell access
  separately requires a registered SSH public key; CLI login does not grant it.
- Supported Vercel/Render integrations are alternatives after connection and
  allowed operations are verified. GitHub access proves neither hosting access.
- A network sandbox error can resemble invalid credentials. Retry authorized
  reads through the environment's network approval flow before replacing login.

## Snapshot before mutations

Vercel: ID/team, Git repo, production branch/environment, aliases/current domain
deployment, rollback retention, root/framework/install/build/output/Node,
ignore-build rules, Production/Preview API values and branch overrides, deployment
protection, and production domain auto-assignment behavior.

Render: ID/URL, repo/branch, live deploy SHA and retained rollback IDs, root,
build/start/Python, env groups, build filters, auto-deploy mode, health and disks.
Record exact initial automation values. Public health checks and GitHub history
cannot establish these private settings.

The current Render service was verified with root `urmwebpage`, build
`pip install -r ../requirements.txt`, start
`uvicorn main:app --host 0.0.0.0 --port 10000`, commit auto-deploy enabled, and
previews disabled. These settings have successful deploy history. Preserve
them unless an approved candidate build demonstrates a problem. The root/parent
requirements path differs from current documented root isolation; do not silently
change the root or command to resolve this uncertainty. No Python version pin is
configured; exact live interpreter version needs retained logs or SSH access.

## Controlled release

Before branch push/PR, verify GitHub AND providers cannot publish production.
Draft PRs alone are not a safety control; previews also need compatible APIs.
Keep the branch local when controls are unknown.

After production approval, pause Render auto-deploy if needed and disable Vercel
automatic production-domain assignment before merging; read back both. Keep the
tracked production branch. Deploy the exact reviewed candidate SHA to Render
before merging so no automatic frontend build can precede backend verification;
poll for a terminal state, and verify health/contracts/old-client compatibility.
Then merge and verify backend input blobs match the deployed candidate. Record
both SHAs rather than claiming they are the same revision.
Render dashboard specific-commit deploys disable auto-deploy; CLI/API behavior
differs, so inspect rather than assume the setting changed.

`vercel deploy --prod --skip-domain` creates a production build without assigning
domains. This flag does not prevent a separate automatic Git deployment, which
must be controlled before merging. Verify candidate SHA/project, Production API,
READY state, smoke checks and unchanged public aliases. Then
`vercel promote <deployment-url-or-id>` assigns the verified build to the existing
production domains. Use current CLI help/API schemas for exact provider commands.

Use previews or an isolated staging backend if available. A new paid service
requires authorization; do not repurpose production as staging. Final staged
Production builds must use the production API without test interception.

For a frontend-only release with proven backend equality, skip the Render deploy.
Use `[skip render]` in the final production commit message (including the squash
message, if used) to suppress its otherwise enabled Git auto-deploy. Verify no
Render deployment was created. Keep Vercel staging/promotion checks. This avoids
permanently changing the service's auto-deploy setting or filters.

## Recovery

Record the Vercel deployment ID/URL serving the domain and Render live/previous
deploy IDs/SHAs before releasing. Check plan/artifact retention. Vercel rollback
can restore domain routing without rebuilding. Preview-to-Production promotion
may rebuild with Production environment values; do not assume Preview values stay.

For an API regression, restore the old frontend first when practical, then use
the recorded Render rollback target. Dashboard rollback disables auto-deploy;
API rollback does not. Rollback does not undo all settings or persistent data.
Reread automation after recovery. Restore the exact original values only when
the tracked Git tip is safe; reconcile Git before reenabling failed publication.

Official references:

- [Vercel staged deploys](https://vercel.com/docs/cli/deploy#skip-domain)
- [Vercel promotion and auto-assignment](https://vercel.com/docs/deployments/promoting-a-deployment)
- [Vercel rollback](https://vercel.com/docs/deployments/rollback-production-deployment)
- [Render CLI](https://render.com/docs/cli)
- [Render deployment controls](https://render.com/docs/deploys)
- [Render rollback](https://render.com/docs/rollbacks)
- [Render root directory](https://render.com/docs/monorepo-support)
