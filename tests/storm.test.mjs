import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SEA, STORM_PRESETS, STORM_CONTROLS, seaBounds, effectiveChop, advanceSea, crossingAngle, surfaceCameraY } from '../js/storm.js';

test('all presets are complete, finite, editable sea states within control limits', () => {
  for (const preset of Object.values(STORM_PRESETS)) {
    assert.deepEqual(Object.keys(preset.values).sort(), Object.keys(DEFAULT_SEA).sort());
    for (const [key,, min,max] of STORM_CONTROLS) assert.ok(preset.values[key] >= min && preset.values[key] <= max, key);
  }
  assert.ok(STORM_PRESETS.cinematic.values.swellHs > STORM_PRESETS.severe.values.swellHs);
  assert.ok(STORM_PRESETS.cross.values.swell2Hs > 15);
  assert.equal(STORM_PRESETS.calm.values.storm, 0);
});
test('crossing angles take shortest arc, including wraparound', () => {
  assert.equal(crossingAngle(350,10),20); assert.equal(crossingAngle(10,350),-20);
});
test('transitions remain finite and continuous across heading wrap and large sea changes', () => {
  const current={...STORM_PRESETS.calm.values,swellDir:359};
  const target={...STORM_PRESETS.cinematic.values,swellDir:1};
  advanceSea(current,target,1/60);
  assert.ok(current.swellHs > 0 && current.swellHs < target.swellHs);
  assert.ok(current.swellDir > 359 || current.swellDir < 1);
  for(let i=0;i<1800;i++) advanceSea(current,target,1/60);
  assert.ok(Math.abs(current.swellHs-target.swellHs)<0.001);
  assert.ok(Object.values(current).every(Number.isFinite));
});
test('storm culling bounds grow and steep short swell reduces horizontal chop', () => {
  const calm=seaBounds(STORM_PRESETS.calm.values), extreme=seaBounds(STORM_PRESETS.cinematic.values);
  assert.ok(extreme.height > calm.height * 10); assert.ok(extreme.horizontal > 20);
  const short={...STORM_PRESETS.cinematic.values,swellHs:48,swellLength:40,swell2Length:40};
  assert.ok(effectiveChop(short)<effectiveChop(STORM_PRESETS.cinematic.values));
});
test('surface camera can descend below mean sea level without entering sampled water', () => {
  const y=surfaceCameraY(-8,-20,-19,3,1/60);
  assert.ok(y < -8); assert.ok(y >= -18.2);
  assert.ok(surfaceCameraY(-20,12,13,3,1/60)>=13.8);
});
