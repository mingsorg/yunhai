import { spawn } from 'node:child_process';
import { mkdtempSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = Number(process.env.MCP_TEST_PORT ?? 8793);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid MCP_TEST_PORT');
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, MCP_BASE_URL: base, WRANGLER_SEND_METRICS: 'false' };
let server;
function stop() {
  if (server?.pid) {
    try { process.kill(-server.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    server = undefined;
  }
}
process.on('exit', stop);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130));
async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn('pnpm', args, { env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${args.join(' ')} failed (${code ?? signal})`)));
  });
}
try {
  // Any listener, including one returning a non-success response, belongs to someone else.
  try {
    await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
    throw new Error(`Port ${port} is in use; set MCP_TEST_PORT to a free port.`);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
  await run(['test']);
  await run(['typecheck']);
  await run(['build:check']);
  const log = join(mkdtempSync(join(tmpdir(), 'yunhai-check-')), 'worker.log');
  const fd = openSync(log, 'w');
  server = spawn('pnpm', ['exec', 'wrangler', 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port)], {
    env, detached: true, stdio: ['ignore', fd, fd],
  });
  closeSync(fd);
  server.on('error', (error) => { console.error(error.message); process.exit(1); });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error(`Worker exited; inspect ${log}`);
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
      const body = await response.json();
      if (response.ok && body.synthetic === true && body.status === 'ok') { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error(`Worker not ready; inspect ${log}`);
  await run(['verify']);
  console.log(`Local verification passed. Worker log: ${log}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { stop(); }
