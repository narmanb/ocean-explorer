// Actual GPU execution and half-float readback; browser tooling is external to the app.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const port=8141;
const server=spawn(process.execPath,['server.mjs',String(port)],{stdio:'ignore'});
process.on('exit',()=>server.kill());
const {chromium:pw}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
await new Promise(r=>setTimeout(r,300));
const browser=await pw.launch({executablePath:process.env.BROWSER_EXECUTABLE,args:JSON.parse(process.env.BROWSER_ARGS || '[\"--enable-unsafe-webgpu\"]'),headless:true});
const page=await browser.newPage({viewport:{width:480,height:270}});
page.on('console',m=>console.log(m.type(),m.text()));page.on('pageerror',e=>console.log('PAGEERROR',e.message));
const diagnostics=process.env.SEA_DIAGNOSTICS==='1';
await page.addInitScript((diagnostics)=>{
 window.__textures={};window.__buffers={};window.__gpuErrors=[];
 if(diagnostics){
  const shader=GPUDevice.prototype.createShaderModule;
  GPUDevice.prototype.createShaderModule=function(desc){
   if(desc.label==='ocean'){
    const anchor='var col = body * (1.0 - Fr) + refl * Fr + spec;';
    if(!desc.code.includes(anchor))throw Error('Foam diagnostic anchor changed');
    // Read the actual fragment foam mask before tone mapping; alpha tags water.
    desc={...desc,code:desc.code.replace(anchor,'if(F.foamP.w>0.5){return vec4f(foamMask,cover,fwl.g,0.125);} '+anchor)};
   }
   return shader.call(this,desc);
  };
 }
 const makeBuffer=GPUDevice.prototype.createBuffer;GPUDevice.prototype.createBuffer=function(desc){const b=makeBuffer.call(this,desc);if(desc.label==='probe out')window.__buffers.probe=b;return b;};
 const create=GPUDevice.prototype.createTexture;
 GPUDevice.prototype.createTexture=function(desc){
  const hdr=diagnostics&&desc.format==='rgba16float'&&!desc.label&&desc.mipLevelCount===undefined&&desc.sampleCount===undefined;
  const measured=['disp','deriv'].includes(desc.label)||(diagnostics&&desc.label==='foam detail')||hdr;
  const t=create.call(this,measured?{...desc,usage:desc.usage|GPUTextureUsage.COPY_SRC}:desc);if(measured)window.__textures[hdr?'hdr':desc.label]=t;return t;
 };
 const write=GPUQueue.prototype.writeBuffer;
 GPUQueue.prototype.writeBuffer=function(b,o,d,...args){if(b.label==='frame ubo')window.__frame=Array.from(d);return write.call(this,b,o,d,...args);};
 const get=HTMLCanvasElement.prototype.getContext;
 HTMLCanvasElement.prototype.getContext=function(type,...args){
  if(type!=='webgpu')return get.call(this,type,...args);
  const canvas=this;let config, texture;
  return {configure(c){config=c;window.__gpu=c.device;c.device.addEventListener('uncapturederror',e=>window.__gpuErrors.push(e.error.message));},getCurrentTexture(){
   if(!texture||texture.width!==canvas.width||texture.height!==canvas.height){texture?.destroy();texture=config.device.createTexture({size:[canvas.width,canvas.height],format:config.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});}
   return texture;
  }};
 };
},diagnostics);
const preset=process.env.SEA_PRESET || 'cross';
const params=new URLSearchParams({touch:'1',profile:'1',preset,shot:'storm-'+preset+'.png',frames:'1',t:'37',...(JSON.parse(process.env.SEA_OVERRIDES || '{}'))});
const entry=process.env.SEA_ENTRY ? (process.env.SEA_ENTRY.startsWith('http')?process.env.SEA_ENTRY:pathToFileURL(process.env.SEA_ENTRY).href) : `http://localhost:${port}/`;
await page.goto(entry+'?'+params);
await page.waitForFunction(()=>document.title==='SHOT DONE'||document.querySelector('#err').textContent.length>0,null,{timeout:300000});
const error=await page.locator('#err').textContent(); if(error)throw Error(error);
await page.exposeFunction('saveGPU',(name,bytes)=>fs.writeFileSync('shots/'+preset+'-'+name+'.bin',Buffer.from(bytes,'base64')));
const stats=await page.evaluate(async()=>{
 const d=window.__gpu; const arrays={};
 for(const name of ['disp','deriv']){
  const t=window.__textures[name],stride=256*8;
  const b=d.createBuffer({size:stride*256*6,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
  const e=d.createCommandEncoder(); e.copyTextureToBuffer({texture:t},{buffer:b,bytesPerRow:stride,rowsPerImage:256},[256,256,6]);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);
  const view=new DataView(b.getMappedRange());const out=new Float32Array(256*256*6*4);
  for(let i=0;i<out.length;i++){out[i]=view.getFloat16(i*2,true);if(!Number.isFinite(out[i]))throw Error(`Nonfinite ${name} channel at ${i}`);}arrays[name]=out;await window.saveGPU(name,new Uint8Array(out.buffer).toBase64());b.unmap();b.destroy();
 }
 const probeRead=d.createBuffer({size:32,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
 const probeEnc=d.createCommandEncoder();probeEnc.copyBufferToBuffer(window.__buffers.probe,0,probeRead,0,32);d.queue.submit([probeEnc.finish()]);await probeRead.mapAsync(GPUMapMode.READ);const probe=Array.from(new Float32Array(probeRead.getMappedRange()));probeRead.unmap();probeRead.destroy();
 const L=[1103,211.3,39.7,7.43,1.393,0.2617];const cascade=[];
 for(let c=0;c<6;c++){let min=Infinity,max=-Infinity,sum=0;for(let i=0;i<65536;i++){const h=arrays.disp[(c*65536+i)*4+1];if(!Number.isFinite(h))throw Error('nonfinite displacement');min=Math.min(min,h);max=Math.max(max,h);sum+=h*h;}let product=0;for(let i=0;i<65536;i++)product+=arrays.deriv[(c*65536+i)*4+2]*arrays.deriv[(c*65536+i)*4+3];let jxz2=0;for(let i=0;i<65536;i++)jxz2+=arrays.disp[(c*65536+i)*4+3]**2;const rms=[];for(let ch=0;ch<4;ch++){let n=0;for(let i=0;i<65536;i++)n+=arrays.deriv[(c*65536+i)*4+ch]**2;rms.push(Math.sqrt(n/65536));}cascade.push({min,max,rms:Math.sqrt(sum/65536),derivRms:rms,jxzRms:Math.sqrt(jxz2/65536),jacobianMomentError:Math.abs(product/65536-jxz2/65536)});}
 const sample=(name,c,x,z,ch)=>{const fx=((x/L[c]%1)+1)%1*256-0.5,fy=((z/L[c]%1)+1)%1*256-0.5;const ix=Math.floor(fx),iy=Math.floor(fy),tx=fx-ix,ty=fy-iy; const at=(dx,dy)=>arrays[name][((c*256+(iy+dy+256)%256)*256+(ix+dx+256)%256)*4+ch];return (at(0,0)*(1-tx)+at(1,0)*tx)*(1-ty)+(at(0,1)*(1-tx)+at(1,1)*tx)*ty;};
 let min=Infinity,max=-Infinity,sum=0,folds=0;
 for(let j=0;j<128;j++)for(let i=0;i<128;i++){let h=0,jx=0,jz=0,jxz=0;for(let c=0;c<6;c++){const x=i*1103/128,z=j*1103/128;h+=sample('disp',c,x,z,1);jx+=sample('deriv',c,x,z,2);jz+=sample('deriv',c,x,z,3);jxz+=sample('disp',c,x,z,3);}min=Math.min(min,h);max=Math.max(max,h);sum+=h*h;if((1+jx)*(1+jz)-jxz*jxz<0)folds++;}
 let foam=null;
 if(window.__textures.hdr){
  const readTexture=async(t,bpp)=>{
   const stride=Math.ceil(t.width*bpp/256)*256,b=d.createBuffer({size:stride*t.height,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
   const e=d.createCommandEncoder();e.copyTextureToBuffer({texture:t},{buffer:b,bytesPerRow:stride},[t.width,t.height]);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);
   const bytes=b.getMappedRange().slice(0);b.unmap();b.destroy();return {view:new DataView(bytes),stride};
  };
  const t=window.__textures.hdr,{view,stride}=await readTexture(t,8);let count=0,sum=0,strong=0,dense=0;
  for(let y=0;y<t.height;y++)for(let x=0;x<t.width;x++){
   const i=y*stride+x*8;if(view.getFloat16(i+6,true)!==0.125)continue;
   const mask=view.getFloat16(i,true);if(!Number.isFinite(mask))throw Error('Nonfinite foam mask');
   count++;sum+=mask;if(mask>0.5)strong++;if(mask>0.9)dense++;
  }
  const detail=await readTexture(window.__textures['foam detail'],4);let sx=0,sy=0,sxx=0,syy=0,sxy=0;
  for(let y=0;y<512;y++)for(let x=0;x<512;x++){
   const a=detail.view.getUint8(y*detail.stride+x*4+3),b=detail.view.getUint8(((y+128)%512)*detail.stride+x*4+3);
   sx+=a;sy+=b;sxx+=a*a;syy+=b*b;sxy+=a*b;
  }
  const n=512*512;foam={pixels:count,mean:sum/count,strongFraction:strong/count,denseFraction:dense/count,streakQuarterTileCorrelation:(n*sxy-sx*sy)/Math.sqrt((n*sxx-sx*sx)*(n*syy-sy*sy))};
 }
 return {errors:window.__gpuErrors,foam,probe,camera:window.__frame.slice(16,19),nominalHs:window.__frame[99],bound:window.__frame[100],cascade,combined:{min,max,rms:Math.sqrt(sum/16384),foldFraction:folds/16384}};
});
if(stats.errors.length)throw Error(stats.errors.join('\n'));
if(!stats.probe.every(Number.isFinite)||Math.max(...stats.probe.slice(4))>0.05)throw Error('Water-height inverse probe failed to converge');
if(stats.cascade.some(c=>c.jacobianMomentError>0.003))throw Error('Hermitian/packed Jacobian invariant failed');
if(diagnostics){
 if(!stats.foam?.pixels)throw Error('No water pixels in foam diagnostic');
 if(Math.abs(stats.foam.streakQuarterTileCorrelation)>0.95)throw Error('Foam streak texture repeats each quarter tile');
 if(params.get('foam')==='0'&&stats.foam.mean!==0)throw Error('Zero foam strength does not disable the foam mask');
}
console.log('GPU_SEA_STATS',JSON.stringify({preset,...stats}));
fs.mkdirSync('shots',{recursive:true});fs.writeFileSync('shots/stats-'+preset+'.json',JSON.stringify(stats,null,2));
await browser.close();server.kill();process.exit(0);
