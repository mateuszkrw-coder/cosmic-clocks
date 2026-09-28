# The showreel

The 15-second video at the top of the project README. It is code, not an edit:
[`showreel.js`](showreel.js) draws every frame on a canvas as a function of time, and it
draws them from the site's own files: the pulsar catalogue ([`js/data.js`](../../js/data.js)),
the pulse model ([`js/dsp.js`](../../js/dsp.js)) and the naked-eye star map
([`js/sky-data.js`](../../js/sky-data.js)).

| Seconds | What it shows |
|---|---|
| 0 – 2.5 | **Heartbeat.** PSR B0329+54 turning at its true rate, 1.40 times a second. Each time its beam sweeps past the camera is a tick, and each tick brings in a line of the title |
| 2.5 – 5.3 | **Spin-up.** The tuning dial swept from 1.40 to 716.36 turns a second, past ten real stations: beats, then a flutter, then a note. The chart recorder under the dial shows the ticks crowding into a solid band |
| 5.3 – 7.7 | **Galaxy.** The twelve pulsars at their real places in the Milky Way, and a flight path joining them from slowest to fastest |
| 7.7 – 10.1 | **Instruments.** CP 1919's single pulses stacked like the 1970 plot on the cover of *Unknown Pleasures*, then folded into the rotation clock, whose hand turns at the pulsar's true period |
| 10.1 – 12.5 | **Events.** The supernova of 1054, a Vela starquake, and the Crab at the tip of Taurus's horn in the sky from Earth |
| 12.5 – 15.0 | **Title.** The mark spins down to rest, the spin-up played backwards |

What is real in it:

- **One clock for the whole film.** A single spin phase runs from the first frame to the
  last: a whole number means a beam is sweeping past you, which is a tick. It starts at
  B0329+54's measured period (0.7145197 s), then the logarithm of the rate accelerates and
  eases to rest on J1748−2446ad's 716.36 turns a second. The counter at the bottom left
  (*since you tuned in*, as on the site) counts those turns exactly, and the sound track's
  ticks come from the same phase.
- **The numbers on screen** are the spin rates in the catalogue. The dial is the site's:
  logarithmic, 0.01 to 1000 turns a second, with its beats, flutter and tones zones.
- **The galaxy** puts each pulsar where `CC.galacticXYZ` puts it on the site (ATNF catalogue
  positions and distances), and is built the way the site builds its Milky Way.
- **The pulse stack** is CP 1919's pulses from the site's own `PulseModel`, with its two
  components, drifting subpulses and turn-to-turn variation; folding them gives the steady
  profile the rotation clock shows.
- **The sky** is the site's 5,000 Hipparcos stars and IAU figures, and the Milky Way along
  the true galactic plane, which runs right past the Crab (the galactic anticentre is in Taurus).
- **The loop keeps time.** The last heartbeat is exactly one B0329+54 period before the first,
  so the looping version in the README never skips a beat.

The supernova, the glitch (exaggerated about ten-thousand-fold, as on the site) and the
beams themselves are illustrations. Full-screen flashes stay under three a second: once the
spin is faster than that, the beam's flicker is averaged into a steady glow.

## Watch it live

Open [`index.html`](index.html) through a local server (it loads the site's files from
`../../js/`), for example `npx serve` in the repository root and then `/docs/showreel/`.
Space pauses, the arrow keys step, `index.html?t=8.5` shows a single frame.

## Render it

```bash
npm install -D playwright          # or point NODE_PATH at a global install
node docs/showreel/render.mjs      # about 20 minutes on 4 cores
node docs/showreel/render.mjs --draft   # 30 fps, no motion blur: build/draft.mp4 in a few minutes
```

This writes `docs/showreel.mp4` (1080p60, with sound), `docs/showreel.avif` (the looping
version in the README: an animated AVIF autoplays like a GIF at a fraction of the size) and
`docs/showreel.png` (a still for readers who prefer reduced motion). The README's *Watch in
HD* link points at the MP4 on GitHub Pages, which serves the repository as the live site:
GitHub's own file view only offers an MP4 as a download.

Headless Chromium draws each frame 8 times across a 180° shutter for motion blur. Stars,
beams, debris and the galaxy are splatted as light into a float buffer, and every particle
picks its own instant inside the shutter, so even a beam turning 716 times a second blurs
smoothly instead of strobing. WebGL then adds bloom, an anamorphic streak on the brightest
highlights, a touch of lens fringing and a vignette, and ffmpeg encodes.

## The sound

[`make_audio.py`](make_audio.py) synthesises the sound track (numpy only) from the
animation's cue times, which `render.mjs` exports. The ticks are the film's clock again: the
same spin phase drives a pulse train, heartbeats of receiver noise in B0329+54's five-part
pulse shape at first, clicks as they speed up, and at the top a tone locked to the same
phase. On the dial it lands on 716.36 Hz, 44 cents sharp of F5, and the whole score is
tuned to it: every chord is built on F = 716.36 Hz, so the fastest pulsar's note is the
tonic of the music rather than a stray pitch against it. When the twelve pulsars light up
in the galaxy, each plays its own spin rate folded by octaves onto the F pentatonic scale.

## Fonts

The site's own: Archivo, Cormorant and Martian Mono, under the SIL Open Font License
([`fonts/OFL.txt`](fonts/OFL.txt)). Canvas has no `font-variant-numeric`, so
[`tools/lining_figures.py`](tools/lining_figures.py) makes a copy of Cormorant with the
lining, tabular figures the site asks for in CSS as its default digits.
