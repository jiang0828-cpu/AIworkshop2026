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
db.exec('PRAGMA busy_timeout=15000; PRAGMA foreign_keys=ON');
try {
  const missing = ['Project', 'Action'].filter(table => !db.prepare(`PRAGMA table_info("${table}")`).all().some(row => row.name === 'parentId'));
  if (missing.length) {
    db.prepare('VACUUM INTO ?').run(`${database}.before-execution-hierarchy-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.db`);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const table of missing) db.exec(`ALTER TABLE "${table}" ADD COLUMN "parentId" TEXT REFERENCES "${table}"("id") ON DELETE SET NULL ON UPDATE CASCADE`);
      for (const table of ['Project', 'Action']) db.exec(`CREATE INDEX IF NOT EXISTS "${table}_profileId_parentId_idx" ON "${table}"("profileId", "parentId")`);
      db.exec('COMMIT'); console.log('Database backed up; execution hierarchy migration applied');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } else console.log('Execution hierarchy migration already applied');
} finally { db.close(); }
