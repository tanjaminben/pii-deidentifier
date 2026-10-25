import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestName = 'IMPORT-MANIFEST.json';
const manifest = JSON.parse(await readFile(path.join(root, manifestName), 'utf8'));
if (manifest.kind !== 'sanitized-public-source-snapshot') throw new Error('Unexpected snapshot manifest kind');
const failures = [];
const listed = new Set();
for (const file of manifest.files) {
  if (listed.has(file.path)) throw new Error('Duplicate manifest path: ' + file.path);
  listed.add(file.path);
  const absolute = path.resolve(root, file.path);
  if (!absolute.startsWith(root + path.sep)) throw new Error('Manifest path leaves the repository: ' + file.path);
  try {
    const bytes = await readFile(absolute);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== file.sha256 || bytes.length !== file.bytes) failures.push(file.path);
  } catch { failures.push(file.path + ' (unreadable)'); }
}
async function walk(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist', 'build', 'coverage', '.vitest'].includes(entry.name)) continue;
    const relative = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error('Unexpected symbolic link: ' + relative);
    if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative + '/');
    else if (relative !== manifestName && !listed.has(relative)) failures.push(relative + ' (unlisted)');
  }
}
await walk(root);
if (failures.length) throw new Error('Snapshot differs: ' + failures.join(', '));
console.log(`Verified ${manifest.files.length} public snapshot entries.`);
