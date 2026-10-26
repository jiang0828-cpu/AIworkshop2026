const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const directory = path.resolve(process.argv[2]);
const sql = fs.readFileSync(path.join(directory, 'cloudflare-before.sql'), 'utf8');
const db = new DatabaseSync(':memory:');
try {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(sql);
  db.exec('PRAGMA foreign_keys = ON');
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
  const counts = Object.fromEntries(['Profile','Goal','Project','Action','Review','admin_accounts'].map(table => [table, db.prepare(`SELECT COUNT(*) n FROM "${table}"`).get().n]));
  if (integrity !== 'ok' || foreignKeys.length) throw new Error('Cloudflare backup integrity check failed');
  const report = { integrity, foreignKeyViolations: foreignKeys.length, counts };
  fs.writeFileSync(path.join(directory, 'cloudflare-backup-verification.json'), JSON.stringify(report, null, 2));
  const backup = JSON.parse(fs.readFileSync(path.join(directory, 'local-backup.json'), 'utf8'));
  if (backup.format !== 'ai-workbench-backup' || backup.version !== 1 || !backup.data) throw new Error('Invalid application backup');
  const manifestPath = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.files = fs.readdirSync(directory).filter(name => name !== 'manifest.json' && fs.statSync(path.join(directory, name)).isFile()).map(name => ({ name, bytes: fs.statSync(path.join(directory, name)).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex') }));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ cloudflare: report, localBackup: 'valid', files: manifest.files.map(({name,bytes})=>({name,bytes})) }));
} finally { db.close(); }
