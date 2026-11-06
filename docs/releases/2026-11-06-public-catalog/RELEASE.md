# Public catalog update — 2026-11-06

## Reviewed source and scope

- Production base: `d931d3e5d6f29b23ddc1cdee41eb9168a3eb93f2` on `origin/main`.
- Source worktree: `/Users/denizakin/urmwebpage-public`, branch `public-site`,
  HEAD `07de986a997898cbec055903832700d34b727687`, with unrelated dirty edits.
- Reviewed application commit: `2ba684d29827c83b3fb98ffbaf53b43b47f4f4a7`.
- Release branch/worktree: `release/public-catalog-2026-11-06` in
  `/Users/denizakin/urm-project/.worktrees/release-public-catalog-2026-11-06`,
  created from the fetched production tip. This record is the only additional
  file beyond the application commit.
- `functionMetadata.js`: mark Geometric Sum and Divisor Count as not publicly
  visible using the existing production menu filter; retain their definitions,
  ordering, fixtures, compiler support, and regression tests. Add the existing
  Modulo 3 metadata after truncated subtraction in the arithmetic catalog.
- `urm_macros.py`: copy the source worktree's existing 13-instruction Modulo 3
  definition verbatim. `compiler.py`: register its unary arity, compiler dispatch,
  and function-kind contract. `fixture_kinds.py`: register its representative spec.
  `test_modulo_3.py`: verify remainder cycles, termination, API output, and traces.
- Exclude the other three branching examples, all experimental SketchV4/V5
  layouts, local harness/diagnostic changes, table styling, and Learn-page edits.
  Source file hashes confirm the dirty worktree was preserved.
- Production layout modules, diagram adapter, pages/components, execution engine,
  requirements, routing, and hosting configuration are identical to production.
  All 24 existing compiled-program cases are instruction-for-instruction identical.

## Verification before publication

- Clean `npm ci`, Node 24.14.1, locked Vite 8.0.3; production build with
  `VITE_API_URL=https://urm-backend.onrender.com`: passed.
- 91 focused backend tests: passed, including Modulo 3 for every input 0–30,
  contract/catalog agreement, all Characteristic Function relations, execution,
  composition, minimization, primitive recursion, and internal order statistics.
- `smoke_live.py` against the candidate backend on port 8012: all 24 cases compile.
  The unchanged production backend passed all 23 prior catalog cases.
- 84 SketchV4 tests: passed, including exact geometry/SVG/decision parity for the
  approved 54-program corpus, with Geometric Sum and Divisor Count retained.
- `test:second-smallest`: passed for arities 3–6 and characteristic divides.
  Existing private-family geometry diagnostics are unchanged.
- Production-build browser checks: exact 15-program catalog on both public
  selectors; hidden programs absent from nested menus; all characteristic
  relations and requested retained functions present; arithmetic outputs and
  trace playback pass. Modulo 3 executes on both pages and renders 15 SVG nodes
  through the ordinary `sketchV4` plan (`sketchV4Active=true`) with no query,
  global override, geometry fixture, or alternate renderer.
- Old public frontend against the candidate backend: passed. Local compatibility
  checks intercepted API calls to the isolated backend; this does not establish
  the deployed API. Staged and public checks must use the production API directly.
- `release_inventory.py` identifies exactly the three backend registration/definition
  files as changed runtime inputs relative to live Render; a backend deployment
  is required. `git diff --check` passes.
- Existing advisories remain: Vite's large JS chunk and Pydantic's `trace` field
  shadow warning. No dependency, layout, or execution changes address them.

## Verified hosting and rollback snapshot

- GitHub: `tavaszakin/urm-project`, default/production branch `main`, authenticated
  admin/push access. No workflows, active local hooks, GitHub webhooks, or rulesets.
  Existing unrelated draft PR #2 is excluded.
- Vercel: `tavaszakins-projects/urm-project`, project
  `prj_XVFhCNAgLhKd20scuP74q5cfalwn`, team `team_RtEzVQJim0trlNWsaJPieDPk`.
  GitHub `main`, root `urmwebpage/frontend`, Vite, Node 24.x, default build/install/output,
  `autoAssignCustomDomains=true`, `productionDeploymentsFastLane=true`.
  `release/*` Git deployments remain disabled by the existing `vercel.json`.
  Authentication protection is `all_except_custom_domains`; preserve it.
- The existing sole environment variable is `VITE_API_URL`, verified through the
  API as `https://urm-backend.onrender.com` for Production, Preview, and Development,
  without a branch override. No environment value changes are needed.
- Public URL: `https://urm-project-neon.vercel.app`. The actual public alias and
  production target point to `dpl_FeacZFcHUyWEWT63RWVY2LqzAPrB`, source `d931d3e`,
  URL `https://urm-project-6u6q0zphd-tavaszakins-projects.vercel.app`.
  Retain this READY deployment as the frontend rollback target.
- Render: `srv-d7a1t14hg0os73bat3mg`, workspace `tea-d7a1ri4hg0os73b7q0b0`,
  `https://urm-backend.onrender.com`, GitHub `main`, root `urmwebpage`,
  build `pip install -r ../requirements.txt`, start
  `uvicorn main:app --host 0.0.0.0 --port 10000`, starter plan, one instance,
  auto-deploy `yes`, trigger `commit`, previews `off`, maintenance disabled.
  No Python pin or env-group change is introduced.
- Render live/rollback deployment: `dep-dbi8vlmgekts7397dp40`, SHA
  `749e2aea572fda6d230f9b281e0701f49c2abbb3`.
- An erroneous environment-read CLI invocation created a separate temporary Vercel
  project `urm-catalog-print-api`; it was deleted and its subsequent GET returned
  404. The actual URM public alias remained on the original deployment.

## Authorized publication sequence

The user explicitly authorized commit, push, merge, and immediate deployment for
these catalog changes; no additional conversational approval is required.

1. Push only the isolated release branch and open a draft PR into `main`.
   Provider tracking and the release-branch rule prevent production publication.
2. Deploy the reviewed release SHA to the existing Render service. Wait for `live`,
   then verify compiler contract, Modulo 3 execution/traces, CORS, and the old
   public frontend without API interception.
3. Set Vercel `autoAssignCustomDomains=false` and read it back before merging.
   Merge only the reviewed PR and verify its runtime inputs equal deployed Render.
   Include `[skip render]` in the production squash message to avoid redeploying
   the already verified identical backend on merge; leave Render automation intact.
4. Select the resulting READY Vercel Production build for the exact merged SHA
   while public aliases still point to the old deployment. Verify actual provider
   routes, API destination, selectors, execution, and ordinary SketchV4 rendering.
   Authenticated Vercel CLI transport may access the protected staging frontend;
   API requests must reach the unchanged production Render URL directly.
5. Promote only that verified deployment in the existing Vercel project. Verify the
   actual public domain, reloads, both selectors, Modulo 3 execution and diagrams.
   Restore and reread `autoAssignCustomDomains=true`; reread Render automation.

Record final deployment IDs and merged SHA in the publication report. If rollback
is required, restore the recorded frontend first, then the recorded Render build;
reconcile Git before restoring any paused publication automation.
