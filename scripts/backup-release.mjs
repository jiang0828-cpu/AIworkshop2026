import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import JSZip from 'jszip';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
process.loadEnvFile(path.join(root, '.env'));
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
const directory = path.join(root, 'data', 'releases', stamp);
await fs.mkdir(directory, { recursive: true });
const databaseUrl = process.env.DATABASE_URL || 'file:../data/ai-workbench.db';
if (!databaseUrl.startsWith('file:')) throw new Error('Release backup requires a local SQLite database');
const database = path.resolve(root, 'prisma', databaseUrl.slice(5));
const sqlite = new DatabaseSync(database);
try {
  sqlite.exec('PRAGMA busy_timeout=15000');
  sqlite.prepare('VACUUM INTO ?').run(path.join(directory, 'local.sqlite'));
} finally { sqlite.close(); }
const check = new DatabaseSync(path.join(directory, 'local.sqlite'), { readOnly: true });
try {
  if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('SQLite backup integrity failed');
} finally { check.close(); }
const headers = {};
if (process.env.APP_AUTH_EMAIL && process.env.APP_AUTH_PASSWORD) headers.authorization = 'Basic ' + Buffer.from(process.env.APP_AUTH_EMAIL + ':' + process.env.APP_AUTH_PASSWORD).toString('base64');
const response = await fetch('http://localhost:3012/api/backup', { headers, signal: AbortSignal.timeout(60000) });
if (!response.ok) throw new Error('Local JSON backup failed: HTTP ' + response.status);
const backup = await response.json();
if (backup.format !== 'ai-workbench-backup') throw new Error('Unexpected backup format');
await fs.writeFile(path.join(directory, 'local-backup.json'), JSON.stringify(backup, null, 2));
const zip = new JSZip();
const excluded = new Set(['node_modules', 'data', 'output', '.git', '.wrangler', '.open-next', 'generated']);
async function addTree(relative = '') {
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || excluded.has(entry.name) || entry.name.endsWith('.tsbuildinfo') || entry.name.endsWith('.log')) continue;
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) await addTree(name);
    else if (entry.isFile()) zip.file(name, await fs.readFile(path.join(root, name)));
  }
}
await addTree();
await fs.writeFile(path.join(directory, 'source.zip'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
const files = [];
for (const name of ['local.sqlite', 'local-backup.json', 'source.zip']) {
  const content = await fs.readFile(path.join(directory, name));
  files.push({ name, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
}
const counts = Object.fromEntries(['goals', 'projects', 'actions', 'reviews', 'experiences', 'evidences', 'resources'].map(name => [name, backup.data[name]?.length || 0]));
await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), files, counts, excludes: ['environment variables', 'secrets', 'dependencies', 'build caches'] }, null, 2));
console.log(JSON.stringify({ directory, files: files.map(({ name, bytes }) => ({ name, bytes })), counts, remoteCredentialsConfigured: Boolean(process.env.APP_AUTH_EMAIL && process.env.APP_AUTH_PASSWORD) }));
