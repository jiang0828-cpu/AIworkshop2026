import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const url = process.env.DATABASE_URL || 'file:../data/ai-workbench.db';
if (!url.startsWith('file:')) throw new Error('Local SQLite only');
const file = path.resolve(root, 'prisma', url.slice(5));
if (!fs.existsSync(file)) throw new Error('Initialize the database first');
const db = new DatabaseSync(file);
db.exec('PRAGMA busy_timeout=15000');
try {
  if (db.prepare('PRAGMA table_info("Action")').all().some(field => field.name === 'recurrence')) {
    console.log('Task recurrence is already available');
  } else {
    const backup = `${file}.before-task-recurrence-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.db`;
    db.prepare('VACUUM INTO ?').run(backup);
    db.exec(fs.readFileSync(path.join(root, 'cloudflare/migrations/0015_task_recurrence.sql'), 'utf8'));
    console.log(`Task recurrence ready. Backup: ${backup}`);
  }
} finally { db.close(); }
