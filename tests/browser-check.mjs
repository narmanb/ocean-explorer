// Real WebGPU checks. Install Playwright separately; no browser dependency is shipped.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs BROWSER_EXECUTABLE=/path/to/chrome
// BROWSER_ARGS='["--enable-unsafe-webgpu"]' OFFSCREEN_GPU=1 node tests/browser-check.mjs
// OFFSCREEN_GPU substitutes only canvas presentation for headless GPUs lacking interop.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = process.env.OCEAN_TEST_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const port = 8137;
const server = spawn(process.execPath, ['server.mjs', String(port)], { cwd: root, stdio: 'ignore' });
await new Promise((resolve, reject) => { server.once('error', reject); setTimeout(resolve, 300); });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  args: JSON.parse(process.env.BROWSER_ARGS || '["--enable-unsafe-webgpu"]') });
const offscreen = process.env.OFFSCREEN_GPU === '1';
const encodeOnly = process.env.ENCODE_ONLY === '1';
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); console.log('PASS', ++checks, message); };
async function setup(page) {
  page.on('pageerror', (e) => { throw e; });
  await page.addInitScript(({ offscreen, encodeOnly }) => {
    window.__audit = { dispatches: {}, submits: 0, sim:[], errors: [], frame: [], draws: {} };
    const request = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (...args) {
      const device = await request.apply(this, args); window.__testDevice = device;
      device.addEventListener('uncapturederror', (e) => window.__audit.errors.push(e.error.message)); return device;
    };
    const write = GPUQueue.prototype.writeBuffer;
    GPUQueue.prototype.writeBuffer = function (buffer, offset, data, ...args) {
      if(buffer.label==='sim ubo')window.__audit.sim=Array.from(data);
      if (buffer.label === 'frame ubo') window.__audit.frame = Array.from(data);
      return write.call(this, buffer, offset, data, ...args);
    };
    const submit = GPUQueue.prototype.submit;
    GPUQueue.prototype.submit = function (...args) { window.__audit.submits++; if (!encodeOnly) return submit.apply(this, args); };
    const renderPipeline = GPURenderPassEncoder.prototype.setPipeline;
    GPURenderPassEncoder.prototype.setPipeline = function (p) { this.__label = p.label; return renderPipeline.call(this, p); };
    const draw = GPURenderPassEncoder.prototype.draw;
    GPURenderPassEncoder.prototype.draw = function (...args) {
      const counts = window.__audit.draws; counts[this.__label] = (counts[this.__label] || 0) + 1;
      return draw.apply(this, args);
    };
    const pipeline = GPUComputePassEncoder.prototype.setPipeline;
    GPUComputePassEncoder.prototype.setPipeline = function (p) { this.__label = p.label; return pipeline.call(this, p); };
    const dispatch = GPUComputePassEncoder.prototype.dispatchWorkgroups;
    GPUComputePassEncoder.prototype.dispatchWorkgroups = function (x, y = 1, z = 1) {
      const count = window.__audit.dispatches; count[this.__label] = (count[this.__label] || 0) + x * y * z;
      return dispatch.call(this, x, y, z);
    };
    if (offscreen) {
      // Keep this software GPU's queue bounded; these timings are not a native-browser benchmark.
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => raf(async () => {
        if (!encodeOnly && window.__testDevice) await window.__testDevice.queue.onSubmittedWorkDone().catch(() => {});
        callback(performance.now());
      });
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (type !== 'webgpu') return get.call(this, type, ...args);
        const canvas = this; let config, texture;
        return { configure(c) { config = c; }, getCurrentTexture() {
          if (!texture || texture.width !== canvas.width || texture.height !== canvas.height) {
            texture?.destroy(); texture = config.device.createTexture({ label: 'test presentation target',
              size: [canvas.width, canvas.height], format: config.format,
              usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
          }
          window.__testTexture = texture; return texture;
        } };
      };
    }
  }, { offscreen, encodeOnly });
}
async function ready(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => window.__audit.frame[70] >= 1 || document.querySelector('#err').textContent, null, { timeout: 600000 });
  check(await page.locator('#err').textContent() === '', 'startup without renderer errors: ' + url);
}
async function frames(page) {
  const index = await page.evaluate(() => window.__audit.frame[70]);
  await page.waitForFunction((i) => window.__audit.frame[70] >= i + 2, index, { timeout: 600000 });
  check((await page.evaluate(() => window.__audit.errors)).length === 0, 'no GPU validation errors');
}
try {
  const context = await browser.newContext({ viewport: { width: 749, height: 360 }, hasTouch: true });
  const page = await context.newPage();
  await setup(page);
  await ready(page, `http://localhost:${port}/?preset=original&touch=1&profile=1&clouds=0&veil=0`);
  check(await page.locator('.settings-category').count() === 6, 'six settings categories');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('summary').filter({hasText:'Storm & Extreme Seas'}).click();
  const stormPreset=page.getByLabel('Storm preset',{exact:true});
  for(const id of ['calm','rough','severe','cross','cinematic','calm','cinematic']) {
    await stormPreset.selectOption(id); await frames(page);
    check(await stormPreset.inputValue()===id,'preset switches: '+id);
    check(await page.evaluate(()=>window.__audit.frame.every(Number.isFinite)&&window.__audit.sim.every(Number.isFinite)),'finite uniforms during weather transition');
  }
  await page.waitForTimeout(10000); await frames(page);
  check(await page.evaluate(()=>window.__audit.sim[44]>39&&window.__audit.sim[56]>31),'both cinematic swell systems reach the spectrum');
  const atmoBefore=await page.evaluate(()=>window.__audit.dispatches.multiscatter); await frames(page);
  check(await page.evaluate(()=>window.__audit.dispatches.multiscatter)===atmoBefore,'settled fractional haze does not regenerate atmosphere LUTs');
  const angle=page.locator('label').filter({hasText:'Crossing angle (deg)'}).locator('input');
  await angle.fill('-70'); await angle.dispatchEvent('input');
  check(await stormPreset.inputValue()==='custom','crossing angle creates a custom sea state');
  await stormPreset.selectOption('original'); await page.waitForTimeout(14000); await frames(page);
  await page.locator('summary').filter({ hasText: 'Wind' }).click();
  const slider = page.locator('details').filter({has:page.locator('summary',{hasText:'Wind'})}).locator('input[type=range]').first();
  await slider.focus(); await page.keyboard.press('h');
  check(await page.locator('#panel').isVisible(), 'focused setting does not trigger H shortcut');
  await slider.fill('8'); await slider.dispatchEvent('input'); await frames(page);
  check(await slider.locator('..').locator('output').textContent() === '8', 'wind slider updates');
  const skyDispatches = await page.evaluate(() => window.__audit.dispatches.skyview);
  await frames(page);
  check(await page.evaluate(() => window.__audit.dispatches.skyview) === skyDispatches, 'stationary sky LUT is cached');
  const cubeBefore = await page.evaluate(() => ({ frame: window.__audit.frame[70], groups: window.__audit.dispatches['cube mips'] }));
  await frames(page);
  const cubeAfter = await page.evaluate(() => ({ frame: window.__audit.frame[70], groups: window.__audit.dispatches['cube mips'] }));
  check((cubeAfter.groups - cubeBefore.groups) === (cubeAfter.frame - cubeBefore.frame) * 344, 'normal reflection mips dispatch one face (344 workgroups/frame)');
  for (const category of ['Wind', 'Waves', 'Water', 'Sky & Atmosphere', 'Graphics & Performance']) {
    const section = page.locator('details').filter({ has: page.locator('summary', { hasText: category }) });
    if (!await section.evaluate((el) => el.open)) await section.locator('summary').click();
    const inputs = section.locator('input[type=range]');
    for (let i = 0; i < await inputs.count(); i++) {
      const input = inputs.nth(i);
      const value = await input.evaluate((el) => String(Number(Math.min(Number(el.max), Number(el.value) + Number(el.step)).toFixed(5))));
      await input.fill(value); await input.dispatchEvent('input');
      check(await input.locator('..').locator('output').textContent() === await input.inputValue(), category + ' slider responds');
    }
    await frames(page);
  }
  const bloom = page.locator('label').filter({ hasText: 'Bloom' }).locator('input');
  const bloomValue = await bloom.inputValue(); await bloom.fill('0'); await bloom.dispatchEvent('input'); await page.waitForTimeout(8200); await frames(page);
  const bloomBefore = await page.evaluate(() => window.__audit.draws['bloom down']); await frames(page);
  check(await page.evaluate(() => window.__audit.draws['bloom down']) === bloomBefore, 'zero bloom skips its render passes');
  await bloom.fill(bloomValue); await bloom.dispatchEvent('input');
  if (!await page.locator('details').last().evaluate((el) => el.open)) await page.locator('summary').filter({ hasText: 'Graphics & Performance' }).click();
  await page.waitForFunction(() => document.querySelectorAll('details[open]').length === 1);
  check(await page.locator('details[open]').count() === 1, 'accordion closes previous category');
  await page.getByLabel('Anti-aliasing', { exact: true }).selectOption('1');
  await page.waitForFunction(() => !document.querySelector('[aria-label="Anti-aliasing"]').disabled, null, { timeout: 600000 });
  await frames(page);
  await page.getByLabel('Anti-aliasing', { exact: true }).selectOption('4'); await frames(page);
  await page.getByLabel('Frame-rate cap', { exact: true }).selectOption('30'); await frames(page);
  await page.getByRole('button', { name: 'Close settings' }).click();
  for (const scale of ['0.65', '1.5', '2', '1']) {
    await page.getByLabel('Rendering resolution', { exact: true }).selectOption(scale); await frames(page);
    check(await page.getByLabel('Rendering resolution scale', { exact: true }).inputValue() === scale, 'resolution selectors stay synchronized at ' + scale);
    check(await page.locator('#c').evaluate((c) => c.width) === Math.round(749 * Number(scale)), 'resolution changes actual target at ' + scale);
  }
  await page.setViewportSize({ width: 160, height: 120 }); await frames(page);
  await page.setViewportSize({ width: 360, height: 780 }); await frames(page);
  check(await page.locator('#touch-bar').evaluate((e) => e.getBoundingClientRect().right <= innerWidth), 'portrait toolbar fits');
  await page.setViewportSize({ width: 749, height: 360 }); await frames(page);
  const camera = () => page.evaluate(() => window.__audit.frame.slice(16, 19));
  const start = await camera(); const pad = await page.locator('#touch-stick').boundingBox();
  await page.mouse.move(pad.x + pad.width / 2, pad.y + 8); await page.mouse.down(); await frames(page); await page.mouse.up();
  check(Math.abs((await camera())[2] - start[2]) > 0.01, 'joystick moves camera');
  await page.getByRole('button', { name: 'FAST 5×' }).click();
  check(await page.getByRole('button', { name: 'FAST 5×' }).getAttribute('aria-pressed') === 'true', 'boost toggles');
  const y = (await camera())[1]; const up = await page.locator('#mobile-up').boundingBox();
  await page.mouse.move(up.x + 25, up.y + 25); await page.mouse.down(); await frames(page); await page.mouse.up();
  check((await camera())[1] > y, 'UP changes altitude');
  const cdp = await page.context().newCDPSession(page);
  const before = await page.evaluate(() => window.__audit.frame.slice(28, 31));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 380, y: 180, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 430, y: 200, id: 1 }] });
  await frames(page); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  check(JSON.stringify(before) !== JSON.stringify(await page.evaluate(() => window.__audit.frame.slice(28, 31))), 'touch drag rotates camera');
  await page.getByLabel('Toggle fullscreen').click();
  await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 5000 });
  check(await page.evaluate(() => !!document.fullscreenElement), 'fullscreen enters');
  await page.evaluate(() => document.exitFullscreen()); await frames(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Measure 15 seconds' }).click();
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Download last report').disabled, null, { timeout: 600000 });
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download last report' }).click();
  const file = await download; const report = JSON.parse(fs.readFileSync(await file.path(), 'utf8'));
  check(report.durationMs >= 15000 && report.frames.frames > 0 && (encodeOnly ? report.gpu === null : report.gpu?.frames > 0), encodeOnly ? 'encoding-only report contains frame samples and honestly unavailable GPU timing' : 'report contains real frame and GPU samples');
  check(Math.abs(report.frames.meanMs * report.frames.frames - report.durationMs) < 0.01, 'report interval window matches duration');
  console.log('REPORT', JSON.stringify(report));
  await page.evaluate(() => window.__testDevice.destroy());
  await page.waitForFunction(() => document.querySelector('#err').textContent.includes('GPU device lost'));
  const submits = await page.evaluate(() => window.__audit.submits); await page.waitForTimeout(200);
  check(await page.evaluate(() => window.__audit.submits) === submits, 'GPU loss displays error and stops submissions');
  await page.close();
  for (const entry of ['index.html', 'ocean.html', 'ocean.min.html']) {
    const p = await context.newPage(); await p.setViewportSize({ width: 320, height: 180 }); await setup(p);
    const url = entry === 'index.html' ? `http://localhost:${port}/index.html` : pathToFileURL(path.join(root, entry)).href;
    await ready(p, url + '?preset=original&touch=0&aa=1&clouds=0&veil=0');
    check(await p.locator('#touch-ui').isHidden(), entry + ' desktop layout');
    const z = await p.evaluate(() => window.__audit.frame[18]); await p.keyboard.down('w'); await frames(p); await p.keyboard.up('w');
    check(await p.evaluate(() => window.__audit.frame[18]) < z, entry + ' desktop WASD');
    await p.keyboard.press('h'); check(await p.locator('#panel').isVisible(), entry + ' desktop H');
    await p.keyboard.press('h');
    if (offscreen && !encodeOnly) {
      const colors = await p.evaluate(async () => {
        const d = window.__testDevice, t = window.__testTexture;
        const stride = Math.ceil(t.width * 4 / 256) * 256;
        const b = d.createBuffer({ size: stride * t.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const e = d.createCommandEncoder(); e.copyTextureToBuffer({ texture: t }, { buffer: b, bytesPerRow: stride }, [t.width, t.height]);
        d.queue.submit([e.finish()]); await b.mapAsync(GPUMapMode.READ); const bytes = new Uint8Array(b.getMappedRange());
        const set = new Set(); for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) { const i = y * stride + x * 4; set.add(`${bytes[i]},${bytes[i+1]},${bytes[i+2]}`); }
        b.unmap(); b.destroy(); return set.size;
      });
      check(colors > 100, entry + ' renders a nonblank GPU image (' + colors + ' colors)');
    }
    await p.close();
  }
  const noTiming = await context.newPage(); await setup(noTiming);
  await noTiming.addInitScript(() => {
    const features = Object.getOwnPropertyDescriptor(GPUAdapter.prototype, 'features').get;
    Object.defineProperty(GPUAdapter.prototype, 'features', { get() {
      return new Set([...features.call(this)].filter((f) => f !== 'timestamp-query'));
    } });
  });
  await ready(noTiming, `http://localhost:${port}/?touch=0&profile=1&aa=1&clouds=0&veil=0`);
  await noTiming.waitForFunction(() => document.querySelector('#fps').textContent.includes('GPU timing unavailable'));
  check(await noTiming.locator('#err').textContent() === '', 'renderer works without timestamp-query support');
  await noTiming.close();
  const unavailable = await context.newPage();
  await unavailable.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: undefined });
    delete window.GPUBufferUsage; delete window.GPUTextureUsage;
  });
  await unavailable.goto(`http://localhost:${port}/`);
  await unavailable.waitForFunction(() => document.querySelector('#err').textContent.includes('WebGPU is not available'), null, { timeout: 5000 });
  check(await unavailable.locator('#err').isVisible(), 'unsupported browsers get a visible WebGPU error');
  await unavailable.close();
  console.log(`Completed ${checks} checks; offscreen presentation: ${offscreen}; GPU submission disabled: ${encodeOnly}. Software GPU results are not Android performance measurements.`);
} finally { await browser.close(); server.kill(); }
