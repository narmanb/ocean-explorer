import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

test('standalone outputs match source and have valid inline module syntax', () => {
  const check = spawnSync(process.execPath, ['build.mjs', '--check'], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  for (const file of ['ocean.html', 'ocean.min.html']) {
    const html = fs.readFileSync(file, 'utf8');
    const code = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
    assert.ok(code, file + ' includes renderer');
    const parsed = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: code, encoding: 'utf8' });
    assert.equal(parsed.status, 0, parsed.stderr);
    assert.ok(html.includes(fs.readFileSync('LICENSE', 'utf8').trim()), file + ' retains MIT notice');
    assert.ok(!html.includes('src="js/main.js"'), file + ' is self-contained');
  }
});
