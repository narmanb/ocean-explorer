# Extreme Storm development and validation

Branch `extreme-storm-seas` builds on `mobile-ui-categories` at `8d6e6d9`.
Mobile/desktop controls, graphics settings, the 15-second benchmark, six 256² FFT
cascades, CDLOD mesh, standalone output and original MIT attribution are retained.
Default MSAA is now 1×; 4× remains selectable. No main-branch merge is included.

## Simulation and appearance

The wind spectrum and two independently phased directional JONSWAP swell spectra
combine in frequency space before the existing FFTs. Each swell has height,
wavelength, direction and directional concentration controls. Crossing angle
controls the secondary direction relative to the primary. Peak sharpness and
storm intensity affect actual spectrum energy; storm intensity also coordinates
foam, wind drift, lighting and cloud treatment. Presets cover Calm Ocean, Rough
Seas, Severe Storm, Cross Seas (startup), Cinematic Extreme and Original Sunset.
Targets blend with fixed random seeds and uninterrupted simulation time.

The vertical simulation is not amplified after the FFT. A steepness-aware limit
on horizontal chop, plus reduced chop in short-wave cascades, avoids many
foldovers without reducing vertical wave energy. Storm-aware culling bounds and
LOD distance include the vertical surface range. Full displacement Jacobians
correct normals. A damped Newton inverse probe samples the displaced surface
and three neighboring points every available readback frame; its residual is
included in benchmark metadata. Ride waves mode permits negative world altitude
inside troughs. Initial water clearance is resolved before the first visible frame.

Foam now responds to steep elevated crests as well as compression, persists and
drifts faster during storms, and retains procedural surface detail. Cooler light,
lower/billowing cloud banks, mist, trough contrast and crest translucency support
the larger scale. Spindrift uses 256 instanced procedural cards near the camera,
with surface/crest gating and soft alpha, rather than a particle simulation.
Mist and spindrift have independent working controls. No static storm artwork,
rain or lightning was added.

## Bugs found and corrected

- Packed FFT cross-Jacobians were corrupted when opposite-frequency amplitudes
  were evaluated with a direction different from the actual wrapped mirror on
  frequency axes. Using the exact mirrored vector restores Hermitian symmetry.
  A GPU readback test now checks the Jacobian moment identity per cascade.
- Comparing JavaScript haze values with float32 uniform values rebuilt atmosphere
  LUTs every frame for fractional storm haze. Both sides now use float32 values;
  settled weather reuses the existing LUTs. Transitions quantize haze to 0.1.
- Flat-sea bounds/camera clamping could hide high waves and prevent below-mean
  trough exploration. Bounds, inverse displacement sampling and camera clearance
  now account for the storm surface.
- Old normal/crest assumptions were unstable or visually excessive at large
  displacement. Determinant/square-root guards, full Jacobians, chop constraints
  and foam coverage tuning address the observed artifacts.

## Validation completed in this environment

- `npm test`: **9/9 passing**, including source/bundle equality and syntax,
  resolution/bloom/statistics regressions, preset completeness, smooth angle
  transitions, bounds/chop behavior and below-mean camera following.
- `npm run check:build`: both generated HTML files exactly match source.
- `git diff --check`: clean.
- Browser suite: **112 checks passing** across startup, shader/pipeline/resource
  and command validation, desktop/mobile layouts and controls, settings,
  resolution/MSAA, fullscreen, repeated preset switching, fractional-haze cache,
  benchmark reporting, both standalone file builds and capability fallbacks.
  That suite used `ENCODE_ONLY=1`: it validates GPU commands but skips submission.
- A separate render harness submitted **real GPU work** using Chromium 153 with
  SwiftShader, read back all six displacement/derivative layers, and captured
  rendered frames. Calm, Rough, Severe, Cross and Cinematic presets executed;
  readable and minified HTML also executed, plus a 4× MSAA Cinematic check.
  Images were inspected for giant wave faces, foam, cloud/water lighting and
  trough visibility. No shader/validation errors were reported in these runs.
- At deterministic simulation time ~37 seconds, the sampled Cinematic surface
  spans approximately **−57 to +49 metres** relative to mean sea level. This is
  a spatial sample of one generated sea, not a forecast, sustained benchmark or
  guaranteed crest range. Per-cascade packed-Jacobian moment error was below
  0.000002 after the symmetry fix. Horizontal chop tuning reduced sampled
  foldovers from about 16.5% to about 0.5% in one comparable extreme snapshot,
  while vertical displacement was unchanged (apart from half-float rounding).
- An actual deep-trough render placed the camera at **−51.57 m** world altitude
  with local water at about −54.63 m; the four inverse probe residuals were below
  0.00014 m at that point. This validates the tested location, not every wave.

SwiftShader's native canvas presentation path failed shared-image interoperability
in this environment. Actual GPU renders therefore used an offscreen WebGPU
texture with the same scene passes and explicit readback. Native Android canvas
presentation, physical touchscreen behavior and S25+ performance remain unverified.
No new FPS/GPU-time claims are made. The earlier user-supplied phone benchmark
(~51.2 FPS, 18.59 ms GPU, 780×360, 4× MSAA) predates these storms.

## Performance and model limits

The additional swell reuses existing FFT passes, textures and resolutions; no
seventh cascade or extra FFT set is introduced. Spindrift adds one bounded draw
and surface sampling. Height probes now do more work and read back more often.
Wave normals/foam/sky shading have extra arithmetic and samples. Preset blends
rebuild spectrum/sky inputs while changing. Their net cost needs device profiling;
this work does not claim a measured mobile speedup. Original cached sky/atmosphere
and cube-map mip improvements, GPU timing and benchmark reports remain available.

Wave systems interfere linearly with physical dispersion; they are not a nonlinear
fluid-collision solver. The surface cannot curl, overturn, form barrels or resolve
breaking-water volumes. Chop limiting, foam and procedural spindrift approximate
violent crests. Some foldovers remain in extreme settings, particularly arbitrary
short, high swells. Asynchronous height tracking and local sampling can still
miss a fast neighboring crest. Free-flight guard is not guaranteed collision.
The largest cascade is periodic at 1103 m, constraining very long wavelengths.
Clouds remain layered procedural fields. There is no underwater renderer.

## Reproduce and test on the phone

Run `npm ci`, `npm run build`, `npm test`, and `npm run check:build`. Optional
browser tests need externally installed Playwright (no new application dependency):

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:browser
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs SEA_PRESET=cinematic npm run test:render
```

`BROWSER_EXECUTABLE` and JSON `BROWSER_ARGS` select an available WebGPU browser.
`ENCODE_ONLY=1 OFFSCREEN_GPU=1` selects the command-only browser mode described
above. The separate render harness always submits to an offscreen target;
`SEA_ENTRY=http://localhost:8141/ocean.min.html` tests a generated build.
Its numerical samples use wrapped bilinear filtering at GPU texel centers on a
128² Lagrangian grid; they do not count all possible peaks between samples.
Readbacks/screenshots are local ignored QA artifacts, not assets used by the app.

On Galaxy S25+, open either standalone HTML in Chrome. Start with Cross Seas,
then Severe Storm and Cinematic Extreme; let each settle. Descend into troughs,
look up at approaching crests, rise above the surface, change crossing angle and
secondary height, and switch repeatedly back to Calm. Check joystick/look/boost,
settings scrolling, fullscreen, orientation changes, resolution and 1×/4× MSAA.
Watch for popping, exposed holes, underwater clipping and sudden camera movement.
After warm-up, record a 15-second sample at the same resolution for each preset,
then compare 1×/4× MSAA and spindrift on/off. Longer repeated runs are needed to
assess thermal throttling. Download the JSON reports with preset/probe metadata.
