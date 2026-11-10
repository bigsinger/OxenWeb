/** Disposable synthetic UI server for CI. Never starts, stops or reads native Oxen. */
import {createServer as createNetServer} from 'node:net';
import path from 'node:path';
import {createServer} from 'vite';
import {projectRoot} from '../apps/server/src/config.js';

async function requireFreePort(port:number){await new Promise<void>((resolve,reject)=>{const probe=createNetServer();probe.once('error',()=>reject(new Error(`Synthetic E2E port ${port} is already in use; refusing to adopt or change an existing service.`)));probe.listen(port,'127.0.0.1',()=>probe.close(error=>error?reject(error):resolve()));});}
await requireFreePort(3005);await requireFreePort(5173);
process.env.QA_GENERATION='r10';
await import('./r2-ui-qa.js');
const vite=await createServer({root:path.join(projectRoot,'apps/web'),configFile:path.join(projectRoot,'apps/web/vite.config.ts'),server:{host:'127.0.0.1',port:5173,strictPort:true,hmr:false,proxy:{'/api':{target:'http://127.0.0.1:3005',changeOrigin:false},'/downloads':{target:'http://127.0.0.1:3005',changeOrigin:false}}}});
await vite.listen();process.stdout.write('Synthetic browser regression ready at http://127.0.0.1:5173\n');
process.once('SIGINT',()=>{void vite.close();});process.once('SIGTERM',()=>{void vite.close();});
