import test from 'node:test';
import assert from 'node:assert/strict';
import { fmt, parseTime, layoutTracks, totalDuration, duckIntervals, gainAt, repeatTimes, dbToGain } from '../src/plan.js';

const o = { duck: -18, fdown: 0.6, fup: 1.5, pre: 0.4, chime: false };

test('time formatting and parsing', () => {
  assert.equal(fmt(65), '1:05');
  assert.equal(fmt(3725), '1:02:05');
  assert.equal(parseTime('5'), 300);
  assert.equal(parseTime('1:30'), 90);
  assert.equal(parseTime('1:02:05'), 3725);
  assert.equal(parseTime(''), null);
  assert.equal(parseTime('abc'), null);
  assert.equal(parseTime('-1'), null);
});

test('tracks back to back, with a gap, and crossfaded', () => {
  assert.deepEqual(layoutTracks([200, 180], 0).map((s) => s.start), [0, 200]);
  assert.deepEqual(layoutTracks([200, 180], 2).map((s) => s.start), [0, 202]);
  const x = layoutTracks([200, 180, 4], -3);
  assert.deepEqual(x.map((s) => s.start), [0, 197, 375]);
  assert.equal(x[0].fadeOut, 3);
  assert.equal(x[1].fadeIn, 3);
  assert.equal(x[2].fadeIn, 2, 'crossfade is capped at half the shorter track');
  assert.equal(totalDuration(x), 379);
});

test('ducking spans start early and merge when cues are close', () => {
  const one = duckIntervals([{ t: 60, len: 3 }], o);
  assert.equal(one.length, 1);
  assert.ok(Math.abs(one[0].a - 59.6) < 1e-9);
  const merged = duckIntervals([{ t: 60, len: 3 }, { t: 64, len: 2 }], o);
  assert.equal(merged.length, 1);
  const apart = duckIntervals([{ t: 60, len: 3 }, { t: 120, len: 2 }], o);
  assert.equal(apart.length, 2);
  assert.equal(duckIntervals([{ t: 500, len: 2 }], o, 400).length, 0, 'cues after the end are dropped');
});

test('chime lengthens the head start', () => {
  assert.ok(Math.abs(duckIntervals([{ t: 60, len: 3 }], { ...o, chime: true })[0].a - 59.3) < 1e-9);
});

test('music gain follows the duck envelope', () => {
  const iv = duckIntervals([{ t: 60, len: 3 }], o);
  assert.equal(gainAt(10, iv, o), 1);
  assert.ok(Math.abs(gainAt(61, iv, o) - dbToGain(-18)) < 1e-9);
  assert.equal(gainAt(70, iv, o), 1);
  const mid = gainAt(59.3, iv, o);
  assert.ok(mid < 1 && mid > dbToGain(-18));
});

test('repeat times', () => {
  assert.deepEqual(repeatTimes(120, 300, 1200), [120, 420, 720, 1020]);
  assert.deepEqual(repeatTimes(0, 0, 100), []);
});
