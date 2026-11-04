# Renderer notes

Internal notes for `src/engine/`, `src/render/svg.ts`, and the export loop timings.

## The sampler

`new BlubEngine(100, "idle", shapeRadii, expression)` keeps a current state, the previous
state, a shape and expression with their own morph clocks, and a look vector.

`sample(t)` returns:

```
bodyPath, bodyAlpha,
eyes: [{ d, matrix, alpha }],
dots: [{ x, y, r, opacity, color?, depth?, d?, rot? }],
dotsBehind, arcs, notif, notch
```

Silhouette: 64 radii around a circle. The path is a Catmull-Rom spline converted to
cubic Béziers with tension 1/6. The cloud is a smooth union (k = 0.18) of its five
circles. Shapes morph by interpolating the radius arrays over 0.45 s with `easeOutQuint`.
Expressions morph the same way.

Eyes: a 3D basis is built from yaw, pitch and roll. Two eye points sit at `±split`
degrees on the sphere. Each is projected to 2D and turned into a `matrix(...)` that
carries the position, the surface tilt, the eye's own tilt and an eyelid squash.
They are drawn as rounded rectangles in a mask.

Clay: the body path is filled with the paper colour, then a radial gradient is masked
over the body. The mask also cuts the eyes and the notification notch, so the eyes
show the paper beneath. The gradient uses a 158 unit reference radius even though the
exported viewBox is 124, which keeps the same lighting when cropping to 124.

Ambient motion is layered on in `sample()`:

- gaze wander: sums of sines with periods 11.3, 3.7, 9.1, 4.3 and 13.7 s
- body drift: periods 7.9 and 5.3 s, amplitude 0.006 and 0.007
- breath: 3.4 s, vertical scale 1 ± 0.005
- blink schedule: a seeded RNG (seed 24301) creates gaps of `1.9 + 2.7 * rnd` seconds,
  with a 18 percent chance of a double blink 0.24 s later. A blink is 0.18 s.

Pointer look: `yaw = 16 * nx`, `pitch = -13 * ny`, `mix` ramps from 0 to 1 over 0.85 s
with `easeOutQuint`. The ramp starts once when the live look begins, not on each pointer
move, and the look itself blends over 0.24 s. `wander` is disabled while the pointer is
present. The studio keeps `mix` at 1 and eases cursor arrival and departure with a 0.85 s
look morph, then tracks with 0.24 s.

## Verification

`research/golden.json.gz` is our own reference output, generated from the current `dist/`
build by `scripts/snapshot.mjs` (`npm run snapshot`). It contains 1,800 engine samples
(every state x shape x face at `t` = 0, 0.37, 1.64968, 3.1 and 7.77), morph timelines,
setLook sequences, seeded decorations, catalog tables and ten `renderSVG` frames.

`npm run verify` re-renders the pebble / blue / happy frame at `t = 1.64968` and compares
it with that snapshot. The 64-point body path, both eye matrices, all four clay gradient
stops and the full SVG must match exactly. `npm run verify:golden` compares the entire
snapshot byte for byte. Neither check needs an image dependency or a browser.

Only regenerate it after an intentional visual change: the snapshot is the behaviour
contract, so `npm run snapshot` accepts whatever the current code draws.

The reference frame uses `fill="#ffffff"` for the paper underfill and viewBox
`-124 -124 248 248`.

## Loop engineering

Breath is 3.4 s, so the export lengths are 6.8, 10.2 and 13.6 s: two, three and four
breath cycles. Breath, and almost all of the body motion, then lands on the same phase.

The wander is not periodic on those lengths, so the start time is chosen numerically.
For each length the code scans candidate start times, rejects any seam within 0.45 s of
a blink, and minimises the distance between the two eye centres at the seam:

| Length | Start |
| --- | --- |
| 6.8 s | 6.5 |
| 10.2 s | 2.18 |
| 13.6 s | 7.18 |

For the 10.2 s loop the eye centres differ by 0.47 engine units at the seam, under one
pixel at 512 px. The first and last decoded frames differ by about one pixel around the
silhouette edge and by at most 3/255 inside the body.

## Credit

The blub character design is credited to Jeremy Perret. He is not officially affiliated with Grok bot.
