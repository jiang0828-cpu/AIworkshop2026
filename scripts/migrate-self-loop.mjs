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
  if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='SelfActionReview'").get()) console.log('Self loop migration already applied');
  else {
    db.prepare('VACUUM INTO ?').run(`${database}.before-self-loop-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.db`);
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(fs.readFileSync(path.join(root, 'cloudflare/migrations/0005_self_loop.sql'), 'utf8')); db.exec('COMMIT'); console.log('Database backed up; self loop migration applied'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
} finally { db.close(); }
