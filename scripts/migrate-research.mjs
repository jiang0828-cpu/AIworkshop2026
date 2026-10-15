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
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ResearchBatch'").get();
  const hasLease = exists && db.prepare('PRAGMA table_info("ResearchBatch")').all().some(row => row.name === 'leaseUntilSeconds');
  if (hasLease) console.log('Research migration already applied');
  else {
    db.prepare('VACUUM INTO ?').run(`${database}.before-research-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.db`);
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!exists) db.exec(fs.readFileSync(path.join(root, 'cloudflare/migrations/0006_trend_research.sql'), 'utf8'));
      db.exec(fs.readFileSync(path.join(root, 'cloudflare/migrations/0008_research_lease.sql'), 'utf8'));
      db.exec('COMMIT'); console.log('Database backed up; research migration applied');
    }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
} finally { db.close(); }
