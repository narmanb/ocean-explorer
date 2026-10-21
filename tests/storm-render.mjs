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
await page.addInitScript(()=>{
 window.__textures={};window.__buffers={};
 const makeBuffer=GPUDevice.prototype.createBuffer;GPUDevice.prototype.createBuffer=function(desc){const b=makeBuffer.call(this,desc);if(desc.label==='probe out')window.__buffers.probe=b;return b;};
 const create=GPUDevice.prototype.createTexture;
 GPUDevice.prototype.createTexture=function(desc){const measured=['disp','deriv'].includes(desc.label); const t=create.call(this,measured?{...desc,usage:desc.usage|GPUTextureUsage.COPY_SRC}:desc);if(measured)window.__textures[desc.label]=t;return t;};
 const write=GPUQueue.prototype.writeBuffer;
 GPUQueue.prototype.writeBuffer=function(b,o,d,...args){if(b.label==='frame ubo')window.__frame=Array.from(d);return write.call(this,b,o,d,...args);};
 const get=HTMLCanvasElement.prototype.getContext;
 HTMLCanvasElement.prototype.getContext=function(type,...args){
  if(type!=='webgpu')return get.call(this,type,...args);
  const canvas=this;let config, texture;
  return {configure(c){config=c;window.__gpu=c.device;},getCurrentTexture(){
   if(!texture||texture.width!==canvas.width||texture.height!==canvas.height){texture?.destroy();texture=config.device.createTexture({size:[canvas.width,canvas.height],format:config.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});}
   return texture;
  }};
 };
});
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
 return {probe,camera:window.__frame.slice(16,19),nominalHs:window.__frame[99],bound:window.__frame[100],cascade,combined:{min,max,rms:Math.sqrt(sum/16384),foldFraction:folds/16384}};
});
if(!stats.probe.every(Number.isFinite)||Math.max(...stats.probe.slice(4))>1)throw Error('Water-height inverse probe failed to converge');
if(stats.cascade.some(c=>c.jacobianMomentError>0.003))throw Error('Hermitian/packed Jacobian invariant failed');
console.log('GPU_SEA_STATS',JSON.stringify({preset,...stats}));
fs.mkdirSync('shots',{recursive:true});fs.writeFileSync('shots/stats-'+preset+'.json',JSON.stringify(stats,null,2));
await browser.close();server.kill();process.exit(0);
