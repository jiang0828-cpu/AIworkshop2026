const fs = require('node:fs');
const cp = require('node:child_process');
if (fs.existsSync('.env')) process.loadEnvFile('.env');
const files = cp.execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).toString().split('\0').filter(Boolean);
const values = Object.entries(process.env).filter(([key, value]) => /KEY|TOKEN|PASSWORD|SECRET/.test(key) && value && value.length >= 12).map(([,value]) => value);
const problems = [];
for (const file of files) {
  const normalized = file.replaceAll('\\', '/');
  const forbiddenPath = /^(data|output|node_modules|\.next[^/]*|\.open-next|\.wrangler)\//.test(normalized) || /(^|\/)\.(env|dev\.vars)(?!\.example$)([^/]*$)/.test(normalized) || /\.(db|sqlite|sqlite3|pem|key|p12|pfx|log)(-|$)/i.test(normalized);
  const content = cp.execFileSync('git', ['show', `:${file}`], { maxBuffer: 30 * 1024 * 1024 }).toString();
  if (forbiddenPath || values.some(value => content.includes(value)) || /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content) || /\bsk-[a-zA-Z0-9]{24,}\b/.test(content)) problems.push(file);
}
console.log(JSON.stringify({ checked: files.length, candidateFiles: problems }));
if (problems.length) process.exitCode = 1;
