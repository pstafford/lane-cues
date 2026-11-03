import { fmt, parseTime, layoutTracks, totalDuration, duckIntervals, gainAt, repeatTimes } from './plan.js';
import { mixDown, encodeMp3 } from './mix.js';

const $ = (id) => document.getElementById(id);
const S = { tracks: [], clips: [], cues: [], peakMax: 1, rendered: null, ac: null, src: null, clipSrc: null, playT0: 0, playing: false, raf: 0 };
let uid = 1;
S.cues = [{ id: uid++, t: 60, clip: null, example: true }, { id: uid++, t: 300, clip: null, example: true }];

/* ---------- helpers ---------- */
function ac() { if (!S.ac) S.ac = new (window.AudioContext || window.webkitAudioContext)(); return S.ac; }
async function decode(file) {
  const ab = await file.arrayBuffer();
  return await new Promise((res, rej) => { const p = ac().decodeAudioData(ab, res, rej); if (p && p.catch) p.catch(rej); });
}
const baseName = (f) => f.name.replace(/\.[^.]+$/, '');
function status(msg, cls = '') { const el = $('status'); el.textContent = msg; el.className = 'status ' + cls; }
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
function stale() {
  if (S.rendered) { S.rendered = null; stop(); status('Changed since the last mix. Mix again to hear it.'); }
  refreshButtons(); draw();
}

/* ---------- settings ---------- */
const SETS = ['duck', 'boost', 'fdown', 'fup', 'pre', 'kbps', 'bone', 'mono', 'limit', 'chime', 'xfade'];
function opts() {
  return {
    xfade: +$('xfade').value, duck: +$('duck').value, boost: +$('boost').value, fdown: +$('fdown').value, fup: +$('fup').value,
    pre: +$('pre').value, kbps: +$('kbps').value, bone: $('bone').checked, mono: $('mono').checked, limit: $('limit').checked, chime: $('chime').checked,
  };
}
function readouts() {
  const o = opts();
  $('duckV').textContent = o.duck + ' dB';
  $('boostV').textContent = (o.boost > 0 ? '+' : '') + o.boost + ' dB';
  $('fdownV').textContent = o.fdown.toFixed(1) + ' s';
  $('fupV').textContent = o.fup.toFixed(1) + ' s';
  $('preV').textContent = o.pre.toFixed(1) + ' s';
  $('kbpsV').textContent = o.kbps;
}
try {
  const saved = JSON.parse(localStorage.getItem('lanecues.sets') || 'null');
  if (saved) SETS.forEach((k) => { if (k in saved) { const e = $(k); if (e.type === 'checkbox') e.checked = saved[k]; else e.value = saved[k]; } });
} catch (e) { /* storage unavailable */ }
SETS.forEach((k) => $(k).addEventListener(k === 'xfade' || k === 'kbps' ? 'change' : 'input', () => {
  readouts();
  if (k === 'xfade') { renderTracks(); renderCues(); }
  try { localStorage.setItem('lanecues.sets', JSON.stringify(opts())); } catch (e) { /* ignore */ }
  if (k !== 'kbps') stale();
}));
$('resetSets').onclick = () => {
  SETS.forEach((k) => { const e = $(k); if (e.type === 'checkbox') e.checked = e.defaultChecked; else if (e.tagName === 'SELECT') e.value = [...e.options].find((o) => o.defaultSelected)?.value ?? e.value; else e.value = e.defaultValue; });
  try { localStorage.removeItem('lanecues.sets'); } catch (e) { /* ignore */ }
  readouts(); renderTracks(); renderCues(); stale();
};
readouts();

/* ---------- music playlist ---------- */
function peaks(buf, n) {
  const ch = buf.numberOfChannels, len = buf.length, out = new Float32Array(n), step = len / n;
  const d = [...Array(ch)].map((_, i) => buf.getChannelData(i));
  for (let i = 0; i < n; i++) {
    let m = 0; const a = Math.floor(i * step), b = Math.min(len, Math.floor((i + 1) * step));
    for (let j = a; j < b; j += 16) for (let c = 0; c < ch; c++) { const v = Math.abs(d[c][j]); if (v > m) m = v; }
    out[i] = m;
  }
  return out;
}
const layout = () => layoutTracks(S.tracks.map((k) => k.buf.duration), +$('xfade').value).map((s) => ({ ...s, k: S.tracks[s.track], buf: S.tracks[s.track].buf }));
const musicDur = () => totalDuration(layout());
const mixName = () => (S.tracks.length === 1 ? S.tracks[0].name : 'Swim mix');

async function addMusic(files) {
  const bad = [];
  for (const f of files) {
    $('musicMeta').textContent = 'Reading ' + f.name + '…';
    try { const buf = await decode(f); S.tracks.push({ id: uid++, name: baseName(f), buf, peaks: peaks(buf, Math.max(200, Math.ceil(buf.duration * 2))) }); }
    catch (err) { bad.push(f.name); }
  }
  if (bad.length) status("Couldn't read " + bad.join(', ') + '. Try MP3, M4A or WAV.', 'err');
  renderTracks(); renderCues(); stale();
}
$('musicIn').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; addMusic(f); });

function renderTracks() {
  S.peakMax = Math.max(1e-6, ...S.tracks.map((k) => k.peaks.reduce((a, b) => (a > b ? a : b), 0)));
  const ul = $('trackList'); ul.innerHTML = '';
  layout().forEach((l, i) => {
    const li = el('li');
    const mv = el('div', { className: 'move' });
    [['↑', -1, 'Move up'], ['↓', 1, 'Move down']].forEach(([s, dir, lab]) => {
      const b = el('button', { type: 'button', className: 'ghost', textContent: s });
      b.setAttribute('aria-label', lab + ' ' + l.k.name);
      b.disabled = i + dir < 0 || i + dir >= S.tracks.length;
      b.onclick = () => { const a = S.tracks; [a[i], a[i + dir]] = [a[i + dir], a[i]]; renderTracks(); renderCues(); stale(); };
      mv.append(b);
    });
    const st = el('span', { className: 't start', textContent: fmt(l.start) });
    const name = el('div', { className: 'grow', textContent: l.k.name });
    const dur = el('span', { className: 't meta', textContent: fmt(l.k.buf.duration) });
    const del = el('button', { type: 'button', className: 'ghost', textContent: 'Remove' });
    del.onclick = () => { S.tracks = S.tracks.filter((x) => x !== l.k); renderTracks(); renderCues(); stale(); };
    li.append(mv, st, name, dur, del); ul.append(li);
  });
  $('xfadeRow').hidden = S.tracks.length < 2;
  const m = $('musicMeta');
  if (!S.tracks.length) m.textContent = 'No tracks yet. Add one long mix or several songs; they play in the order listed.';
  else {
    m.innerHTML = '';
    m.append(el('b', { textContent: `${S.tracks.length} track${S.tracks.length === 1 ? '' : 's'}` }), ' · total ', el('span', { className: 't', textContent: fmt(musicDur()) }));
  }
}

/* ---------- voice clips ---------- */
async function addClips(files) {
  for (const f of files) {
    try { const buf = await decode(f); S.clips.push({ id: uid++, name: baseName(f), buf }); }
    catch (err) { status("Couldn't read " + f.name + '.', 'err'); }
  }
  const first = S.clips[0];
  if (first) S.cues.forEach((c) => { if (c.example) { c.clip = first.id; c.example = false; } else if (!c.clip) c.clip = first.id; });
  renderClips(); renderCues(); stale();
}
$('clipIn').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; addClips(f); });

function previewBuf(buf) { stop(); if (ac().state === 'suspended') ac().resume(); const s = ac().createBufferSource(); s.buffer = buf; s.connect(ac().destination); s.start(); S.clipSrc = s; }
function renderClips() {
  const ul = $('clipList'); ul.innerHTML = '';
  S.clips.forEach((c) => {
    const li = el('li');
    const play = el('button', { type: 'button', className: 'small', textContent: '▶' });
    play.setAttribute('aria-label', 'Play ' + c.name);
    play.onclick = () => previewBuf(c.buf);
    const name = el('div', { className: 'grow', textContent: c.name });
    const dur = el('span', { className: 't meta', textContent: c.buf.duration.toFixed(1) + ' s' });
    const del = el('button', { type: 'button', className: 'ghost', textContent: 'Remove' });
    del.onclick = () => { S.clips = S.clips.filter((x) => x !== c); S.cues.forEach((q) => { if (q.clip === c.id) q.clip = S.clips[0]?.id ?? null; }); renderClips(); renderCues(); stale(); };
    li.append(play, name, dur, del); ul.append(li);
  });
  const sel = $('repClip'); sel.innerHTML = '';
  S.clips.forEach((c) => sel.append(new Option(c.name, c.id)));
  if (!S.clips.length) sel.append(new Option('Add a clip first', ''));
}

/* ---------- cues ---------- */
const clipById = (id) => S.clips.find((c) => c.id === id);
function renderCues() {
  S.cues.sort((a, b) => a.t - b.t);
  const box = $('cueList'); box.innerHTML = '';
  const dur = musicDur();
  S.cues.forEach((q) => {
    const row = el('div', { className: 'cue-row' + (q.example ? ' example' : '') });
    const tin = el('input', { type: 'text', value: fmt(q.t), id: 'cue-t-' + q.id, inputMode: 'numeric' });
    tin.setAttribute('aria-label', 'Cue time');
    tin.addEventListener('change', () => { const v = parseTime(tin.value); if (v == null) { tin.value = fmt(q.t); return; } q.t = v; renderCues(); stale(); });
    const right = el('div', { className: 'cue-right' });
    if (q.example) right.append(el('span', { className: 'meta', textContent: 'Example cue. Add a voice clip to use it.' }));
    else {
      const sel = el('select', { id: 'cue-c-' + q.id }); sel.setAttribute('aria-label', 'Voice clip');
      S.clips.forEach((c) => sel.append(new Option(c.name, c.id)));
      if (!S.clips.length) sel.append(new Option('No clips yet', ''));
      sel.value = q.clip ?? ''; sel.onchange = () => { q.clip = +sel.value; stale(); };
      right.append(sel);
      if (S.tracks.length && q.t >= dur) right.append(el('span', { className: 'badge warn', textContent: 'After the music ends' }));
    }
    const del = el('button', { type: 'button', className: 'ghost', textContent: '✕' });
    del.setAttribute('aria-label', 'Remove cue at ' + fmt(q.t));
    del.onclick = () => { S.cues = S.cues.filter((x) => x !== q); renderCues(); stale(); };
    row.append(tin, right, del); box.append(row);
  });
  renderJumps();
}
$('addCue').onclick = () => {
  const last = S.cues.length ? S.cues[S.cues.length - 1].t : 0;
  S.cues.push({ id: uid++, t: S.cues.length ? last + 60 : 60, clip: S.clips[0]?.id ?? null, example: !S.clips.length });
  renderCues(); stale();
};
$('repAdd').onclick = () => {
  const clip = +$('repClip').value;
  if (!clip) { status('Add a voice clip first.', 'err'); return; }
  const from = parseTime($('repFrom').value), every = parseFloat($('repEvery').value) * 60;
  const end = parseTime($('repTo').value) ?? (S.tracks.length ? musicDur() - 1 : null);
  if (from == null || !(every > 0)) { status('Check the repeat times.', 'err'); return; }
  if (end == null) { status('Add music or set an end time.', 'err'); return; }
  const ts = repeatTimes(from, every, end);
  ts.forEach((t) => S.cues.push({ id: uid++, t, clip, example: false }));
  S.cues = S.cues.filter((c) => !c.example);
  status(`Added ${ts.length} cue${ts.length === 1 ? '' : 's'}.`, 'ok');
  renderCues(); stale();
};
const activeCues = () => S.cues.filter((q) => !q.example && clipById(q.clip)).map((q) => ({ t: q.t, buf: clipById(q.clip).buf }));
const intervals = (o) => duckIntervals(activeCues().map((c) => ({ t: c.t, len: c.buf.duration })), o, S.tracks.length ? musicDur() : Infinity);

/* ---------- mix ---------- */
$('renderBtn').onclick = async () => {
  if (!S.tracks.length) return;
  stop(); $('renderBtn').disabled = true; status('Mixing…');
  try {
    const t0 = performance.now(), dur = musicDur();
    S.rendered = await mixDown(layout(), activeCues(), opts(), dur);
    const n = activeCues().filter((c) => c.t < dur).length;
    status(`Mixed ${fmt(dur)} with ${n} cue${n === 1 ? '' : 's'} in ${((performance.now() - t0) / 1000).toFixed(1)} s. Tap the timeline or a cue to listen.`, 'ok');
  } catch (err) { status('Mixing failed: ' + err.message, 'err'); }
  refreshButtons(); draw();
};

/* ---------- playback ---------- */
function stop() {
  if (S.src) { try { S.src.stop(); } catch (e) { /* already stopped */ } S.src = null; }
  if (S.clipSrc) { try { S.clipSrc.stop(); } catch (e) { /* already stopped */ } S.clipSrc = null; }
  S.playing = false; cancelAnimationFrame(S.raf); $('playBtn').textContent = 'Play'; draw();
}
function playFrom(t) {
  if (!S.rendered) return;
  stop(); if (ac().state === 'suspended') ac().resume();
  const s = ac().createBufferSource(); s.buffer = S.rendered; s.connect(ac().destination); s.start(0, Math.max(0, t));
  s.onended = () => { if (S.src === s) stop(); };
  S.src = s; S.playT0 = ac().currentTime - Math.max(0, t); S.playing = true; $('playBtn').textContent = 'Stop';
  const tick = () => { draw(); if (S.playing) S.raf = requestAnimationFrame(tick); };
  tick();
}
$('playBtn').onclick = () => (S.playing ? stop() : playFrom(0));
function renderJumps() {
  const j = $('jump'); j.innerHTML = '';
  S.cues.filter((q) => !q.example).slice(0, 60).forEach((q) => {
    const b = el('button', { type: 'button', title: 'Play from 5 s before this cue' });
    b.append(el('span', { className: 't', textContent: fmt(q.t) }));
    b.onclick = () => (S.rendered ? playFrom(q.t - 5) : status('Mix it first, then jump to any cue.'));
    j.append(b);
  });
}

/* ---------- timeline ---------- */
const cv = $('tl');
function draw() {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (!w) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
  const o = opts(), lay = layout();
  const dur = lay.length ? totalDuration(lay) : Math.max(600, ...S.cues.map((c) => c.t + 60));
  const top = 22, bot = h - 20, mid = (top + bot) / 2, amp = (bot - top) / 2, X = (t) => (t / dur) * w;
  const iv = intervals(o);
  const labelFont = '600 12px "Barlow Condensed", system-ui, sans-serif';
  x.font = labelFont;

  const steps = [15, 30, 60, 120, 300, 600, 900, 1800];
  const step = steps.find((s) => dur / s <= 8) || 3600;
  for (let t = 0; t <= dur; t += step) {
    const px = Math.round(X(t)) + 0.5;
    x.strokeStyle = css('--line'); x.lineWidth = 1; x.beginPath(); x.moveTo(px, top); x.lineTo(px, bot); x.stroke();
    x.fillStyle = css('--muted'); x.textAlign = t === 0 ? 'left' : 'center';
    if (px < w - 18) x.fillText(fmt(t), t === 0 ? 4 : px, h - 5);
  }

  if (lay.length) {
    x.strokeStyle = css('--muted'); x.setLineDash([3, 4]);
    lay.slice(1).forEach((l) => { const px = Math.round(X(l.start)) + 0.5; x.beginPath(); x.moveTo(px, top); x.lineTo(px, bot); x.stroke(); });
    x.setLineDash([]);
    const wave = css('--wave'), waveOn = css('--wave-on');
    for (let px = 0; px < w; px += 2) {
      const t = (px / w) * dur; let pv = 0;
      for (const l of lay) {
        if (t < l.start || t >= l.end) continue;
        const k = l.k, n = k.peaks.length, i = Math.min(n - 1, Math.floor(((t - l.start) / k.buf.duration) * n));
        let f = 1;
        if (l.fadeIn && t < l.start + l.fadeIn) f = (t - l.start) / l.fadeIn;
        if (l.fadeOut && t > l.end - l.fadeOut) f = Math.min(f, (l.end - t) / l.fadeOut);
        pv = Math.max(pv, k.peaks[i] * f);
      }
      const p = Math.min(1, pv / S.peakMax) * amp * 0.95, g = gainAt(t, iv, o);
      x.fillStyle = wave; x.fillRect(px, mid - p, 1.4, p * 2);
      x.fillStyle = waveOn; x.fillRect(px, mid - p * g, 1.4, p * g * 2);
    }
  } else {
    x.fillStyle = css('--muted'); x.textAlign = 'center';
    x.font = '400 14px "Atkinson Hyperlegible", system-ui, sans-serif';
    x.fillText('Add music to see the track here', w / 2, mid + 5);
    x.font = labelFont;
  }

  S.cues.forEach((q) => {
    if (q.t > dur) return;
    const px = X(q.t), c = clipById(q.clip), len = c ? c.buf.duration : 4;
    x.fillStyle = css('--cue-soft'); x.fillRect(px, top, Math.max(2, X(len)), bot - top);
    x.fillStyle = css('--cue'); x.fillRect(Math.round(px) - 1, top - 4, 2, bot - top + 4);
    x.beginPath(); x.moveTo(px - 5, top - 10); x.lineTo(px + 5, top - 10); x.lineTo(px, top - 3); x.closePath(); x.fill();
    x.fillStyle = css('--ink'); x.textAlign = px > w - 30 ? 'right' : px < 20 ? 'left' : 'center';
    x.fillText(fmt(q.t), Math.min(w - 2, Math.max(2, px)), top - 12);
  });

  if (S.playing) { const px = X(ac().currentTime - S.playT0); x.fillStyle = css('--accent'); x.fillRect(px - 1, top - 6, 2, bot - top + 10); }
}
cv.addEventListener('click', (e) => { if (!S.rendered) return; const r = cv.getBoundingClientRect(); playFrom(((e.clientX - r.left) / r.width) * musicDur()); });
new ResizeObserver(draw).observe(cv);
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', draw);
document.fonts?.ready.then(draw);

function refreshButtons() { $('renderBtn').disabled = !S.tracks.length; $('playBtn').disabled = !S.rendered; $('saveBtn').disabled = !S.rendered; }

/* ---------- save ---------- */
$('saveBtn').onclick = async () => {
  if (!S.rendered) return;
  stop(); $('saveBtn').disabled = true; $('bar').hidden = false; status('Encoding MP3…');
  try {
    const mp3 = await encodeMp3(S.rendered, opts().kbps, (p) => { $('barFill').style.width = (p * 100).toFixed(1) + '%'; status(`Encoding MP3… ${Math.round(p * 100)}%`); });
    const name = `${mixName()} + cues.mp3`;
    const url = URL.createObjectURL(mp3);
    const a = el('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    status(`Saved “${name}” (${(mp3.size / 1048576).toFixed(1)} MB). Check your Downloads folder.`, 'ok');
  } catch (err) { status('Couldn’t save: ' + err.message, 'err'); }
  $('bar').hidden = true; $('barFill').style.width = '0'; refreshButtons();
};

/* ---------- drag and drop ---------- */
for (const [zone, add] of [['musicDrop', addMusic], ['clipDrop', addClips]]) {
  const z = $(zone);
  z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('over'); });
  z.addEventListener('dragleave', () => z.classList.remove('over'));
  z.addEventListener('drop', (e) => { e.preventDefault(); z.classList.remove('over'); add([...e.dataTransfer.files].filter((f) => f.type.startsWith('audio') || /\.(mp3|m4a|wav|aac|ogg|flac)$/i.test(f.name))); });
}

renderTracks(); renderClips(); renderCues(); refreshButtons(); requestAnimationFrame(draw);
