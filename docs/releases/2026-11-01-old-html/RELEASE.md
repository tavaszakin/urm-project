# Approved old-HTML public release — 2026-11-01

Prepared on an isolated worktree from production `cdeffaf`, using approved design
source `da9c400` (Chunks 1–7). The design and development worktrees remain intact,
including the six pre-existing uncommitted label/subtitle edits. Production
already includes those edits; none were separately copied or committed here.

## Public scope

Only `/`, `/compute`, and `/flow-diagram` are public application routes. Existing
route allowlists and Vercel deep-link rewrites are unchanged. The build exports
one index document, two static icons, and the bundled CSS/JavaScript. Development
viewers, harnesses, research artifacts and unpublished routes are not exported.

The seven visual commits restore document alignment, native heading/serif text,
8px margins and ordinary navigation. The homepage uses a native ordered list.
Shared controls use black light-mode text, readable dark-mode text, title-case
labels and native dropdown/button paint, preserving sizing, numeric-input paint,
KaTeX metrics and the panel's arrangement.

Production's existing `publicVisible:false` filtering remains intact. Median of
three (`second_smallest_3`) and second-smallest arities 4/5/6 are absent from both
main selectors and all nested composition/recursion/minimization menus. The
metadata declares no aliases for that family. There is no supported query/hash
or persisted-spec direct selector; tested query attempts leave successor active.
Underlying compiler implementations, direct APIs and development menus remain
unchanged. No development registry was synchronized over the public filters.

An existing boundary defect was discovered during inspection: comparison and
geometry collection/debug query controls were available in production. This
release adds only development-build guards to those entry points. Normal
production selection stays on SketchV4; CFG, labels, placement, routing, fit and
scroll algorithms are unchanged. This is a scope restriction, not a new design.

## Validation completed before publication

- Clean `npm ci`, production-API build, 89 backend tests, 84 layout tests, and
  existing offline arity-3–6/CFG/SVG checks passed.
- All 23 existing compiler catalog cases passed against the unchanged live API.
- Actual old public frontend and new local production build passed browser
  execution, trace/program output, playback, step/seek, short and complex flow
  rendering, fit/scroll, direct routes/reloads and menu restrictions. The new
  build also passed desktop/mobile themes, visual text/layout checks, debug-entry
  restrictions and unpublished-route checks. These checks used the real API
  without interception. Local fallback is not evidence of Vercel rewrites;
  provider staging and live checks remain mandatory.
- Visual screenshots were inspected. 26 additional parity cases matched control
  and KaTeX metrics plus exact SVG content/viewBox/dimensions against the approved
  design. The same restricted option catalog was applied in the source test
  browser before comparing intrinsic dropdown widths. For SVG parity only, both
  test browsers received identical compiler fixtures because the design server's
  local backend was stopped. This interception is not used for release smoke.
- 47 compiler/runtime/layout/filter/route files are byte-for-byte unchanged from
  production. Inventory proves no backend inputs changed relative to Render's
  actual live SHA `749e2ae`; live build logs verify its package/runtime versions.

Existing findings: 17 build/development dependency advisories (8 high, 8 moderate,
1 low), zero production dependency advisories, large-bundle warning, known
renderer diagnostics in offline tests, Starlette/httpx test deprecation and the
existing `ExecutionResponse.trace` warning. No upgrades or algorithm fixes were
included. A transient headless-browser start and a source-side API DNS failure
were test-environment issues; the completed browser suites passed.

## Controlled publication and recovery

See `provenance.json` for verified provider IDs, exact original automation,
source/live SHAs, API/runtime settings and rollback targets. Render is unchanged;
use `[skip render]` in the final production commit. Preserve the existing projects,
main branches, domains, protection mode, build commands and runtimes.

After a final drift check, create the release PR; temporarily turn Vercel domain
auto-assignment off and reread it. Merge the exact reviewed candidate, inspect its
Production build, and test its protected staged URL using only a temporary project
bypass. Verify the real public domain still serves the old artifact. Promote only
the verified READY build, test the actual domain, revoke the newly created bypass,
and restore automatic domain assignment only when the successful main tip is safe.

Frontend rollback target: `dpl_RDxHnN9RgumBUzqrkG7V7N5L5HRy`, the READY public build
at production `cdeffaf`. Use Vercel rollback to that deployment if live checks fail.
Hosting rollback does not revert Git: keep domain auto-assignment paused while
preparing a reviewed inverse of this frontend release on main, using `[skip render]`,
then restore automation once Git is safe. Render stays on
`dep-dbi8vlmgekts7397dp40` / `749e2ae` throughout this frontend-only release.
