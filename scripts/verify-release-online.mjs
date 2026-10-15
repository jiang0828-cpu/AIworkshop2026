import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const base = 'https://ai-workbench.jianghaohan0828.workers.dev';
const directory = path.resolve(process.argv[2]);
const checks = [];
for (const [route, statuses] of [['/?section=actions', [302, 307]], ['/login', [200]], ['/api/data', [401]], ['/api/daily-collaboration', [401]]]) {
  const response = await fetch(base + route, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
  if (!statuses.includes(response.status)) throw new Error(`Online check failed for ${route}: ${response.status}`);
  checks.push({ route, status: response.status, location: response.headers.get('location') });
  await response.arrayBuffer();
}
const chunks = path.resolve('.open-next/assets/_next/static/chunks/app');
const page = (await fs.readdir(chunks)).find(name => /^page-[\w-]+\.js$/.test(name));
if (!page) throw new Error('Application page chunk not found');
const route = '/_next/static/chunks/app/' + page;
const response = await fetch(base + route, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error('Application asset unavailable: ' + response.status);
const digest = content => createHash('sha256').update(content).digest('hex');
const onlineHash = digest(Buffer.from(await response.arrayBuffer()));
if (onlineHash !== digest(await fs.readFile(path.join(chunks, page)))) throw new Error('Online asset does not match this release');
checks.push({ route, status: response.status, sha256: onlineHash, matchesBuild: true });
const local = await fetch('http://localhost:3012/?section=actions', { signal: AbortSignal.timeout(30000) });
checks.push({ route: 'http://localhost:3012/?section=actions', status: local.status });
if (!local.ok) throw new Error('Local preview unavailable');
await local.arrayBuffer();
const result = { verifiedAt: new Date().toISOString(), base, checks, authenticatedFlowVerified: false, note: 'Existing cloud login credentials are not configured locally; no authentication settings were changed.' };
await fs.writeFile(path.join(directory, 'online-verification.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
