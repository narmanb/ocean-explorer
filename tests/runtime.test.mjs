import test from 'node:test';
import assert from 'node:assert/strict';
import { targetSize, bloomLevels, summarizeSamples } from '../js/runtime.js';

test('resolution preserves aspect and stays inside adapter limits', () => {
  assert.deepEqual(targetSize(749,360,1,1,8192), [749,360]);
  assert.deepEqual(targetSize(749,360,1,0.65,8192), [487,234]);
  assert.deepEqual(targetSize(4000,2000,3,2,8192), [8192,4096]);
  assert.deepEqual(targetSize(800,600,1,1,8192,-1,NaN), [800,600]);
  assert.deepEqual(targetSize(800,600,1,1,8192,320,200), [320,200]);
});
test('small targets allocate only legal bloom mips', () => {
  assert.equal(bloomLevels(749,360),8);
  assert.equal(bloomLevels(160,120),7);
  assert.equal(bloomLevels(1,1),1);
});
test('statistics include long frames and report percentiles honestly', () => {
  const s=summarizeSamples([10,20,30,400]);
  assert.equal(s.frames,4); assert.equal(s.fps,1000/115);
  assert.equal(s.p50Ms,20); assert.equal(s.p95Ms,400);
  assert.equal(summarizeSamples([]),null);
});
