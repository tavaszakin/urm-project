# URM discovery and validation

Last verified during release preparation on 2026-10-30; recheck each release.

| Item | Discovery hint |
| --- | --- |
| Repository | `tavaszakin/urm-project`; verify Git remote and GitHub permissions |
| Production | Remote default was `main`; verify each provider independently |
| Public source | Local `public-site`, possibly dirty and absent on GitHub |
| Frontend | `urmwebpage/frontend`, React/Vite, committed npm lockfile |
| Backend | `urmwebpage/main.py:app`, sibling compiler/executor modules |
| Public frontend | `https://urm-project-neon.vercel.app` |
| Public backend | `https://urm-backend.onrender.com` |
| Vercel scope/project | `tavaszakins-projects` / `urm-project`; discover actual IDs |
| Vercel project ID | `prj_XVFhCNAgLhKd20scuP74q5cfalwn` |
| Vercel team ID | `team_RtEzVQJim0trlNWsaJPieDPk` |
| Render service | `srv-d7a1t14hg0os73bat3mg`; verify URL before use |
| Render workspace | `tea-d7a1ri4hg0os73b7q0b0` |

## Deployment inputs

- Root `main.py` is a different demonstration. With Render at repository root,
  build with `pip install -r requirements.txt`; start with
  `uvicorn main:app --app-dir urmwebpage --host 0.0.0.0 --port $PORT`.
  Preserve equivalent verified working settings.
- `requirements.txt` lives at repository root. Render root `urmwebpage` excludes
  it. Check the actual dependency command before changing any root.
- Current code requires Python >=3.10 and Pydantic 2. Requirements are unpinned;
  record resolved versions and retain a tested provider runtime.
- Current Vite lockfile requires Node `^20.19.0 || >=22.12.0`; inspect future
  lockfiles instead of prescribing a permanently fixed runtime.
- `src/api.js` reads build-time `VITE_API_URL`, falling back to `/api`. Vite's
  dev proxy is absent in production. Current hosting uses the HTTPS Render URL
  without trailing slash or `/api`. Check Production/Preview scopes and overrides.
- Public routes: `/`, `/compute`, `/flow-diagram`. Simulator remains `/compute`.
  `frontend/vercel.json` supplies deep-link rewrites; verify the provider root.
- CORS currently permits the public Vercel origin and Vercel preview subdomains.
  Check any custom domain and actual OPTIONS requests.
- Historical experiments are not deployment inputs. `test:sketchv4` does need
  `experiments/sketchv4/tests/`, owned-orientation `fixtures.json`/`approved.json`,
  and `frontend/.flow-layout-probes/current_harness.mjs`.
- Compare backend code to Render's live SHA, which may differ from Vercel's SHA.
  Unknown backend provenance must not be classified as frontend-only.
- The candidate `vercel.json` suppresses automatic builds of `release/*` branches
  so their previews cannot expose a new frontend to an old API. Production `main`
  remains enabled. Inspect branch rules before every release, including overlaps.

## Current checks

From `urmwebpage/frontend`:

```sh
npm ci
npm run build
npm run test:sketchv4
npm run test:second-smallest -- /tmp/urm-second-smallest
```

From `urmwebpage`:

```sh
python3 -B -m unittest test_function_kind_smoke test_second_smallest test_substitution test_minimization test_primitive_recursion_flat test_urm_encoding test_predecessor test_fixture_metrics
python3 -B -m uvicorn main:app --host 127.0.0.1 --port 8011
python3 -B scripts/smoke_live.py --base-url http://127.0.0.1:8011
```

Select unittest modules explicitly: legacy `test_all.py`/`test_api.py` contact port
8000 at import. TestClient needs `httpx` in the test environment, not necessarily
production requirements. Reuse the existing compiler smoke catalog.

Browser smoke from repo root:

```sh
node .agents/skills/deploy-public-site/scripts/smoke_frontend.mjs --url <frontend-url>
```

Playwright is optional test tooling, not an application dependency. Use
`--playwright-module /path/to/playwright/index.mjs` for isolated tooling and
`--browser /path/to/chromium` for an existing browser. For a local build with
`/api` fallback, add `--api-override http://127.0.0.1:8011`; this redirects only
inside the test browser. For deployed verification omit overrides so a wrong API
setting is caught. `--legacy` tests the old public frontend without new labels
or function kinds. Inspect selectors/contracts after UI changes rather than
weakening failing assertions.
