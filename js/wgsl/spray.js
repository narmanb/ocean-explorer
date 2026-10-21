// Bounded, procedural crest spindrift: 256 camera-near cards, no particle buffers/integration.
import { FRAME_WGSL, CASCADES } from './common.js';
export const SPINDRIFT = FRAME_WGSL + /* wgsl */ `
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var dispTex: texture_2d_array<f32>;
@group(0) @binding(2) var derivTex: texture_2d_array<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var detail: texture_2d<f32>;
fn hash(n: u32) -> f32 {
  var x=n*747796405u+2891336453u; x=((x>>((x>>28u)+4u))^x)*277803737u;
  return f32((x>>22u)^x)/4294967296.0;
}
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) alpha: f32 };
@vertex fn vs(@builtin(vertex_index) v: u32,@builtin(instance_index) i: u32) -> VO {
  let corners=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
  let cell=vec2i(floor(F.camPos.xz/10.0))+vec2i(i32(i%16u)-8,i32(i/16u)-8);
  let seed=bitcast<u32>(cell.x)*1664525u+bitcast<u32>(cell.y)*1013904223u;
  let q=(vec2f(cell)+vec2f(hash(seed),hash(seed+13u)))*10.0;
  var d=vec3f(0); var j=vec3f(0); var slope=vec2f(0);
  for(var c=0u;c<${CASCADES}u;c++) {
    let uv=q*F.cascInvL[c>>2u][c&3u];
    let a=textureSampleLevel(dispTex,samp,uv,c,1.0);
    let b=textureSampleLevel(derivTex,samp,uv,c,1.0);
    d+=a.xyz; j+=vec3f(b.z,b.w,a.w); slope+=b.xy;
  }
  let J=(1.0+j.x)*(1.0+j.y)-j.z*j.z;
  let crest=smoothstep(0.04,0.32,d.y/max(F.stormP.w,1.0));
  let crestActivity=max(clamp((0.8-J)*2.0,0.0,1.0),smoothstep(0.25,0.8,length(slope)))*crest;
  let age=fract(F.camPos.w*0.35+hash(seed+71u));
  let corner=corners[v];
  let radius=(0.8+F.stormP.x*1.1)*(0.7+hash(seed+3u));
  let right=normalize(F.camRight.xyz); let up=normalize(F.camUp.xyz);
  let lift=vec3f(F.windP[0].x*age*2.0,age*(1.0+F.stormP.x*3.0),F.windP[0].y*age*2.0);
  let world=vec3f(q.x+d.x,d.y+0.5,q.y+d.z)+lift+right*corner.x*radius+up*corner.y*radius*1.5;
  var o:VO; o.pos=F.viewProj*vec4f(world-F.camPos.xyz,1.0); o.uv=corner*0.5+0.5;
  o.alpha=crestActivity*F.stormP.z*sin(age*3.14159265)*0.23;
  return o;
}
@fragment fn fs(in:VO) -> @location(0) vec4f {
  let p=in.uv*2.0-1.0;
  let soft=pow(max(0.0,1.0-dot(p,p)),2.0);
  let lace=textureSample(detail,samp,in.uv*0.7+vec2f(F.camPos.w*0.015,0.0)).r;
  let alpha=in.alpha*soft*smoothstep(0.12,0.75,lace);
  let light=vec3f(0.16,0.2,0.24)*(F.sunDir.w/10.0);
  return vec4f(light*alpha,alpha);
}
`;
