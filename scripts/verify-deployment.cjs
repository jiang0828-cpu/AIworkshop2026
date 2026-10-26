const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const base = process.argv[2] || 'https://ai-workbench.jianghaohan0828.workers.dev';
const destination = process.argv[3];
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function main() {
  const root = await fetch(base, { redirect: 'manual' });
  const login = await fetch(`${base}/login`);
  const api = await fetch(`${base}/api/data`);
  const backup = await fetch(`${base}/api/backup`);
  const invalidLogin = await fetch(`${base}/api/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:'deployment-test@example.invalid',password:'invalid-test-only'}) });
  if (![302,307,308].includes(root.status) || !root.headers.get('location')?.endsWith('/login') || login.status !== 200 || api.status !== 401 || backup.status !== 401 || invalidLogin.status !== 401) throw new Error('Online access or authentication verification failed');
  const directory = '.open-next/assets/_next/static/chunks/app';
  const chunks = [];
  for (const name of fs.readdirSync(directory).filter(name=>/^page-.*\.js$/.test(name))) {
    const local = fs.readFileSync(path.join(directory,name));
    const response = await fetch(`${base}/_next/static/chunks/app/${name}`);
    const remote = Buffer.from(await response.arrayBuffer());
    const matches = response.status === 200 && sha256(local) === sha256(remote);
    if (!matches) throw new Error('Published application asset differs from local build');
    chunks.push({name,bytes:local.length,sha256:sha256(local),matches});
  }
  if (!chunks.length) throw new Error('Missing application asset');
  const report = { verifiedAt:new Date().toISOString(),base,root:root.status,login:login.status,unauthorizedData:api.status,unauthorizedBackup:backup.status,invalidLogin:invalidLogin.status,chunks };
  if (destination) fs.writeFileSync(destination,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
