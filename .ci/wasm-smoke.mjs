import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const output = resolve(process.argv[2] ?? 'dist');
const bin = join(output, 'bin');
assert.deepEqual([...readFileSync(join(bin, 'pglite.wasm')).subarray(0, 4)], [0, 97, 115, 109]);
assert.ok(readFileSync(join(bin, 'pglite.data')).length > 0);
const version = execFileSync(process.execPath, [join(bin, 'pg_config'), '--version'], {
  encoding: 'utf8', timeout: 60_000,
});
assert.match(version, /^PostgreSQL 18\./m);
const { default: createModule } = await import(pathToFileURL(join(bin, 'pglite.js')).href);
assert.equal(typeof createModule, 'function');
const runtime = await createModule({
  noInitialRun: true,
  locateFile: (file) => join(bin, file),
});
assert.equal(typeof runtime.FS?.readFile, 'function');
assert.ok(runtime.FS.stat('/pglite/share/postgresql/postgres.bki').size > 0);
console.log(`WASM pg_config and module initialization passed: ${version.trim()}`);
