# Mobile audit implementation plan

Goal: validate the existing mobile branch, preserve the six-cascade renderer and default appearance, fix demonstrated regressions, and make phone profiling repeatable.

Scope and design come from the user's detailed implementation request. Work stays on `mobile-ui-categories`; PR #1 stays draft; no merge. The fresh clone is isolated from other project checkouts. No renderer replacement, runtime dependencies or generated artwork.

- [x] Inspect branch/PR and reproduce the standalone build. Baseline build changed minified output because the previous build lacked esbuild.
- [x] Read renderer, shader, resource, invalidation and input paths. Identify small-size mip failure, focus handling and silent GPU loss.
- [x] Pin sizing/statistics bugs with Node tests and integration bugs with real-browser checks.
- [x] Fix sizing, focus and loss handling. Add optional 1×/4× MSAA, FPS cap and a 15-second downloadable measurement report.
- [x] Add opt-in GPU stage timestamps; use dispatch counts and actual timing where available. Cache sky LUT using its exact inputs and update reflection mips only for changed faces, retaining the existing filters and refresh cadence.
- [x] Validate source and both offline builds, including desktop, touch, narrow layout, resolution, settings and fullscreen; document environmental limits explicitly.
- [x] Rebuild twice, verify reproducibility, review diff, prepare the verified development branch and HTML for commit/push and PR #1 update. Delivery uses the user-authorized existing branch; no merge.

Review focus: device loss must halt rendering; focused settings must not move camera; small/oversize targets must stay legal; cached sky must refresh for every shader input; default visuals and standalone code must match source.

Validation: 4 Node checks and 83 browser interaction/encoding checks passed. Actual default-settings offscreen GPU image inspected. Native software presentation fails; Android performance remains unverified. See docs/MOBILE_AUDIT.md.
