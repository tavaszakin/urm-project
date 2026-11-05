# Final approved public baseline — 2026-11-05

## Source and scope

- Approved source: annotated checkpoint `checkpoint/public-site-final-approved-baseline-2026-11-05`, resolving to `07de986a997898cbec055903832700d34b727687` on local `public-site`.
- Production base: `34115e860d079b4e6f9b69e08af1811917aad8e2` on `origin/main` (`https://github.com/tavaszakin/urm-project.git`).
- Release branch: `release/public-site-final-2026-11-05`, prepared in an isolated worktree from that production base.
- Included: the approved changes in 12 public frontend files. The resulting application source matches the checkpoint except for the existing production-only private function menu filter and diagram debug/legacy-engine guards retained from `main` (19 added and 4 changed lines across five files). The SketchV4 layout modules and backend are unchanged.
- Excluded: three unstaged edits in the source worktree: the development-only table-height experiment in `ComputePage.jsx`, related `PublicToolPages.css` styling, and inaccessible `LearnPage.jsx` wording. The source worktree was not modified.
- Also excluded: unrelated SketchV4 historical archives, local probes, generated artifacts, and research changes present on the divergent source branch. Production routing and deployment configuration from `main` remain in place.

## Deployment context and rollback

- Vercel project `prj_XVFhCNAgLhKd20scuP74q5cfalwn` (`tavaszakins-projects/urm-project`): GitHub `main`, root `urmwebpage/frontend`, Vite, Node 24.x, `autoAssignCustomDomains=true`, production fast lane enabled. `release/*` Git deployments are disabled in the retained `vercel.json`.
- Public URL: `https://urm-project-neon.vercel.app`. Existing live production deployment and frontend rollback target: `dpl_J6GfPoDcf7ykiyj68U95qpKayEuS` (source `34115e8`). The same deployment currently serves the project, neon, and Git-main aliases.
- Production `VITE_API_URL` is configured for the project. The live frontend bundle and locally built release contain `https://urm-backend.onrender.com` and no loopback URL. The retained `/compute` and `/flow-diagram` rewrites supply direct-route SPA fallback.
- Render service `srv-d7a1t14hg0os73bat3mg` (`urm-backend`): GitHub `main`, root `urmwebpage`, build `pip install -r ../requirements.txt`, start `uvicorn main:app --host 0.0.0.0 --port 10000`, auto-deploy `yes`, previews off. Live deployment `dep-dbi8vlmgekts7397dp40` at `749e2aea572fda6d230f9b281e0701f49c2abbb3` is the backend rollback reference. No backend runtime input differs from this revision; no Render deployment is needed. The production merge commit must include `[skip render]` to avoid an unnecessary automatic deployment.
- No GitHub Actions workflows, webhooks, or branch rulesets were found. The existing unrelated draft PR #2 is outside this release.

## Prepublication verification

- Clean `npm ci` and Vite production build with the production Render API base: passed (93 modules; 966.59 kB JS and 144.44 kB CSS before gzip). The pre-existing chunk-size advisory is not a release failure.
- Focused backend unittest modules: 89 passed. Backend runtime inputs are identical to the live Render SHA.
- Focused browser checks on the local production build with local API interception: Simulator starts paused; Space, Enter, Replay, seeking, 100-step continuation and stepping work; flow card waits for Generate, handles edits and stale responses, uses composition compilation, reports errors, and view radios do not regenerate the program. Production menus omit the private family and debug/geometry controls remain disabled.
- `git diff --check`: passed. Existing checkpoint verification already covered production build, focused keyboard/playback/stale-response/composition checks, public routes, and 54-program diagram geometry parity. No geometry code changed in this candidate.

The local browser check intercepted API calls to the local backend while exercising a production build; it does not establish the deployed API setting. Repeat direct routes, browser/API checks and asset checks on a staged Vercel Production build and the live public domain without interception. Record the exact staged and promoted deployment IDs and final merge SHA in the publication report.
