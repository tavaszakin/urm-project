# Successful old-HTML publication

Report date: 2026-11-02. The three-page public site is live at
https://urm-project-neon.vercel.app. Preparation is preserved in RELEASE.md and
provenance.json; this outcome is a separate documentation commit on the release
branch, so recording it does not trigger another production release.

| Revision | SHA / deployment |
| --- | --- |
| Approved design source | `da9c400edf584f18b7f0e1d66e740aa993432ae5` |
| Reviewed candidate | `3c63d532eb026558c0d134aa6f7ce7d7228b87c8` |
| Deployed production main | `34115e860d079b4e6f9b69e08af1811917aad8e2` |
| Vercel | `dpl_J6GfPoDcf7ykiyj68U95qpKayEuS` |
| Unchanged Render source | `749e2aea572fda6d230f9b281e0701f49c2abbb3` |
| Unchanged Render deployment | `dep-dbi8vlmgekts7397dp40` |

PR #4 was merged with `[skip render]` after the full local preflight and live API
checks. Its complete Git tree matches the reviewed candidate. Vercel's automatic
domain assignment was temporarily paused; its exact READY Production build was
then verified while the actual public domain still served the old deployment.
The staged JS/CSS matched the validated local assets byte-for-byte. The previous
public artifact was retrieved successfully as a rollback check.

The authenticated staged browser suite passed 22 checks with the real production
API and no API interception. A temporary project bypass was revoked immediately
after testing; original deployment protection was preserved. Only then was that
verified build promoted. The actual public domain passed the same 22 checks
without bypass or API interception. Five additional live checks covered modified
new-tab links, browser back/forward, tool navigation, rendered execution trace and
program listing, the 293-instruction / 295-node divisor-count diagram, and readable
mobile dark mode. Render was not deployed or reconfigured. Original Vercel
assignment `true`, Render auto-deploy `yes`/`commit`, main tracking, API destination
and protection settings were reread. Final source-worktree hashes/statuses match
the pre-release snapshot, including all six dirty files.

Only `/`, `/compute` and `/flow-diagram` are public application pages. Unpublished
routes/viewers are blocked or return only the homepage. The existing private-family
filter is unchanged in the main and nested menus: Median of 3 and second-smallest
of 4/5/6 are not offered. Query attempts do not select them. Compiler implementations,
direct APIs and development menus are preserved. Existing comparison/collector,
SketchV3 override, audit and port-debug entry points are now development-only;
production continues to use the approved SketchV4 renderer.

Known findings remain: 17 build/development dependency advisories (zero production
advisories), existing bundle and backend-test warnings, and existing offline
geometry diagnostics. Visual inspection also confirmed the divisor-count definition
uses a pre-existing KaTeX-error fallback. Its DOM is identical in the approved
design source and live site (unchanged-notation-fallback.json), so no notation fix
was added during deployment. Other inspected KaTeX metrics/alignment and exact SVG
parity checks passed. No new application or renderer regression was detected.

## Rollback

The retained, retrieved previous frontend is
`dpl_RDxHnN9RgumBUzqrkG7V7N5L5HRy` / production `cdeffaf`.
If recovery is needed, pause automatic production-domain assignment in the existing
Vercel project, then use its supported command from the linked release checkout:

```sh
/Users/denizakin/.local/bin/vercel rollback dpl_RDxHnN9RgumBUzqrkG7V7N5L5HRy --scope tavaszakins-projects --yes
```

Verify the actual public alias and routes after rollback. Hosting rollback does
not revert Git: prepare the reviewed inverse frontend release on an isolated
worktree from current main (no reset/force-push), with `[skip render]` in the final
production commit. Keep automatic domain assignment paused until Git has been
reconciled, then restore the original value. No backend rollback is needed for
this frontend-only release. No rollback was required or performed here.
