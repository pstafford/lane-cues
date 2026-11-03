// Pure timing logic: no DOM, no Web Audio. Tested in test/plan.test.js.

export const dbToGain = (db) => Math.pow(10, db / 20);

/** Seconds → "m:ss" (or "h:mm:ss" from an hour). */
export function fmt(t) {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** "m:ss", "h:mm:ss", or a bare number of minutes → seconds. Null if unreadable. */
export function parseTime(str) {
  str = String(str).trim();
  if (!str) return null;
  const p = str.split(':').map(Number);
  if (p.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (p.length === 1) return p[0] * 60;
  if (p.length === 2) return p[0] * 60 + p[1];
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  return null;
}

/**
 * Where each track sits in the mix.
 * `between` > 0 is a silent gap in seconds; < 0 is a crossfade of that length;
 * a crossfade never exceeds half of either neighbouring track.
 * Returns [{track, start, end, fadeIn, fadeOut}].
 */
export function layoutTracks(durations, between) {
  let end = 0, prev = null;
  return durations.map((d, i) => {
    const ov = i === 0 ? 0 : Math.min(Math.max(0, -between), d / 2, durations[i - 1] / 2);
    const start = i === 0 ? 0 : between > 0 ? end + between : end - ov;
    const slot = { track: i, start, end: start + d, fadeIn: ov, fadeOut: 0 };
    if (prev) prev.fadeOut = ov;
    prev = slot;
    end = slot.end;
    return slot;
  });
}

export const totalDuration = (slots) => (slots.length ? slots[slots.length - 1].end : 0);

/** How early the music starts to duck before a voice clip. */
export const leadTime = (o) => (o.chime ? Math.max(o.pre, 0.7) : o.pre);

/**
 * Spans where the music is held down, from cues [{t, len}].
 * Cues close enough that the music would not fully recover between them are merged.
 */
export function duckIntervals(cues, o, dur = Infinity) {
  const pre = leadTime(o);
  const iv = cues
    .filter((c) => c.t < dur)
    .map((c) => ({ a: Math.max(0, c.t - pre), b: Math.min(dur, c.t + c.len + 0.15) }))
    .sort((x, y) => x.a - y.a);
  const out = [];
  for (const i of iv) {
    const p = out[out.length - 1];
    if (p && i.a - o.fdown <= p.b + o.fup) p.b = Math.max(p.b, i.b);
    else out.push({ ...i });
  }
  return out;
}

/** Music gain (linear) at time t, matching the automation the mixer schedules. */
export function gainAt(t, iv, o) {
  const d = dbToGain(o.duck);
  for (const i of iv) {
    const s = Math.max(0, i.a - o.fdown);
    if (t < s) return 1;
    if (t < i.a) return 1 + ((d - 1) * (t - s)) / Math.max(0.01, i.a - s);
    if (t <= i.b) return d;
    if (t < i.b + o.fup) return d + ((1 - d) * (t - i.b)) / o.fup;
  }
  return 1;
}

/** Cue times from `from` to `to` (inclusive) every `every` seconds. */
export function repeatTimes(from, every, to, cap = 500) {
  const out = [];
  if (!(every > 0)) return out;
  for (let t = from; t <= to + 1e-9 && out.length < cap; t += every) out.push(t);
  return out;
}
