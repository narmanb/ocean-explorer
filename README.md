# Ocean Explorer

This fork of [Noniv/web-ocean](https://github.com/Noniv/web-ocean) adds mobile exploration controls, categorized settings, performance reports and extreme crossing seas. The renderer remains based on Maksymilian Dendura's MIT-licensed work.

## Storm & Extreme Seas

The page starts in **Cross Seas** with **1× MSAA**. Open Settings → Storm &
Extreme Seas to choose Calm Ocean, Rough Seas, Severe Storm, Cross Seas,
Cinematic Extreme, or Original Sunset. Presets blend smoothly over several
seconds while simulation time keeps running.

Primary swell height now reaches 48 m, secondary swell height 40 m; both have
independent direction, wavelength and concentration controls. A crossing-angle
slider rotates the secondary system relative to the primary. Larger concentration
means a narrower directional spread. Height controls are nominal significant
swell sizes, not the height of each individual crest. Cinematic Extreme is an
intentional exaggeration, not a real-world forecast.

The six FFT cascades remain 256². The second swell has independent random phases
and uses the same FFTs. Storm-dependent foam, lower cloud banks, cooler light,
sea mist and a bounded procedural crest-spindrift pass respond to the sea state.
Mist and spindrift can each be turned off. No external artwork or large particle
system is used.

**Ride waves** (default): UP/DOWN adjusts height above the moving local water;
you can descend into troughs below mean sea level. **Free flight + guard** retains
free vertical movement with local water clearance. A damped inverse-displacement
probe and expanded mesh bounds support the larger surface. Height tracking is
asynchronous and cannot guarantee perfect clearance for every extreme manual
setting. See [storm validation and limitations](docs/STORM_DEVELOPMENT.md).

## Mobile controls and settings

Open **`ocean.html`** or **`ocean.min.html`** directly in recent Chrome on a compatible Android device (WebGPU required). Both generated pages are self-contained and do not fetch the original project at runtime.

- **Left joystick:** move forward, back and sideways.
- **Drag the ocean:** look around.
- **UP / DOWN:** rise and descend.
- **FAST 5×:** toggle movement boost.
- **Settings:** open a collapsible accordion with Storm & Extreme Seas, Wind, Waves, Water, Sky & Atmosphere, and Graphics & Performance.
- **Resolution:** choose 0.65×, 1×, 1.5× or 2× from the toolbar or Graphics & Performance; both stay in sync.
- **Fullscreen:** use the fullscreen button when the browser supports it.
- **Anti-aliasing:** off / 1× by default; 4× MSAA remains available. Analytic wave/sky anti-aliasing stays active.
- **Frame-rate cap:** Unlimited (original default), 60 or 30 FPS.
- **Measure 15 seconds:** record a repeatable sample and download its JSON report under Graphics & Performance. GPU stage timing is optional and reloads the page with the current scene/settings. Warm up before measuring; a 15-second sample is not a thermal stability test.

Touch controls are shown on coarse-pointer devices. Append `?touch=1` to force them on or `?touch=0` to force them off. Append `?scale=0.65` to start at a lower render resolution. On mobile, scale 1× uses CSS pixel dimensions (rather than the usually higher device-pixel-ratio rendering size); on desktop it uses native device-pixel-ratio dimensions. Explicit `?w=` / `?h=` settings still override dimensions.

Desktop WASD, mouse look, H for settings, Shift boost, and Space/E/Q/C for altitude continue to work.

See [the mobile audit](docs/MOBILE_AUDIT.md) for changes, resource/work analysis, browser test limits and the Galaxy S25+ checklist. The user supplied an earlier 15-second phone report of roughly 51.2 FPS / 18.59 ms GPU at 780×360 and 4× MSAA. There is no new phone measurement for the storm build and no claim of stable 60 FPS.

Run `npm ci`, `npm run build`, `npm test` and `npm run check:build` to verify both standalone pages match source. Browser tooling is optional and documented in the audit. Native Android presentation, physical touch and sustained performance still require phone testing.

## Original project documentation

# web-ocean

A real-time ocean renderer written from scratch on WebGPU, with no engine or rendering library. It draws a sunset sea with simulated waves, whitecaps, sun glitter, and a physically based sky with clouds. You fly around it with a free camera.

![Looking toward the sun from 2.4 m above the water](docs/front.jpg)

| 75 degrees off the sun, 2.4 m up | Looking toward the sun from 30 m up |
|---|---|
| ![](docs/side.jpg) | ![](docs/high.jpg) |

## Run it

You need a recent Chrome with WebGPU and a reasonably capable GPU. On a laptop, force Chrome onto the dedicated GPU in the Windows graphics settings, or it will fall back to the integrated one.

Open `ocean.html` directly in the browser. `ocean.min.html` is the same page minified. Build sizes change as controls and diagnostics evolve. Both are self-contained and work from `file://`.

To run from source:

```
npm install
npm start        # serves http://localhost:8080/
```

After editing anything under `js/`, run `npm run build` to regenerate both bundles. The minified build strips WGSL comments and whitespace and minifies the JavaScript with esbuild.

## Controls

| Input | Action |
|---|---|
| Click the canvas | Capture the mouse (Esc releases it). Holding the right mouse button also works. |
| Mouse | Look around |
| W A S D | Move |
| Space or E / Q or C | Up / down |
| Shift | 5x speed |
| Mouse wheel | Change base speed |
| H | Settings panel: wind, swell, choppiness, turbidity, foam, sun, haze, clouds, exposure, bloom |

The camera samples the displaced surface and applies a local clearance guard. Extreme conditions and readback latency can still expose tracking limitations; this is not a collision guarantee.

URL parameters are handy for testing. `?w=2560&h=1440` forces the render resolution, `preset=cinematic` selects a sea state; `cam=x,y,z,yawDeg,pitchDeg` sets the camera (Y is initial clearance in Ride waves mode, absolute altitude with `camera=free`), `fov=deg` sets the field of view, `ui=0` hides the HUD, and any settings key works too, for example `windSpeed=12&swellHs=2&sunElev=8`.

## How it works

### Waves

The sea is a Tessendorf FFT simulation with six cascades of 256 by 256 samples. The patches range from 1103 m down to 0.26 m, so wavelengths run from about a kilometre to a few millimetres. The smallest cascade produces the sharp sun sparkles near the camera.

The spectrum is a fetch-limited JONSWAP wind sea with Donelan-Banner directional spreading, plus a narrow long-crested swell. Dispersion includes the capillary term, and choppy horizontal displacement sharpens the crests. The inverse FFTs are radix-2 compute shaders working in workgroup memory.

The surface mesh is a CDLOD quadtree with 17 levels. Vertices are 6.25 cm apart near the camera and the mesh reaches 160 km, with continuous vertex morphing between levels.

### Shading

- Mip-mapped first and second moments of the wave slopes (LEAN mapping) give the right anisotropic roughness at every distance. The sun glitter widens with distance and the far sea settles into a sheen without aliasing. Screen-space slope derivatives add specular anti-aliasing.
- Sun glitter uses an anisotropic Gaussian slope distribution with Smith masking and the size of the solar disc.
- The sky reflection comes from an environment cube map rebuilt every frame, with roughness-filtered mips. At grazing angles the reflection direction is tilted to account for which wave facets the viewer can actually see.
- The water body is turbid blue-green, lit by the whole sky hemisphere. Backlit crests get a subsurface glow, and wind-gust patches modulate the short ripples.
- Whitecaps start where the total surface Jacobian folds. Foam is stored in two camera-centred world-space maps (128 m and 1 km wide), decays over time, drifts downwind, and breaks into streaks as it ages. A procedural bubble texture gives it its structure.

### Sky

The atmosphere follows Hillaire's approach, with transmittance, multiple-scattering, and sky-view lookup tables plus aerosol haze. There are two cloud layers, a broken low cumulus and a fibrous altostratus deck. Each is shaded with self-shadowing toward the sun, lit rims, silver linings when backlit, and direction-dependent multiple scattering.

Cloud noise octaves are filtered by pixel footprint, and silhouettes are anti-aliased analytically: the screen-space derivative of each layer's edge function sets the width of its opacity edge. Cloud transmittance along the sun direction dims the sunlight that reaches the water, and aerial perspective is applied over the sea.

### Post-processing

The scene renders in HDR with 1× sampling by default and optional 4× MSAA. Post-processing adds up to 8 levels of bloom (fewer for very small targets), AgX tone mapping, a slight white balance shift, and dithering. Storm presets neutralize the sunset color shift.

## Performance

The original project reported about 6 to 8 ms per frame at 2560 by 1440 on an RTX 5070 Ti while other programs were running. That is an upstream measurement, not a benchmark of this storm upgrade. The HUD shows FPS and GPU time when the browser supports `timestamp-query`.

The renderer reuses uniform arrays and most descriptors. Resizing or switching MSAA rebuilds screen targets; recording and optional detailed timing add diagnostic allocations. WebGPU also requires recurring swap-chain views and command buffers.

## Known limitations

- Far water is still somewhat darker than the bright horizon sky above it.
- The water is tuned toward turbid coastal water. The "Water turbidity" slider gives darker, bluer deep water when turned down.
- The scene is open ocean only. There is no shoreline, surf, or objects in the water.
- Clouds are two flat layers, not volumetric.

## How it was made

I built this with Claude Code (Opus 5.5). I asked for the most realistic water it could produce, in WebGPU, with a floating camera, and left the architecture and implementation to it. It checked its own work by rendering screenshots in headless Chrome and having separate critic subagents review them, so it was not grading its own output. I gave feedback along the way, mainly on the clouds, which led to replacing the volumetric clouds with the flat layers and later fixing their edge aliasing.

## Repository layout

| Path | Contents |
|---|---|
| `index.html` | Page shell, HUD, and settings panel styles |
| `js/main.js` | Device setup, resources, camera, per-frame loop |
| `js/wgsl/` | Shaders as JavaScript modules: `sim.js` (waves and foam), `sky.js` (atmosphere and clouds), `ocean.js` (surface and sky pass), `post.js` (bloom and tone mapping), `common.js` (shared structs) |
| `server.mjs` | Tiny static server for development |
| `build.mjs` | Builds `ocean.html` and `ocean.min.html` |
| `docs/` | README images |

## License

MIT. See [LICENSE](LICENSE).
