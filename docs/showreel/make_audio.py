"""Synthesise the showreel's sound track from the animation's cue times.

    python docs/showreel/make_audio.py cues.json audio.wav

Only numpy. Every sound is made of sines and noise, shaped with envelopes and
filters, and placed where the picture does something. The ticks are the film's
own clock: the same spin phase the animation draws (cues.json) drives a pulse
train, so each tick lands exactly when a beam sweeps past, and as the spin-up
climbs from 1.40 to 716.36 turns a second the ticks fuse into a note.

That note, PSR J1748-2446ad's, is 44 cents sharp of F5. The score is tuned to
it rather than to A = 440: every chord here is built on F = 716.36 Hz, so the
pulsar's note is the tonic of the music, not a stray pitch against it.
"""
import json
import sys
import wave

import numpy as np

SR = 48000
DURATION = 15.0
N = int(SR * DURATION)
rng = np.random.default_rng(1967)
F5 = 716.36                                    # J1748-2446ad, turns per second


def pitch(semitones_from_f5):
    return F5 * 2.0 ** (semitones_from_f5 / 12.0)


def pentatonic(f):
    """A spin rate folded by octaves onto the nearest note of F major pentatonic (semitones above F)."""
    s = (12 * np.log2(f / F5)) % 12
    return min((0, 2, 4, 7, 9, 12), key=lambda x: abs(x - s)) % 12


def seconds(d):
    return np.arange(int(round(d * SR))) / SR


def smoothstep(a, b, x):
    x = np.clip((x - a) / (b - a), 0.0, 1.0)
    return x * x * (3 - 2 * x)


# ---------------------------------------------------------------- filters

def spectral(x, response):
    """Zero-phase filter: multiply the spectrum by response(freqs)."""
    n = len(x)
    size = 1 << (n - 1).bit_length()
    spec = np.fft.rfft(x, size)
    spec *= response(np.fft.rfftfreq(size, 1 / SR))
    return np.fft.irfft(spec, size)[:n]


def lowpass(x, fc, order=2):
    return spectral(x, lambda f: 1 / np.sqrt(1 + (f / fc) ** (2 * order)))


def highpass(x, fc, order=2):
    return spectral(x, lambda f: 1 / np.sqrt(1 + (fc / np.maximum(f, 1e-3)) ** (2 * order)))


def bandpass(x, lo, hi, order=2):
    return highpass(lowpass(x, hi, order), lo, order)


def svf(x, centre, q=0.9, mode='lp'):
    """State-variable filter whose cutoff follows an array, sample by sample."""
    out = np.empty_like(x)
    low = band = 0.0
    g_all = np.tan(np.pi * np.clip(centre, 20, SR * 0.45) / SR)
    k = 1 / q
    for i, v in enumerate(x):
        g = g_all[i]
        hp = (v - (k + g) * band - low) / (1 + g * (k + g))
        bp = g * hp + band
        lp = g * bp + low
        band, low = bp + g * hp, lp + g * bp
        out[i] = lp if mode == 'lp' else bp if mode == 'bp' else hp
    return out


# ---------------------------------------------------------------- the mix

class Mix:
    def __init__(self):
        self.dry = np.zeros((2, N))
        self.send = np.zeros((2, N))

    def add(self, sig, at, gain=1.0, pan=0.0, verb=0.25):
        sig = np.asarray(sig, dtype=float)
        if sig.ndim == 1:
            left, right = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
            sig = np.stack([sig * left * np.sqrt(2), sig * right * np.sqrt(2)])
        i = int(round(at * SR))
        if i >= N:
            return
        if i < 0:
            sig, i = sig[:, -i:], 0
        n = min(sig.shape[1], N - i)
        self.dry[:, i:i + n] += sig[:, :n] * gain
        self.send[:, i:i + n] += sig[:, :n] * gain * verb


def reverb(send, seconds_=2.4, seed=5):
    """Convolution with a synthetic hall: decorrelated noise with an exponential tail,
    darker as it decays, and a few early reflections."""
    r = np.random.default_rng(seed)
    n = int(seconds_ * SR)
    t = np.arange(n) / SR
    out = np.zeros_like(send)
    for ch in range(2):
        ir = r.standard_normal(n) * np.exp(-t * 6.9 / seconds_)
        # darker with time: blend towards a low-passed copy
        dark = lowpass(ir, 2500, 1)
        mix = np.clip(t / seconds_ * 1.6, 0, 1)
        ir = ir * (1 - mix) + dark * mix
        for d, g in ((0.011, 0.5), (0.019, 0.35), (0.027, 0.3), (0.041, 0.22)):
            j = int((d + 0.003 * ch) * SR)
            ir[j] += g * 6
        ir[: int(0.006 * SR)] = 0
        ir /= np.sqrt(np.sum(ir ** 2))
        size = 1 << (len(send[ch]) + n - 1).bit_length()
        out[ch] = np.fft.irfft(np.fft.rfft(send[ch], size) * np.fft.rfft(ir, size), size)[:len(send[ch])]
    return out


# ---------------------------------------------------------------- instruments

def phase_of(freq):
    """Running phase (radians) of a frequency that may change every sample."""
    return 2 * np.pi * np.cumsum(freq) / SR


def pad(semitones, dur, attack=0.6, release=1.2, bright=2500, gain=1.0):
    """A soft chord: each note three slightly detuned voices of a few harmonics."""
    t = seconds(dur)
    out = np.zeros((2, len(t)))
    for k, s in enumerate(semitones):
        f = pitch(s)
        for v, (det, pan) in enumerate(((-7, -0.6), (0, 0.0), (7, 0.6))):
            fv = f * 2 ** (det / 1200)
            ph = 2 * np.pi * fv * t + rng.uniform(0, 2 * np.pi)
            wave_ = np.zeros_like(t)
            for h in range(1, 9):
                if fv * h > bright * 2.2:
                    break
                wave_ += np.sin(h * ph) / h ** 1.35 * (1 / (1 + (fv * h / bright) ** 2))
            wobble = 1 + 0.08 * np.sin(2 * np.pi * (0.23 + 0.07 * k) * t + v)
            left, right = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
            out[0] += wave_ * wobble * left
            out[1] += wave_ * wobble * right
    env = np.minimum(1, t / attack) * np.clip((dur - t) / release, 0, 1) ** 1.5
    out = out * env * gain / (len(semitones) * 2.2)
    # leave the lowest octave to the kick and the sub: a pad that fills it turns to mud
    return np.stack([highpass(out[0], 110, 2), highpass(out[1], 110, 2)])


def pluck(f, dur=0.9, decay=0.28, bright=1.0):
    t = seconds(dur)
    ph = 2 * np.pi * f * t
    body = np.sin(ph) + 0.35 * bright * np.sin(2 * ph) * np.exp(-t / (decay * 0.4)) + 0.12 * bright * np.sin(3 * ph) * np.exp(-t / (decay * 0.25))
    return body * np.exp(-t / decay) * np.minimum(1, t / 0.002)


def click(width=0.0009, dur=0.03, tone=3200):
    t = seconds(dur)
    x = np.exp(-0.5 * ((t - 3 * width) / width) ** 2) * np.sin(2 * np.pi * tone * t)
    return x / (np.max(np.abs(x)) + 1e-9)


def telescope_pulse(dur=0.09, width=0.006, comps=((0.0, 1.0),), grain=0.8):
    """A pulsar pulse as a radio receiver hears it: noise shaped by the pulse profile."""
    t = seconds(dur)
    shape = np.zeros_like(t)
    for off, amp in comps:
        shape += amp * np.exp(-0.5 * ((t - 0.02 - off) / width) ** 2)
    noise = bandpass(rng.standard_normal(len(t)), 250, 6000)
    noise /= np.max(np.abs(noise)) + 1e-9
    return shape * (grain * noise + (1 - grain) * np.sin(2 * np.pi * 180 * t))


def thump(f0=62, f1=38, dur=0.5, decay=0.16):
    """A low hit with enough body (saturated harmonics, a knock around 150 Hz) to be heard
    on laptop and phone speakers too, not only felt on big ones."""
    t = seconds(dur)
    f = f1 + (f0 - f1) * np.exp(-t / 0.05)
    ph = phase_of(f)
    body = np.sin(ph) * np.exp(-t / decay)
    knock = np.sin(2 * ph + 0.3) * np.exp(-t / (decay * 0.35)) * 0.45
    x = np.tanh((body + knock) * 1.8) / np.tanh(1.8)
    return x * np.minimum(1, t / 0.003)


def boom(dur=3.0):
    t = seconds(dur)
    f = 24 + 70 * np.exp(-t / 0.22)
    sub = np.sin(phase_of(f)) * np.exp(-t / 0.9)
    crack = lowpass(rng.standard_normal(len(t)), 2400, 1) * np.exp(-t / 0.09)
    rumble = bandpass(rng.standard_normal(len(t)), 60, 420, 2) * np.exp(-t / 0.8) * 3.0
    x = sub * 0.8 + crack * 1.2 + rumble
    return np.tanh(x * 1.6) * np.minimum(1, t / 0.002)


def whoosh(dur, f0, f1, q=0.7, curve=1.0):
    t = seconds(dur)
    u = (t / dur) ** curve
    centre = f0 * (f1 / f0) ** u
    x = svf(rng.standard_normal(len(t)), centre, q, 'bp')
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 1.5
    x = x * env
    return x / (np.max(np.abs(x)) + 1e-9)


def riser(dur, f0=300, f1=4200):
    t = seconds(dur)
    centre = f0 * (f1 / f0) ** ((t / dur) ** 2)
    x = svf(rng.standard_normal(len(t)), centre, 1.6, 'bp')
    x *= (t / dur) ** 2
    return x / (np.max(np.abs(x)) + 1e-9)


def shimmer(dur, notes, rate=18, seed=3):
    """Tiny high sine grains, like stars coming out."""
    r = np.random.default_rng(seed)
    out = np.zeros((2, int(dur * SR)))
    n = int(dur * rate)
    for _ in range(n):
        at = r.uniform(0, dur - 0.3)
        f = pitch(r.choice(notes))
        g = pluck(f, 0.5, 0.12, 0.3) * r.uniform(0.3, 1.0)
        pan = r.uniform(-0.9, 0.9)
        i = int(at * SR)
        m = min(len(g), out.shape[1] - i)
        out[0, i:i + m] += g[:m] * np.cos((pan + 1) * np.pi / 4)
        out[1, i:i + m] += g[:m] * np.sin((pan + 1) * np.pi / 4)
    return out


# ---------------------------------------------------------------- the score

def main(cues_path, out_path):
    cues = json.load(open(cues_path))
    T = cues['T']
    mix = Mix()
    t_all = np.arange(N) / SR

    # The spin phase, sample by sample, from the animation's own table.
    phi_t = np.arange(len(cues['phi']['values'])) * cues['phi']['dt']
    phi = np.interp(t_all, phi_t, np.array(cues['phi']['values']))
    rate = np.gradient(phi) * SR
    rate = np.maximum(rate, 1e-3)

    # 01: B0329+54's heartbeat. Its pulse has five components; each tick is a
    # burst of receiver noise in that shape, over a low thump.
    b0329 = ((-0.021, 0.28), (-0.009, 0.35), (0.0, 1.0), (0.008, 0.3), (0.019, 0.55))
    comps = tuple((off * 0.7145 * 0.35, amp) for off, amp in b0329)
    hiss_env = smoothstep(0.0, 0.4, t_all) * (1 - smoothstep(T['s3'] - 0.2, T['s3'] + 0.3, t_all))
    hiss = bandpass(rng.standard_normal(N), 400, 7000) * 0.009 * hiss_env
    mix.add(hiss, 0, 1.0, 0, 0.1)
    mix.add(pad([-24, -17, -12], T['s2'] + 0.6, 1.2, 0.8, 900, 1.0), 0.0, 0.35, 0, 0.6)
    def heartbeat(at, g=1.0):
        mix.add(telescope_pulse(0.12, 0.0035, comps, 0.85), at - 0.02, 0.5 * g, 0, 0.35)
        mix.add(thump(96, 52, 0.6, 0.17), at, 0.9 * g, 0, 0.2)
        mix.add(click(0.0006, 0.02, 2600), at, 0.25 * g, 0, 0.3)
    for at in cues['heart'] + [cues['final']]:
        heartbeat(at)

    # 02: the spin-up. A pulse train locked to the phase: narrow pulses of noise
    # while the beats are slow, clean clicks as they speed up, and at 716 turns
    # a second a tone, with its own harmonics, still locked to the same phase.
    s2, land = T['s2'], T['land']
    d = phi - np.round(phi)                                   # turns from the nearest tick
    width = np.clip(0.0011 * rate, 0.0, 0.16)                 # pulse width in turns
    width = np.maximum(width, 1e-6)
    pulses = np.exp(-0.5 * (d / width) ** 2)
    grain = bandpass(rng.standard_normal(N), 300, 7000)
    grain /= np.max(np.abs(grain))
    noisy = 1 - smoothstep(4, 30, rate)
    train = pulses * (noisy * (0.35 + 0.65 * grain) + (1 - noisy)) * smoothstep(3, 8, rate)
    # the first beats of the spin-up are still heartbeats, quickening; the train takes over
    ticks = t_all[1:][np.diff(np.floor(phi)) > 0]
    for at in ticks[(ticks > s2 + 0.05) & (ticks < land)]:
        f = rate[int(at * SR)]
        g = 1 - smoothstep(4, 11, f)
        if g > 0.02:
            heartbeat(at, g * (0.95 - 0.25 * smoothstep(1.5, 6, f)))
    tone = np.sin(2 * np.pi * phi) + 0.32 * np.sin(4 * np.pi * phi) + 0.12 * np.sin(6 * np.pi * phi)
    to_tone = smoothstep(180, 700, rate)
    voice = train * (1 - to_tone) + tone * 0.55 * to_tone
    voice = voice - lowpass(voice, 25, 1)                     # no DC from the pulse train
    active = smoothstep(s2 - 0.03, s2, t_all) * (1 - smoothstep(T['s3'] + 0.05, T['s3'] + 0.7, t_all))
    swell = 0.45 + 0.55 * smoothstep(s2 + 0.8, land, t_all)
    mix.add(voice * active * swell, 0, 0.5, 0, 0.3)
    # tension under it: a noise riser and a sub swell that land with the note
    mix.add(riser(land - s2 - 0.4, 200, 5200), s2 + 0.4, 0.1, 0, 0.4)
    tt = seconds(land - s2 + 0.8)
    sub_f = pitch(-36) * 2 ** (np.clip(tt / (land - s2), 0, 1) - 1)
    mix.add(np.sin(phase_of(sub_f)) * smoothstep(0, land - s2, tt) ** 2 * (1 - smoothstep(land - s2, land - s2 + 0.8, tt)), s2, 0.18, 0, 0.1)
    # the landing: a bell on the pulsar's own note
    for s, g in ((0, 0.16), (12, 0.07), (19, 0.03)):
        mix.add(pluck(pitch(s), 2.4, 0.9, 0.6), land, g, 0, 0.7)
    # a soft sub-octave under the note once it lands, and the note carrying on into the galaxy
    sub = np.sin(np.pi * phi) * smoothstep(land - 0.3, land + 0.2, t_all) * (1 - smoothstep(T['s3'] + 0.2, T['s3'] + 1.6, t_all))
    mix.add(sub, 0, 0.08, 0, 0.3)
    carry = np.sin(2 * np.pi * phi) * smoothstep(T['s3'] + 0.3, T['s3'] + 0.9, t_all) * (1 - smoothstep(T['s3'] + 1.2, T['s4'], t_all))
    mix.add(carry, 0, 0.1, 0, 0.6)
    # tuning across the dial: a swell of static and a soft ping as it passes each station
    for st in cues['stations']:
        at = st['t']
        mix.add(bandpass(rng.standard_normal(int(0.12 * SR)), 1500, 6000) * np.hanning(int(0.12 * SR)), at - 0.06, 0.05, rng.uniform(-0.5, 0.5), 0.2)
        mix.add(pluck(pitch(pentatonic(st['f']) - 12), 0.4, 0.09, 0.4), at, 0.05, 0.4, 0.4)

    # 03: out to the galaxy. A whoosh and a drop, then the first chord: F, built
    # on the pulsar's own note.
    mix.add(whoosh(0.9, 180, 5000, 0.8, 0.6), T['s3'] - 0.1, 0.28, 0, 0.35)
    mix.add(thump(55, 28, 2.0, 0.6), T['s3'] + 0.34, 0.9, 0, 0.3)
    beat = 0.4
    chords = [
        (T['s3'] + 0.3, T['s4'] + 0.35, [-36, -29, -20, -13, -10, -5]),     # Fmaj9
        (T['s4'], T['s5'] + 0.3, [-39, -32, -24, -17, -13, -8]),            # Dm9
        (T['s5'], T['s6'] + 0.3, [-43, -36, -27, -20, -17, -13]),           # Bbmaj9(#11)
        (T['s6'], DURATION + 1.2, [-48, -41, -36, -29, -20, -10, -5]),      # F(add9)
    ]
    for a, b, notes in chords:
        mix.add(pad(notes, b - a + 1.2, 0.35, 1.2, 2200, 1.0), a, 0.55, 0, 0.55)
    # the pulsars light up as a run of plucks, each one its spin rate folded by octaves into a
    # note of the F pentatonic
    for p in cues['galaxyPops']:
        mix.add(pluck(pitch(pentatonic(p['f']) - (0 if p['f'] < 30 else 12)), 1.0, 0.35, 0.7), p['t'], 0.16, rng.uniform(-0.6, 0.6), 0.5)
    mix.add(riser(1.1, 600, 6000), cues['arcs'][0], 0.07, 0, 0.5)
    mix.add(whoosh(0.6, 3000, 200, 0.7, 1.0), T['edge'], 0.2, 0, 0.3)

    # 04: CP 1919's pulses arrive faster and faster (each a telescope pulse with
    # its two components), then fold into the clock.
    cp1919 = ((-0.0055 * 1.337, 0.85), (0.0055 * 1.337, 1.0))
    for k, at in enumerate(cues['stack']):
        g = 0.22 * (0.5 + 0.5 * k / len(cues['stack']))
        mix.add(telescope_pulse(0.07, 0.0025, cp1919, 0.7), at - 0.02, g, 0.3 * np.sin(k * 1.7), 0.25)
    mix.add(riser(0.62, 800, 5000), cues['fold'][0] - 0.05, 0.08, 0, 0.5)
    mix.add(whoosh(0.7, 4000, 300, 0.6, 1.0), cues['fold'][0], 0.14, 0, 0.4)
    for at in cues['clockTicks']:
        mix.add(click(0.0005, 0.03, 4200), at, 0.3, 0.2, 0.4)
        mix.add(pluck(pitch(0), 1.4, 0.5, 0.2), at, 0.1, 0.2, 0.7)

    # the pulse under the music: a soft kick on the beat, a tick on the off-beat
    kick_times = [T['s4'] + k * beat for k in range(0, 6)] + [T['s5'] + k * beat for k in range(0, 6)]
    for i, at in enumerate(kick_times):
        mix.add(thump(74, 46, 0.4, 0.11), at, 0.35 if i % 3 else 0.5, 0, 0.1)
    for k in range(int((T['s6'] - T['s3'] - 0.6) / (beat / 2))):
        at = T['s3'] + 0.6 + k * beat / 2
        if T['s5'] - 0.3 < at < T['s5'] + 0.05:
            continue
        mix.add(click(0.0004, 0.02, 5200), at, 0.05 if k % 2 else 0.09, -0.4 if k % 2 else 0.4, 0.15)

    # 05: supernova, starquake, the sky
    mix.add(riser(0.5, 200, 3000), T['s5'] - 0.5, 0.12, 0, 0.4)
    mix.add(boom(3.0), T['s5'], 0.85, 0, 0.45)
    bass = [(T['s5'], -43), (T['glitch'], -46), (T['sky'], -41)]
    for at, s in bass:
        tt = seconds(0.8)
        mix.add(np.sin(2 * np.pi * pitch(s) * tt) * np.exp(-tt / 0.5) * np.minimum(1, tt / 0.01), at, 0.35, 0, 0.1)
    # Vela ticks along at 11.2 a second, a motorboat flutter; the glitch jolts it faster
    vela = ((-0.008 * 0.089, 0.2), (0.0, 1.0), (0.011 * 0.089, 0.4))
    for at in cues['velaTicks']:
        mix.add(telescope_pulse(0.05, 0.0018, vela, 0.8), at - 0.02, 0.2, -0.15, 0.2)
    q = T['quake']
    crunch = bandpass(rng.standard_normal(int(0.35 * SR)), 200, 8000)
    crunch = np.round(crunch * 3) / 3 * np.exp(-seconds(0.35) / 0.08)       # bit-crushed crack
    mix.add(crunch, q, 0.32, 0, 0.3)
    tz = seconds(0.4)
    zap = np.sin(phase_of(3000 * np.exp(-tz / 0.05) + 180)) * np.exp(-tz / 0.12)
    mix.add(zap, q, 0.18, 0.2, 0.4)
    mix.add(thump(48, 26, 1.2, 0.35), q, 0.7, 0, 0.3)
    mix.add(shimmer(0.9, [0, 2, 4, 7, 9, 12, 14], 22, 7), T['sky'] + 0.02, 0.09, 0, 0.6)
    mix.add(pluck(pitch(0), 1.2, 0.6, 0.4), cues['crab'], 0.14, 0.3, 0.6)

    # 06: the mark spins down, a ping at every turn, falling in pitch; the title
    # tunes in; the last heartbeat closes the loop.
    mix.add(whoosh(0.5, 400, 6000, 0.8, 0.8), T['s6'] - 0.25, 0.12, 0, 0.4)
    for k, at in enumerate(cues['markTicks']):
        mix.add(pluck(pitch([12, 7, 4, 2, 0][min(k, 4)]), 0.9, 0.3, 0.8), at, 0.22, 0.3 * (-1) ** k, 0.55)
        mix.add(click(0.0005, 0.02, 3800), at, 0.18, 0, 0.3)
    for k, at in enumerate(cues['letters']):
        mix.add(click(0.0004, 0.02, 2500 + 150 * k), at, 0.1, -0.6 + 1.2 * k / 11, 0.3)
    typing = np.linspace(cues['url'][0], cues['url'][1], 14)
    for k, at in enumerate(typing):
        mix.add(click(0.0003, 0.015, 3400 + 60 * k), at, 0.018, 0.2, 0.2)
    tt = seconds(2.6)
    note = np.sin(2 * np.pi * F5 * tt) * np.exp(-tt / 1.4) * np.minimum(1, tt / 0.02)
    mix.add(note, T['s6'] + 0.9, 0.05, 0, 0.7)

    # master: reverb, a gentle fade at the loop point, a soft limiter
    out = mix.dry + reverb(mix.send) * 0.55
    # below 60 Hz only the sub should speak, and nothing below 28 Hz at all
    shelf = lambda f: (1 / np.sqrt(1 + (28 / np.maximum(f, 1e-3)) ** 4)) * (1 - 0.55 / (1 + (f / 60) ** 4))
    out = np.stack([spectral(out[0], shelf), spectral(out[1], shelf)])
    fade = 1 - smoothstep(DURATION - 0.28, DURATION - 0.01, t_all)
    fade_in = smoothstep(0.0, 0.03, t_all)
    out *= fade * fade_in
    peak = np.max(np.abs(out))
    out = out / peak * 1.25
    out = np.tanh(out) / np.tanh(1.25) * 10 ** (-1.0 / 20)
    pcm = (np.clip(out, -1, 1) * 32767).astype('<i2').T.copy()
    with wave.open(out_path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f'{out_path}: {DURATION:.1f} s, peak {20 * np.log10(np.max(np.abs(out))):.1f} dBFS')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
