# Completed URM rollout — 2026-10-30

The existing public site at https://urm-project-neon.vercel.app now serves the
reviewed release. No project, service, production branch, domain, runtime setting,
root, build command or start command was replaced. Original automation is restored.
See [outcome.json](outcome.json) for detailed evidence and IDs. The earlier
RELEASE.md/provenance.json remain the immutable preparation record.

| Component | Commit | Deployment |
| --- | --- | --- |
| Vercel frontend | `ddc25ad9b5e0dd184f46929c60d9031b2484940f` | `dpl_5jnMBDAB55XJsj6dZfeUGuQ2VTtE` |
| Render backend | `749e2aea572fda6d230f9b281e0701f49c2abbb3` | `dep-dbi8vlmgekts7397dp40` |

The backend uses the approved PR head, and the frontend uses PR #1's merge commit.
Their complete Git trees are identical; the SHA difference is merge metadata.

## Safeguards and checks

A read-only one-off Render job, `job-dbi8uelg1s2s73eb3jug`, successfully started
from the old successful artifact at `5483006`. It confirmed Python 3.14.3, the
working directory, package versions, and the existence of `../requirements.txt`.
This proved the recovery artifact was still retrievable before production changes.
The old deployment `dep-d8ge73poagis738r2hdg` was recorded as the rollback target;
no actual production rollback was needed or performed.

Vercel auto-assignment was set to false and reread, while the public alias stayed
on `dpl_EqLwZKfGcxfMPRaPepv9wTRroL4S` and returned HTTP 200. Render auto-deploy
was paused and reread. The backend was then deployed first, all live API and old
frontend checks passed, and only then was PR #1 merged into `main`.

The unpinned backend build selected FastAPI 0.162.0, Pydantic 2.14.2, Starlette
1.10.0 and Uvicorn 0.54.0 on Python 3.14.3. All 89 backend tests passed in an
isolated environment matching those versions. All 23 live compiler cases passed.
Live execution covered second-smallest arities 3–6, descending and equal-zero
inputs, step limits, CORS, program/trace output, addition and a raw URM program.

The staged Vercel Production build was READY with the exact merge SHA. Its
protected URL was tested with authenticated access, without changing deployment
protection or redirecting API traffic. Its JavaScript bundle matched the validated
local production bundle byte-for-byte. Direct navigation and refreshing `/`,
`/compute`, `/flow-diagram`, Simulator labels, subtitle removal, real computations,
all four second-smallest variants and exact generated diagram node counts passed.

After promotion, the same browser checks passed on the actual public domain
without authentication bypass or API overrides. No browser errors or new
application/geometry regressions were detected. Evidence:
[staged browser](staged-browser.json), [public browser](public-browser.json),
[old frontend with new API](old-frontend-live-api.json).

## Restored state and cleanup

- Render `autoDeploy: yes`, `autoDeployTrigger: commit`, branch `main` verified.
- Vercel `autoAssignCustomDomains: true`, branch `main` verified.
- Public alias verified on the new Vercel deployment; no extra Render deployment
  was triggered by restoring automation.
- Vercel's CLI generated a temporary automation-bypass credential for staging;
  it was revoked afterward. Pre-existing credentials and protection mode were
  preserved. No credential was committed or printed.
- Temporary SSH was not used. Local key files were deleted, and the user
  confirmed removal of the temporary account registration.

Existing lint errors/warnings, build-tool advisories, bundle-size warning and
diagram defects remain documented. Runtime dependencies are still unpinned.
The deployed Starlette version also emits a TestClient/httpx deprecation warning
in tests; all tests pass. These findings did not require changing the approved
application candidate.

Deployment lessons and staging-auth support are retained separately so the
approved candidate and published application remain unchanged.
