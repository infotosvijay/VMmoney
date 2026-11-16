import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const assets = [...sw.slice(sw.indexOf('const ASSETS'), sw.indexOf('];')).matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);

test('every file in the offline list exists', () => {
  for (const a of assets) assert.ok(a === '' || existsSync(join(root, a)), `sw.js lists a missing file: ${a}`);
});

test('every script is in the offline list (a missing one breaks the app offline)', () => {
  const scripts = walk(join(root, 'js')).map((p) => relative(root, p).replaceAll('\\', '/'));
  const missing = scripts.filter((s) => !assets.includes(s));
  assert.deepEqual(missing, [], `add these to ASSETS in sw.js: ${missing.join(', ')}`);
});

test('every import in the app points at a real file', () => {
  for (const p of walk(join(root, 'js')).filter((f) => f.endsWith('.js') && !f.includes('vendor'))) {
    const src = readFileSync(p, 'utf8');
    for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) {
      assert.ok(existsSync(join(p, '..', m[1])), `${relative(root, p)} imports missing ${m[1]}`);
    }
  }
});
