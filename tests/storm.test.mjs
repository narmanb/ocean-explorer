import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SEA, STORM_PRESETS, STORM_CONTROLS, seaBounds, effectiveChop, advanceSea, crossingAngle, surfaceCameraY, updateSurfaceProbe, initializeSurfaceProbe } from '../js/storm.js';

test('all presets are complete, finite, editable sea states within control limits', () => {
  for (const preset of Object.values(STORM_PRESETS)) {
    assert.deepEqual(Object.keys(preset.values).sort(), Object.keys(DEFAULT_SEA).sort());
    for (const [key,, min,max] of STORM_CONTROLS) assert.ok(preset.values[key] >= min && preset.values[key] <= max, key);
  }
  assert.ok(STORM_PRESETS.cinematic.values.swellHs > STORM_PRESETS.severe.values.swellHs);
  assert.ok(STORM_PRESETS.cross.values.swell2Hs > 15);
  assert.equal(STORM_PRESETS.calm.values.storm, 0);
});

test('startup fallback protects both free flight and surface riding when inversion fails', () => {
  const allInvalid={height:0,guard:0,centerValid:false,validCount:0};
  initializeSurfaceProbe(allInvalid,185);
  assert.equal(allInvalid.height,185); assert.equal(allInvalid.guard,185);
  const neighbors={height:0,guard:-19,centerValid:false,validCount:2};
  initializeSurfaceProbe(neighbors,185);
  assert.equal(neighbors.height,-19); assert.equal(neighbors.guard,-19);
  const valid={height:-20,guard:-19,centerValid:true,validCount:4};
  initializeSurfaceProbe(valid,185);
  assert.equal(valid.height,-20); assert.equal(valid.guard,-19);
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

test('camera rejects unconverged height samples and retains the last good surface', () => {
  const state={height:-20,guard:-19,residual:0,rejected:0};
  assert.equal(updateSurfaceProbe(state,new Float32Array([-18,-17,-19,-18,0.001,0.002,0.003,0.001])),true);
  assert.equal(state.height,-18); assert.equal(state.guard,-17);
  assert.equal(updateSurfaceProbe(state,new Float32Array([36,29,29,29,1.98,0.001,0.31,0.001])),false);
  assert.equal(state.height,-18); assert.equal(state.guard,29); assert.equal(state.rejected,2); assert.equal(state.validCount,2);
  assert.ok(state.residual>1.9);
  assert.equal(updateSurfaceProbe(state,new Float32Array([-999,-999,-999,-999,2,3,4,5])),false);
  assert.equal(state.height,-18); assert.equal(state.guard,29); assert.equal(state.rejected,6); assert.equal(state.validCount,0);
  const previous={...state};
  assert.equal(updateSurfaceProbe(state,new Float32Array([NaN,0,0,0,0,0,0,0])),false);
  assert.equal(state.height,previous.height); assert.equal(state.guard,previous.guard);
});
