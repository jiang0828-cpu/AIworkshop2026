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
db.exec('PRAGMA busy_timeout=15000; PRAGMA foreign_keys=ON');
try {
  const backup = `${file}.before-delivery-codes-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.db`;
  db.prepare('VACUUM INTO ?').run(backup);
  const sql = fs.readFileSync(path.join(root, 'cloudflare/migrations/0014_delivery_codes.sql'), 'utf8');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const statement of sql.slice(0, sql.indexOf('-- Number allocation')).trim().split(';').filter(Boolean)) {
      const [, table, column] = statement.match(/ALTER TABLE "(\w+)" ADD COLUMN "(\w+)"/) || [];
      if (!db.prepare(`PRAGMA table_info("${table}")`).all().some(field => field.name === column)) db.exec(statement);
    }
    db.exec(sql.slice(sql.indexOf('-- Number allocation')));
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign key validation failed');
    db.exec('COMMIT');
    console.log(`Delivery codes and dates ready. Backup: ${backup}`);
  } catch (error) { db.exec('ROLLBACK'); throw error; }
} finally { db.close(); }
