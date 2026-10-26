const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const JSZip = require('jszip');

async function main() {
  const root = path.resolve(__dirname, '..');
  if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(root, 'data', 'releases', stamp);
  fs.mkdirSync(out, { recursive: true });
  const url = process.env.DATABASE_URL || 'file:../data/ai-workbench.db';
  if (!url.startsWith('file:')) throw new Error('Expected local SQLite database');
  const db = new DatabaseSync(path.resolve(root, 'prisma', url.slice(5)));
  try { db.prepare('VACUUM INTO ?').run(path.join(out, 'local.sqlite')); } finally { db.close(); }
  const snapshot = new DatabaseSync(path.join(out, 'local.sqlite'), { readOnly: true });
  try {
    if (snapshot.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('SQLite integrity check failed');
  } finally { snapshot.close(); }
  const zip = new JSZip();
  const excluded = /(^|\/)(node_modules|\.git|\.next[^/]*|\.open-next|\.wrangler|data|output|generated|__pycache__)(\/|$)|(^|\/)\.env[^/]*$|(^|\/)\.dev\.vars[^/]*$|\.(db|sqlite|sqlite3|log|pem|key|p12|pfx|pyc)(-|$)|\.tsbuildinfo$/i;
  function add(relative) {
    if (excluded.test(relative.replaceAll('\\', '/'))) return;
    const full = path.join(root, relative);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) for (const name of fs.readdirSync(full)) add(path.join(relative, name));
    else zip.file(relative.replaceAll('\\', '/'), fs.readFileSync(full));
  }
  for (const name of ['src', 'prisma', 'scripts', 'docs', 'public', 'cloudflare']) if (fs.existsSync(path.join(root, name))) add(name);
  for (const name of fs.readdirSync(root)) if (/^(package(-lock)?\.json|README\.md|AGENTS\.md|next\.config\..*|open-next\.config\..*|wrangler\.(jsonc|toml)|tsconfig\.json|next-env\.d\.ts|postcss\.config\..*|tailwind\.config\..*|eslint\.config\..*|\.eslintrc.*|vitest\.config\..*|\.gitignore)$/.test(name)) add(name);
  fs.writeFileSync(path.join(out, 'source.zip'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  const manifest = {
    createdAt: new Date().toISOString(),
    commit: cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    status: cp.execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }),
    files: ['local.sqlite', 'source.zip'].map(name => ({ name, bytes: fs.statSync(path.join(out, name)).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(out, name))).digest('hex') })),
  };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ backup: out, integrity: 'ok', files: manifest.files.map(({name, bytes}) => ({name, bytes})) }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
