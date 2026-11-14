# Official SketchV5 production integration — 14 November 2026

## Before release

Verified public URL: https://urm-project-neon.vercel.app/ . Vercel CLI identified
READY production deployment `dpl_9XaPqMZJicFH7XJknJQostZF1q97`, also identified by
GitHub production deployment 7792650048, source `main` commit
`7978b77f50f3af0fcc61cf0c37c7403c59dfde43`. Live HTML loaded
`/assets/index-tKqH2Muo.js` and `/assets/index-DRHyM9fo.css`.
The browser's actual rendered plan was `sketchV4`; see `before-browser.json` and
before screenshots. Source path:
`FlowDiagramBetaPage.jsx` → `BetaFlowDiagram` → `computePrimaryLayoutPlan` →
`buildSketchV4LayoutPlan` → `layout/sketchv4/pipeline.js:buildLayout`.
`selectedPrimaryLayoutEngine` returned V4 unconditionally in production.
The V4 invocation passed `orientationSource: "v4Assigned"`, empty pins,
`diagnostics: true`, and TEXTBOOK_LAYOUT body dimensions with setup/ordinary
pitches 54/82, branchRayDistance 126 and clearance 16; no collapse rewrite.
Development supported explicit V3 query/global overrides; the production build
did not. No production environment or feature flag selected V5.

The production tip already contains the `gcd` dropdown label and corrected
`f(x) = x mod 3` notation. The separate GCD release worktree and the divergent,
dirty main/research/public-site worktrees were preserved. This release starts
from origin/main in its own worktree; no registry, compiler, execution engine,
backend, dependency lockfile, routing, or hosting setting changes are included.

## Authoritative identity and packaging

Canonical research entry:
`/Users/denizakin/urmwebpage-public/urmwebpage/frontend/src/layout/sketchv5/pipeline.js:buildLayout`.
Production entry: `urmwebpage/frontend/src/layout/sketchv5/pipeline.js`.
SHA-256: `871bf84957a799fd0eab019e024b557787a79a12980e7a6311eb2d0e2bb53a7b`.
Existing official display adapter: `layout/sketchv5/display.js:buildLayoutPlan`.
SHA-256: `353486c66507bc77e7363dccc240f195c3232be553afbfdad85bdd1dfc38bb23`.

`source-identity.json` lists every actual file hash in the complete 12-module
static relative-import closure. All 12 match the canonical working source and
five archived captures byte for byte: November 14 rulebook audit and Program
Family Atlas, constructible families, shared-exit search cycles, reusable enclosure
profiles. See `baseline-comparisons.json`. Five existing V4 support modules are
already identical and reused. Seven untracked official source modules are promoted
unchanged into the production checkout; no separate algorithm implementation is
written. The existing dirty public-site component is NOT copied. No V6 or V5
experimental source is included. Constructor-only closure: 10 files; display/replay
adaptation adds two. Research files and captures are read only.

Defaults are unchanged: START 48×18; diamond 82×46; ordinary bodies and terminal
88×30; ordinary pitch 82, setup pitch 54, clearance 16, branch angle 33 degrees;
reach max(80,182.7×0.78^depth). No orientation override is passed.

Input follows the official ordinary-terminal CFG: clone instructions, redirect
outside/invalid explicit jump targets to raw length n, append ordinary Z(0) at n,
retain typed NO/YES identities (even equal destinations), remove synthetic terminal
fallthrough and legacy HALT. Rendering maps only that internal terminal ID to
`halt`, labels it HALT, and retains its ordinary action rectangle. This does not
change execution programs or register conventions.

The unchanged scheduler uses first placement, NO first and deferred YES LIFO;
orientation is held on commitment. Fresh candidates use the source's structural
orientation and ordered depth/width reach offers. Existing-target connections use
the source templates and stable eight-bucket ranking: legal independent direct,
noncorridor unused/used, shared noncorridor, corridor unused/used/shared, illegal.
No earlier body or committed route moves. Hard checks are the original
`validateExtension`, `validateConnection` and incident attachment validators:
finite bodies/segments, legal ports and branch rays, body/body, body/edge,
edge/body and edge/edge contacts; shared terminal suffixes use the existing rule.
Preferred spacing remains a warning. Status is complete only with full CFG
coverage and no issue; fatal geometry gives `failed`, support/coverage issues
`unsupported`. Both preserve their actual committed prefix.

## Production changes

- `urmwebpage/frontend/src/components/BetaFlowDiagram.jsx`: primary dispatch calls
  the official display adapter using existing metadata for labels/dimensions;
  removes constructor-selection overrides; exposes constructor/status attributes
  for verification; shows a short status for stopped/unsupported prefixes; updates
  the optional comparison title and geometry-report helper to V5. Viewer controls
  and SVG painting are retained. Exporting the existing renderer supports tests.
- Added unchanged `src/layout/sketchv5/{pipeline,structure,connections,validation,display}.js`
  and `src/layout/sketchv4/{constructionHistory,displayGeometry}.js` under frontend.
- Added three verification inputs/scripts under frontend/scripts and this release
  evidence directory. No mathematical/geometric policy edit.

All ordinary flow consumers share BetaFlowDiagram. The s-m-n original and
specialized panels pass their existing programs to it with comparison disabled,
so both now inherit V5 with unchanged specialization semantics. `/smn` and other
specialized routes remain outside App.jsx's public route allowlist; the only
public application routes are `/`, `/compute`, `/flow-diagram`. There is no public
legacy constructor route. Legacy helpers/reference comparison remain in source;
the optional tuned comparison is development-only, not a production fallback.

## Equivalence and browser evidence

`equivalence-results.json`: 72 fixtures passed exact data comparison against the
unchanged November 14 archived constructor: 53 complete, 18 failed, 1 unsupported.
This includes straight, fanin-4, fanin-width-tower, P_3_2 shared-exit search cycle,
native/public GCD, ordinary-m6-compact-and-sharing, P_5_4 stopped and in-02-minimal
unsupported, plus all 25 previously captured public compiler cases.

Comparison covers CFG nodes/typed edges, roles, coverage/status/issues/failure,
positions/boxes/orientations, segments/ports/attachments, bounds and construction
events. Maps/Sets are represented explicitly for cross-module data comparison;
function identities are omitted because independently imported closures differ.
No numeric tolerance or geometric normalization is used. Every committed
extension and connection is replayed through its unchanged hard validator.
The production adapter's history matches reference history exactly, including
all candidate/selection information present there. Production node positions
and routes match reference, with only terminal ID remapping and existing branch
label/display decoration. Server-rendered SVG checks cover every returned node
and route, constructor identity and finite coordinates.

Production build passed with existing production API URL
`https://urm-backend.onrender.com`. Dependencies reuse installed lockfile-identical
packages; no claim of a fresh npm ci. Vite reports its existing large-chunk advisory.
`local-browser.json`: Chrome exercised all 16 actual dropdown defaults against the
real production API, no interception; all complete under V5. Compared exact nodes,
routes, coverage, bounds and actual painted SVG polyline coordinates to the
reference. Fit/scroll, selections, GCD(12,8)=4, compute Next playback, exact gcd label
and rendered Modulo 3 notation passed without browser errors. A legacy query is
present deliberately to verify it cannot select another constructor. Full-page
before and local-after screenshots include GCD and Modulo 3; additional V5 captures
include successor, exponentiation and bounded subtraction. Tests establish these
finite cases, not universal constructor completion.

Reproduce from frontend:

```
node scripts/official-v5-equivalence.mjs /absolute/path/to/archived/source/frontend
VITE_API_URL=https://urm-backend.onrender.com npm run build
npm run preview -- --host 127.0.0.1 --port 5196
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/official-v5-browser.mjs http://127.0.0.1:5196 local
```

Without the optional reference argument, the equivalence script verifies the
packaged closure hashes and adapter invariants; the independent archive comparison
in this release used the explicit reference argument. Browser QA requires locally
available Playwright and Chrome (CHROME_PATH can override the executable).

## Deployment record

Merged PR #8 using the existing GitHub main → Vercel production workflow.
Production commit: `c8c7ec65a5e0fdff6be5d80d6706ab75181375e3`.
Vercel deployment: `dpl_5bMbZz6wh7M7j9gCZRFzwFWYe5M7`, READY;
GitHub production deployment 7793185118 reports success for this exact commit.
The public alias points to `urm-project-buzhtxgn7-tavaszakins-projects.vercel.app`.
The merged tree exactly matched the tested release commit `c9119ac2dd76267ef3962bb737e77e12c6a783a4`.
No provider setting or environment change was made; `[skip render]` was retained.

The public HTML, JS and CSS were downloaded after deployment and are byte-identical
to the tested local production build. JS changed from `index-tKqH2Muo.js` to
`index-BpKhxK_8.js`; SHA-256 values are in `deployment-result.json`. This verifies
the public URL is serving the intended build rather than a stale frontend asset.

`live-browser.json`: all 16 public defaults again complete under official V5,
with exact reference node/route/bounds/coverage comparisons and exact SVG route
coordinates, no API interception and no browser errors. Local/live compiled
instruction lists agree exactly. Fit/scroll, program selection, GCD execution,
compute Next playback and both registry/notation requirements pass live.
`live-*.png` captures the deployed diagrams; compare `before-subtractive_gcd.png`
and `before-modulo_3.png` with the corresponding live captures. Post-release
evidence is committed on the release branch without an unnecessary second
production deployment. No public route uses an older constructor.

## Prior work and provenance

This is production integration and finite verification of pre-existing project
source, not theorem development or a novelty claim. Sources actually consulted:
November 14 V5_RULEBOOK.md (identity/defaults/execution-order sections), source
identity manifest and source closure; opening census/scope passages of
RULE_COMPLEXITY_AUDIT.md, THEOREM_CENSUS.md and THEOREM_RULE_MATRIX.md; five archived
closures listed above; existing release records (November 5/6); production source,
GitHub deployment metadata, Vercel inspect, live HTML/JS, and actual browser/API
responses. Research claims in those documents have not been re-proved here.
No external mathematical literature searched or consulted; novelty NOT SEARCHED.

Evidence status: source identity HASH-VERIFIED; finite equivalence and browser
checks COMPUTATION-/TRACE-VERIFIED; mathematical rules PRE-EXISTING PROJECT SOURCE.
Earlier intellectual origin beyond those records is not reconstructed. Codex on
14 November 2026 performed source tracing, packaging, component integration,
verification scripts, browser checks and release documentation. No independent
human review is claimed; human mathematical verification remains as recorded by
the existing research investigations. The repository charter and repo-local
urm-research-integrity skill govern this additive handoff.
