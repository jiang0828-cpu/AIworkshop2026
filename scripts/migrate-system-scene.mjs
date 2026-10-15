import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const url = process.env.DATABASE_URL || 'file:../data/ai-workbench.db';
if (!url.startsWith('file:')) throw new Error('Local SQLite only');
const database = path.resolve(root, 'prisma', url.slice(5));
if (!fs.existsSync(database)) throw new Error('Initialize the database first');
const db = new DatabaseSync(database);
db.exec('PRAGMA busy_timeout=15000');
try {
  const backup = `${database}.before-system-scene-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.db`;
  db.prepare('VACUUM INTO ?').run(backup);
  db.exec(fs.readFileSync(path.join(root, 'cloudflare/migrations/0017_system_scene.sql'), 'utf8'));
  console.log(`System scene ready. Backup: ${backup}`);
} finally { db.close(); }
