import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { projectRoot } from './config.js';
import path from 'node:path';

// An explicit root .env takes priority; the project-owned local Oxen service supplies defaults.
for (const filename of [path.join(projectRoot, '.env'), path.join(projectRoot, 'infra/oxen/local.env')]) {
  try { process.loadEnvFile(filename); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

const config = loadConfig();
const app = await createApp(config);
const stop = async () => { await app.close(); process.exit(0); };
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
await app.listen({ host: config.host, port: config.port });
process.stdout.write(`Oxen Web BFF ready at http://${config.host}:${config.port} (${config.demo ? 'explicit local demo mode' : 'live Oxen mode'})\n`);
