// Sea-state targets. Heights are nominal significant swell heights, not individual crests.
export const DEFAULT_SEA = {
  windSpeed:7, windDir:118, fetchKm:90,
  swellHs:1.8, swellDir:94, swellLength:120, swellSpread:48,
  swell2Hs:0, swell2Dir:185, swell2Length:180, swell2Spread:24,
  peakGamma:6, choppy:1.25, storm:0, mist:0, spray:0,
  turbidity:1.6, foam:1, sunElev:2.6, sunAzim:4,
  exposure:1.35, haze:3, clouds:0.4, veil:0.36, bloom:0.1,
};
export const STORM_CONTROLS = [
  ['storm','Storm intensity',0,1.5,0.01,'spec'],
  ['swell2Hs','Secondary swell height (m)',0,40,0.25,'spec'],
  ['swell2Length','Secondary wavelength (m)',40,700,5,'spec'],
  ['swell2Dir','Secondary direction (deg)',0,360,1,'spec'],
  ['swell2Spread','Secondary concentration',2,96,1,'spec'],
  ['mist','Sea mist',0,1,0.01,''],
  ['spray','Crest spindrift',0,1,0.01,''],
];
const state=(values)=>({...DEFAULT_SEA,...values});
export const STORM_PRESETS = {
  calm:{name:'Calm Ocean',description:'Gentle swells, clear air and open sky.',values:state({windSpeed:3,swellHs:0.5,swellLength:90,choppy:0.7,foam:0.3,sunElev:18,haze:1.4,clouds:0.18,veil:0.12})},
  rough:{name:'Rough Seas',description:'A strong wind sea with broad, heaving swells.',values:state({windSpeed:18,fetchKm:250,swellHs:6,swellLength:170,swellSpread:22,swell2Hs:2,swell2Dir:160,storm:0.24,foam:1.4,mist:0.12,spray:0.15,sunElev:15,haze:3.8,clouds:0.65,veil:0.5,turbidity:0.9})},
  severe:{name:'Severe Storm',description:'Massive storm swells, dense whitecaps and a low, threatening sky.',values:state({windSpeed:32,fetchKm:500,swellHs:20,swellLength:260,swellDir:70,swellSpread:20,swell2Hs:9,swell2Length:170,swell2Dir:155,swell2Spread:16,choppy:1.55,storm:0.7,foam:1.8,mist:0.35,spray:0.55,sunElev:15,sunAzim:-25,haze:4.8,clouds:0.85,veil:0.78,turbidity:0.65,exposure:1.1,bloom:0.06})},
  cross:{name:'Cross Seas',description:'Two independently phased giant swell systems cross at 100°.',values:state({windSpeed:30,windDir:110,fetchKm:450,swellHs:26,swellLength:300,swellDir:55,swellSpread:32,swell2Hs:22,swell2Length:230,swell2Dir:155,swell2Spread:28,choppy:1.55,storm:0.75,foam:1.9,mist:0.3,spray:0.6,sunElev:17,sunAzim:-20,haze:4.4,clouds:0.82,veil:0.76,turbidity:0.65,exposure:1.15,bloom:0.06})},
  cinematic:{name:'Cinematic Extreme',description:'Exaggerated mountains of water. Not a realistic storm forecast.',values:state({windSpeed:45,windDir:110,fetchKm:800,swellHs:40,swellLength:380,swellDir:65,swellSpread:44,swell2Hs:32,swell2Length:280,swell2Dir:170,swell2Spread:36,peakGamma:8,choppy:1.7,storm:1.25,foam:2.2,mist:0.48,spray:0.85,sunElev:18,sunAzim:-20,haze:5.2,clouds:0.9,veil:0.86,turbidity:0.55,exposure:1.2,bloom:0.07})},
  original:{name:'Original Sunset',description:'The original modest sea and sunset lighting.',values:state({})},
};
const SEA_KEYS=Object.keys(DEFAULT_SEA);
export function crossingAngle(primary, secondary) { return ((secondary-primary+540)%360+360)%360-180; }
// Blend spectrum coefficients through their parameters with fixed random seeds. No reseeding.
export function advanceSea(current,target,dt) {
  const a=1-Math.exp(-Math.max(0,dt)/1.1);
  let changed=false;
  for(const key of SEA_KEYS) {
    let d=key.endsWith('Dir') || key==='sunAzim' ? crossingAngle(current[key],target[key]) : target[key]-current[key];
    if(Math.abs(d)<1e-4) { current[key]=target[key]; continue; }
    changed=true; current[key]+=d*a;
    if(key.endsWith('Dir')) current[key]=(current[key]%360+360)%360;
  }
  return changed;
}
export function effectiveChop(p) {
  const steep=Math.hypot(Math.PI*p.swellHs/(2*p.swellLength),Math.PI*p.swell2Hs/(2*p.swell2Length),0.06+0.005*p.windSpeed);
  return Math.min(p.choppy,0.38/Math.max(steep*Math.sqrt(1+0.5*p.storm),0.1));
}
export function seaBounds(p) {
  const hs=Math.hypot(p.swellHs,p.swell2Hs,0.012*p.windSpeed*p.windSpeed)*Math.sqrt(1+0.5*p.storm);
  const height=Math.max(4,hs*2.5+4);
  return {height,horizontal:Math.max(4,height*effectiveChop(p)*0.8+4),hs};
}
export function surfaceCameraY(y,water,guard,clearance,dt) {
  const target=water+clearance;
  const blend=1-Math.exp(-Math.max(0,dt)*(target>y?18:4));
  return Math.max(guard+0.8,y+(target-y)*blend);
}

// Keep the last trustworthy surface if an extreme folded patch defeats inversion.
// Neighbors with a poor inverse residual must not push the camera to a false crest.
export function updateSurfaceProbe(state,samples) {
  if(samples.length!==8 || !samples.every(Number.isFinite)) return false;
  let guard=-Infinity, valid=0, residual=0;
  const centerValid=samples[4]>=0 && samples[4]<=0.05;
  for(let k=0;k<4;k++) {
    residual=Math.max(residual,samples[k+4]);
    if(samples[k+4]>=0 && samples[k+4]<=0.05) { guard=Math.max(guard,samples[k]); valid++; }
  }
  if(centerValid) state.height=samples[0];
  if(valid) state.guard=Math.max(guard,valid<4?state.guard:-Infinity);
  state.residual=residual; state.rejected+=4-valid; state.centerValid=centerValid; state.validCount=valid;
  return centerValid;
}

export function initializeSurfaceProbe(state,fallbackHeight) {
  if(state.centerValid) return;
  if(!state.validCount) state.guard=fallbackHeight;
  state.height=state.guard;
}
