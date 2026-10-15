import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

const directory = path.resolve(process.argv[2]);
const sql = await fs.readFile(path.join(directory, 'cloudflare-before.sql'), 'utf8');
const database = new DatabaseSync(':memory:');
const quoted = value => '"' + value.replaceAll('"', '""') + '"';
const tables = ['Profile', 'Experience', 'Evidence', 'ValueRule', 'Resource', 'Constraint', 'Assumption', 'Goal', 'Project', 'Action', 'Review', 'RecordSource', 'DailyPlan', 'DailyTask', 'DailyStep', 'WorkbenchScene'];
try {
  database.exec('PRAGMA foreign_keys=OFF');
  database.exec(sql);
  if (database.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('D1 export integrity check failed');
  const columns = Object.fromEntries(tables.map(table => [table, database.prepare(`PRAGMA table_info(${quoted(table)})`).all().map(row => row.name)]));
  const read = table => database.prepare(`SELECT ${columns[table].map(quoted).join(',')} FROM ${quoted(table)} ORDER BY id`).all();
  const before = Object.fromEntries(tables.map(table => [table, read(table)]));
  const migrations = ['0013_execution_hierarchy.sql', '0014_delivery_codes.sql', '0015_task_recurrence.sql', '0016_daily_assets.sql', '0017_system_scene.sql'];
  for (const name of migrations) database.exec(await fs.readFile(path.join('cloudflare', 'migrations', name), 'utf8'));
  for (const table of tables) {
    const after = read(table);
    for (const original of before[table]) {
      const restored = after.find(row => row.id === original.id);
      if (JSON.stringify(restored) !== JSON.stringify(original)) throw new Error('Migration modified original fields in ' + table);
    }
    if (table !== 'WorkbenchScene' && after.length !== before[table].length) throw new Error('Migration changed record count in ' + table);
  }
  if (database.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Migrated backup has invalid foreign keys');
  const report = { verifiedAt: new Date().toISOString(), sqlBytes: Buffer.byteLength(sql), sha256: createHash('sha256').update(sql).digest('hex'), migrations, counts: Object.fromEntries(tables.map(table => [table, before[table].length])), integrity: 'ok', originalFieldsPreserved: true };
  await fs.writeFile(path.join(directory, 'cloudflare-backup-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { database.close(); }
