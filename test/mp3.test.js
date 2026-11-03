import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { encodeMp3 } from '../src/mix.js';

// Load the vendored browser build exactly as the page does.
const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../vendor/lame.min.js', import.meta.url), 'utf8'), ctx);

function sine(seconds, channels) {
  const sr = 44100, n = seconds * sr;
  const data = [...Array(channels)].map(() => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr); return a; });
  return { numberOfChannels: channels, sampleRate: sr, getChannelData: (c) => data[c] };
}

for (const ch of [1, 2]) {
  test(`encodes ${ch === 1 ? 'mono' : 'stereo'} to MP3 frames`, async () => {
    const blob = await encodeMp3(sine(3, ch), 128, () => {}, ctx.lamejs);
    const b = new Uint8Array(await blob.arrayBuffer());
    assert.equal(b[0], 0xff);
    assert.equal(b[1] & 0xe0, 0xe0, 'starts with an MPEG frame sync');
    const kb = b.length / 1024;
    assert.ok(kb > 40 && kb < 60, `about 47 KB for 3 s at 128 kbps, got ${kb.toFixed(1)}`);
  });
}
