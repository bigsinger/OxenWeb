import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { projectRoot } from './config.js';
import path from 'node:path';
import {acquireInstanceLease,InstanceRuntime} from './instance-runtime.js';
import {operationalLog} from './operational-log.js';

// An explicit root .env takes priority; the project-owned local Oxen service supplies defaults.
for (const filename of [path.join(projectRoot, '.env'), path.join(projectRoot, 'infra/oxen/local.env')]) {
  try { process.loadEnvFile(filename); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

const config = loadConfig();
const lease=await acquireInstanceLease(config),runtime=new InstanceRuntime();
const app = await createApp(config,undefined,runtime).catch(async error=>{await lease.release();throw error;});
app.addHook('onClose',async()=>{await lease.release();});
let stopping=false;
const stop = async () => {if(stopping)return;stopping=true;operationalLog('instance.draining',{pid:process.pid});try{await runtime.drain(30_000);await app.close();process.exitCode=0;operationalLog('instance.stopped',{pid:process.pid});}catch{operationalLog('instance.drain_failed',{pid:process.pid,code:'DRAIN_OR_CLOSE_FAILED'});stopping=false;}};
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
await app.listen({ host: config.host, port: config.port }).catch(async error=>{await app.close();throw error;});
process.stdout.write(`Oxen Web BFF ready at http://${config.host}:${config.port} (${config.demo ? 'explicit local demo mode' : 'live Oxen mode'})\n`);
operationalLog('instance.started',{pid:process.pid,mode:config.demo?'demo':'live'});
