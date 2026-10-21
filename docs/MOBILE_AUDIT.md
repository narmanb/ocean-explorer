# Ocean Explorer mobile audit — 2026-10-21

This continues `mobile-ui-categories` and draft PR #1, starting at `6c30379`.
The MIT renderer, six 256² FFT cascades, wave spectrum, foam maps, CDLOD mesh,
cloud noise/shadows, reflection filtering, HDR and default 4× MSAA are preserved.

## Evidence and limits

The supplied S25+ screenshot was approximately 68 FPS / 11.95 ms GPU at 749×360,
Medium 1×. It is one observation, not a baseline sustained run. There is no new
S25+ measurement in this change and no claim of stable 60 FPS on Android.

The available test GPU is Chromium 153 SwiftShader (CPU software rendering).
Its native WebGPU canvas presentation fails with a shared-image interop error,
then destroys the GPU device. Before the fix the app continued displaying
about 60 FPS and 0.00 ms GPU over a blank canvas. Those numbers are invalid as
rendering/performance evidence. A minimal WebGPU buffer readback works.

The test harness can substitute a real offscreen WebGPU texture for the canvas
swap texture. All renderer shaders, textures, compute/render pipelines, command
encoding, GPU validation and image readback still use WebGPU. Only presentation
is substituted. Offscreen tests serialize GPU submissions to bound the software
GPU queue; their FPS cannot be compared to native browser or phone performance.
A default-settings 320×180 GPU image was read back and visually inspected: the
sea, waves, sky, clouds, sun and reflection were present. This is a visual smoke
check, not a proof of Android rendering accuracy.

## Fixes

- Bloom mip count now fits small render targets. A 160×120 target has a maximum
  of seven mips in its half-size bloom texture; the previous fixed eight was
  invalid. The composite normalizes by the actual blur chain length. Normal
  phone/desktop sizes retain eight levels and the previous bloom normalization.
- Requested dimensions are positive, finite and capped to the device texture
  dimension limit with aspect ratio preserved. URL overrides are validated.
- Device loss, uncaptured GPU errors and initialization rejection show an error.
  Lost/failed devices stop frame submissions. Browsers without WebGPU globals also reach the availability message instead of failing before initialization. Pending/unavailable GPU timing is
  labeled instead of reporting zero as if it were a valid measurement.
- Settings keyboard focus no longer drives camera/H shortcuts. Repeated H
  keydown does not rapidly toggle the panel. Opening settings releases pointer
  lock and held keys. Scrolling settings no longer changes flight speed.
- Backgrounding clears held keys and cancels an active measurement; existing
  touch blur/cancel handling remains. `ui=0` also hides the touch overlay.
- Both standalone outputs now include the complete original MIT notice.
- Removed a redundant no-op screenshot call and made screenshot logging work
  before the first GPU timestamp sample arrives.

## Work removed without reducing quality

| Work | Before | After | Scope / qualification |
| --- | --- | --- | --- |
| Sky-view LUT | 256×144 texels × 48 ray steps every frame | Recomputed only when clamped altitude, sun elevation or haze changes | Shader reads these values and static atmosphere LUTs; camera heading, horizontal location, time and clouds are applied later. At unchanged inputs this removes 1,769,472 ray steps per frame. |
| Reflection mips | Filter all six faces after updating one base face | Filter only the face updated that frame | All six still refresh at startup and after relevant environment slider changes. Same 16-tap tent filter, nine mips, 256² faces and round-robin base refresh. Normal mip work is reduced by 5/6 (83.3%); this is a work count, not an FPS claim. |
| Bloom at zero strength | Eight down passes and seven up passes still run | Bloom passes are skipped | HDR and tone mapping remain active; no bloom contribution existed at zero strength. |
| Height probe | Compute every frame, read every eighth available frame | Unchanged | Small; avoid speculative camera changes without phone profiling. |

Non-environment sliders no longer force all six reflection faces to refresh.
No mobile wall-clock speedup is claimed from these work reductions.

## Resource and workload audit

Values below are logical uncompressed resource sizes calculated from source,
not measured resident GPU memory. They exclude allocation alignment, driver
metadata, browser resources, tiling/compression and transient scheduling.

| Area | Source-derived size / work | Assessment |
| --- | --- | --- |
| FFT buffers | Five × 256² × six × 16 bytes = 30 MiB | Shared-memory radix-2 FFT, 128 threads/workgroup, 8 KiB combined workgroup arrays. Row/column passes remain intact. Column access and storage traffic merit hardware profiling before transpose changes. |
| Wave texture arrays | Three RGBA16F arrays, six layers and nine mips ≈ 12 MiB | Displacement, derivatives and slope moments drive wave shape, LEAN roughness and glint stability. Removing cascades or mips would affect quality. |
| Persistent world foam | Two ping-pong 1024² RGBA16F arrays, two layers and 11 mips ≈ 42.67 MiB | Largest simulation texture allocation. Updates 2,097,152 base texels/frame plus mips and samples multiple wave cascades. A credible bandwidth/compute candidate, not a measured S25+ bottleneck. |
| Foam detail | 512² RGBA8 with ten mips ≈ 0.33 MiB | Generated once, not every frame. |
| Reflection cube | 256² × six RGBA16F faces, nine mips ≈ 4 MiB | Procedural cloud shading in base-face generation remains costly. Unchanged-face mip filtering was redundant. |
| Atmosphere | 256×64 transmittance, 32² multiscatter, 256×144 sky-view ≈ 0.414 MiB | Transmittance/multiscatter were already dirty-driven. Sky-view now is too. |
| Mesh | Baseline initial 749×360 selection: 974 nodes × 2,048 triangles = 1,994,752 triangles | CPU frustum/distance selection and morphing already present. No mesh density/LOD change without image and hardware evidence. |
| Default screen targets | About 15.08 MiB at 749×360 for 4× RGBA16F color, 4× depth32F, resolved HDR and bloom | Quadratic in scale. Excludes swap texture (~1.03 MiB) and presentation buffers. Tile GPUs may handle discarded attachments differently. |
| Screen targets, MSAA off | About 3.77 MiB at 749×360 | Direct single-sample HDR target, no multisample color target; greater edge aliasing is the explicit tradeoff. Simulation resources are unaffected. |

Water reflections use the environment cube and slope-moment roughness, not
screen-space ray marching. Sky/clouds are shaded in the scene and in reflection
updates; lowering screen resolution does not reduce fixed FFT, foam or cube work.
The existing LEAN and analytic cloud anti-aliasing remain enabled even with
MSAA off. Render targets/bind groups are rebuilt only for size/MSAA changes;
FFT, foam and atmosphere resources are allocated once. Normal frame descriptors
and uniform arrays are reused. Recording intentionally collects samples.

## Real settings and profiling

- Resolution: existing 0.65× / 1× / 1.5× / 2×, synchronized toolbar/panel.
- Anti-aliasing: default 4× MSAA or off (1×), with matching pipelines, depth and
  HDR attachments. Both pipeline pairs are cached after first use.
- Frame-rate cap: Unlimited (unchanged default), 60 or 30 FPS. Browser vsync still
  bounds Unlimited. Timing uses actual elapsed frame intervals; simulation dt
  remains capped separately for stability.
- GPU stage timing: optional, reloads the current local/hosted page with current
  environment/camera/graphics settings retained. `profile=1` is equivalent.
  It adds compute pass boundaries for waves, foam, atmosphere/reflections, scene,
  and post. Normal mode retains the combined compute pass.
- Measure 15 seconds: collect frame intervals and every-eighth-frame available
  GPU timestamp samples, report mean/median/p95 and download JSON with settings,
  device/browser description, duration and sample counts. The window begins on
  the first rendered frame after clicking. Resize, settings changes or hiding
  the page cancel measurement so incompatible runs are not mixed. GPU data is
  null when unsupported/unavailable; stage data requires detailed timing.

Stage values measure the named pass spans, not shader-by-shader occupancy or
physical memory bandwidth. First-frame/reinitialization work can appear in
samples. Wait for startup and pipeline compilation before measuring. Optional
profiling itself adds overhead. Fifteen seconds is a repeatable sample, not a
thermal stability claim. Longer manual sessions are needed for throttling.

Wave/reflection/cloud/foam quality presets and adaptive resolution are deferred.
They need phone stage timings and visual comparisons; no placeholder controls
or arbitrary simulation-quality reductions were added.

## Reproduction

```
npm ci
npm run build
npm test
npm run check:build
npm start
```

Browser checks are optional tooling, not a runtime dependency. Install
Playwright separately, then run `npm run test:browser`. Set `PLAYWRIGHT_MODULE`
to its module path and `BROWSER_EXECUTABLE` / `BROWSER_ARGS` when a supplied
Chromium is required. `OFFSCREEN_GPU=1` enables the documented offscreen
presentation and bounded software queue. `ENCODE_ONLY=1` skips GPU submissions for fast UI/command-encoding checks; it still compiles real shaders/pipelines and validates resource/command construction, but does not test shader execution or image output. In that mode reports must leave GPU timing null. The browser script tests the source
and opens both standalone bundles directly with `file://`.

## Validation results for this revision

- `npm test`: 4 tests passed (resolution limits, small bloom targets, statistics,
  and generated-file/source consistency including inline JS syntax and license).
- `npm run check:build`: both generated HTML files match source exactly.
- `git diff --check`: clean.
- Chromium interaction/encoding suite: 83 checks passed using real WebGPU
  resources and shader/pipeline compilation, offscreen targets and **GPU
  submission disabled**. Covered all 16 sliders and all five categories,
  stationary sky caching, one-face mip dispatch counts, zero-bloom pass skipping,
  1×/4× MSAA switching, every resolution scale, small targets, portrait/landscape,
  joystick, boost, altitude, touch camera, fullscreen, report download/duration,
  loss handling, no-timestamp devices, unavailable WebGPU, and desktop WASD/H in
  source and both direct-file standalone pages.
- The original branch failed the focused-settings H test. A separate unsupported
  browser test reproduced `GPUBufferUsage is not defined` before the availability
  check; it passed after moving access inside initialized WebGPU handling.
- Separately, **actual GPU execution** with the default settings and a real
  offscreen texture produced a 320×180 image, which was read back and visually
  inspected. No shader or GPU validation error was reported in that smoke run.
  A separate nine-frame actual-GPU smoke run at 128×72 with MSAA, clouds, veil
  and bloom off completed with nonzero total GPU timestamps and no reported
  validation error; the optional stage timing command path was active. Its
  software GPU timings are not mobile benchmark data.
  Native headless presentation remains blocked by the environment, as described
  above. This does not establish mobile rendering accuracy or performance.
- A full image-executing interaction run was attempted but was impractically slow
  on the software GPU and timed out at 120 seconds during startup/frame progress.
  It was replaced by the explicitly labeled encoding suite plus bounded actual
  image smoke checks. Full hardware execution of the suite remains to be done.
- An independent source review found no Critical/Important issues. Its measurement
  window boundary observation was fixed; a browser assertion now checks that
  reported interval totals equal the reported duration.

## Galaxy S25+ test sequence

1. Open the downloaded `ocean.html` in Chrome. Use Medium 1× and default 4× MSAA.
   Wait for startup. Confirm ocean/sky/reflections/foam, then explore for a few
   minutes to warm the device. Take screenshots if something looks wrong.
2. Check landscape and portrait, including simultaneous joystick + drag-to-look,
   UP/DOWN, boost, letting go outside controls, opening settings and returning
   after switching apps. Confirm no drifting/stuck input.
3. Open every category; change wind/swell, sun/haze, clouds, foam, exposure and
   bloom. Confirm visual response, scrolling and synchronized resolution menus.
4. Cycle all resolution scales and fullscreen repeatedly. Confirm no black
   frames, errors, broken aspect ratio or touch control placement.
5. Under Graphics & Performance, Measure 15 seconds and Download last report.
   Repeat while stationary, looking at sky and looking down at waves. For stage
   breakdown, enable GPU stage timing (reload), warm up, and repeat. Share JSON.
6. Compare 4× MSAA with off at the same scale/view. Check edges, horizon and sun
   glitter carefully. Try the 60 FPS cap; use 30 only as an optional battery/heat
   tradeoff. Repeat measurements after 5–10 minutes to look for throttling.
7. Test `ocean.min.html` too. Chrome file handling/Android WebGPU, native
   presentation, physical touch ergonomics, sustained FPS, battery and thermals
   remain device tests, regardless of software-browser results.
