// Offline mixing (Web Audio) and MP3 encoding (lamejs, loaded as a global from vendor/).
import { dbToGain, duckIntervals, leadTime } from './plan.js';

/**
 * Render the full mix.
 * slots: from layoutTracks, with .buf added. cues: [{t, buf}]. o: mix options.
 */
export async function mixDown(slots, cues, o, dur) {
  const sr = 44100, ch = o.mono ? 1 : 2;
  const off = new OfflineAudioContext(ch, Math.ceil(dur * sr), sr);

  const master = off.createGain();
  if (o.limit) {
    const c = off.createDynamicsCompressor();
    c.threshold.value = -4; c.knee.value = 2; c.ratio.value = 20; c.attack.value = 0.002; c.release.value = 0.15;
    master.connect(c); c.connect(off.destination);
  } else master.connect(off.destination);

  // Music: each track with its own crossfade gain, into one bus that ducks.
  const musicIn = off.createGain(), duckGain = off.createGain();
  let node = musicIn;
  if (o.bone) { // deep bass buzzes on bone-conduction pads and eats headroom
    const hp = off.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90; hp.Q.value = 0.7;
    musicIn.connect(hp); node = hp;
  }
  node.connect(duckGain); duckGain.connect(master);
  for (const s of slots) {
    const src = off.createBufferSource(); src.buffer = s.buf;
    const g = off.createGain(), G = g.gain;
    G.setValueAtTime(s.fadeIn ? 0 : 1, s.start);
    if (s.fadeIn) G.linearRampToValueAtTime(1, s.start + s.fadeIn);
    if (s.fadeOut) { G.setValueAtTime(1, s.end - s.fadeOut); G.linearRampToValueAtTime(0, s.end); }
    src.connect(g); g.connect(musicIn); src.start(s.start);
  }

  const G = duckGain.gain, d = dbToGain(o.duck);
  G.setValueAtTime(1, 0);
  for (const i of duckIntervals(cues.map((c) => ({ t: c.t, len: c.buf.duration })), o, dur)) {
    const s = Math.max(0, i.a - o.fdown);
    G.setValueAtTime(1, s);
    G.linearRampToValueAtTime(d, Math.max(i.a, s + 0.01));
    G.setValueAtTime(d, i.b);
    G.linearRampToValueAtTime(1, i.b + o.fup);
  }

  // Voice: high-pass and a presence lift around 3 kHz for intelligibility.
  const vbus = off.createGain(); vbus.gain.value = dbToGain(o.boost);
  let vin = vbus;
  if (o.bone) {
    const hp = off.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 160;
    const pk = off.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 3000; pk.Q.value = 0.9; pk.gain.value = 5;
    hp.connect(pk); pk.connect(vbus); vin = hp;
  }
  vbus.connect(master);
  for (const c of cues) {
    if (c.t >= dur) continue;
    const s = off.createBufferSource(); s.buffer = c.buf; s.connect(vin); s.start(c.t);
    if (o.chime && leadTime(o) >= 0.55) {
      for (const [f, t0, len] of [[880, c.t - 0.55, 0.12], [1320, c.t - 0.36, 0.16]]) {
        if (t0 < 0) continue;
        const os = off.createOscillator(); os.frequency.value = f;
        const eg = off.createGain();
        eg.gain.setValueAtTime(0, t0); eg.gain.linearRampToValueAtTime(0.35, t0 + 0.01);
        eg.gain.exponentialRampToValueAtTime(0.001, t0 + len);
        os.connect(eg); eg.connect(master); os.start(t0); os.stop(t0 + len + 0.02);
      }
    }
  }

  const buf = await new Promise((res, rej) => {
    off.oncomplete = (e) => res(e.renderedBuffer);
    const p = off.startRendering();
    if (p && p.then) p.then(res, rej);
  });

  if (o.limit) normalise(buf, 0.89); // about −1 dBFS
  return buf;
}

function normalise(buf, target) {
  let pk = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const a = buf.getChannelData(c);
    for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > pk) pk = v; }
  }
  if (!pk) return;
  const k = target / pk;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const a = buf.getChannelData(c);
    for (let i = 0; i < a.length; i++) a[i] *= k;
  }
}

const toInt16 = (src, i, m) => {
  const a = new Int16Array(m);
  for (let j = 0; j < m; j++) {
    let s = src[i + j]; s = s < -1 ? -1 : s > 1 ? 1 : s;
    a[j] = s < 0 ? s * 32768 : s * 32767;
  }
  return a;
};

/** Encode an AudioBuffer-like {numberOfChannels, sampleRate, getChannelData} to an MP3 Blob. */
export async function encodeMp3(buf, kbps, onProgress = () => {}, lame = globalThis.lamejs) {
  if (!lame) throw new Error('The MP3 encoder did not load. Reload the page and try again.');
  const ch = buf.numberOfChannels, enc = new lame.Mp3Encoder(ch, buf.sampleRate, kbps);
  const L = buf.getChannelData(0), R = ch > 1 ? buf.getChannelData(1) : null;
  const n = L.length, B = 1152, parts = [];
  const keep = (o) => { if (o && o.length) parts.push(new Uint8Array(o.buffer.slice(o.byteOffset, o.byteOffset + o.length))); };
  let last = Date.now();
  for (let i = 0; i < n; i += B) {
    const m = Math.min(B, n - i);
    keep(R ? enc.encodeBuffer(toInt16(L, i, m), toInt16(R, i, m)) : enc.encodeBuffer(toInt16(L, i, m)));
    if (Date.now() - last > 60) { onProgress(i / n); await new Promise((r) => setTimeout(r)); last = Date.now(); }
  }
  keep(enc.flush());
  onProgress(1);
  return new Blob(parts, { type: 'audio/mpeg' });
}
