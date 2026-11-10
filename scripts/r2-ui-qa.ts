/** Synthetic browser QA only. Never imports or reads benchmark bundles. */
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadConfig, projectRoot } from '../apps/server/src/config.js';
import { createApp } from '../apps/server/src/app.js';
import { DemoProvider } from '../apps/server/src/demo.js';
import { sha256, storedZip } from '../apps/server/src/zip-io.js';
import {InstanceRuntime} from '../apps/server/src/instance-runtime.js';
import {ApiError} from '../apps/server/src/errors.js';
import {requestIdentity} from '../apps/server/src/auth.js';
import {seedR22ReleaseBrowserFixtures} from './r22-ui-release-fixture.js';

const generation=['r3','r4','r5','r6','r7','r8','r9','r10'].includes(process.env.QA_GENERATION??'')?process.env.QA_GENERATION!:'r2';
const folder = path.join(projectRoot, '.data/'+generation+'-ui-qa');
const config = loadConfig({ DEMO_MODE: 'true', DEMO_DATA_FILE: path.join(folder, 'demo.json'), PORT: '3005', HOST: '127.0.0.1' });
const provider = new DemoProvider(config.demoFile); await provider.init();
const key = { namespace: 'local', repo: 'ai-safety-ui-qa' };
if (!(await provider.repos()).some(repo => repo.namespace === key.namespace && repo.name === key.repo)) {
  await provider.createRepo({ namespace: key.namespace, name: key.repo, description: '合成验收数据集：文本、标签、独立 ZIP 附件与协作发布。' });
  const attachment = storedZip([{ name: 'SKILL.md', content: Buffer.from('# Synthetic package\n\nAn inert fixture for displaying archive contents.\n') }, { name: 'notes.txt', content: Buffer.from('Synthetic version one.\n') }]);
  const rows = Array.from({ length: 12 }, (_, index) => ({ id: 'qa-' + (index + 1), ...(['r5','r6','r7','r8','r9','r10'].includes(generation)?{score:index+1}:{}),prompt: 'Synthetic sample ' + (index + 1) + '. This text is an inert UI fixture.', source_kind: index % 2 ? 'synthetic' : 'internal', messages: [{ role: 'user', content: 'Synthetic step ' + (index + 1) }], ...(index === 11 ? { package_path: 'packages/synthetic-skill.zip', package_sha256: sha256(attachment), package_bytes: attachment.length } : {}) }));
  if(['r4','r5','r6','r7','r8','r9','r10'].includes(generation))for(const [index,row]of rows.entries())Object.assign(row,{uid:'synthetic-uid-'+(index+1),title:'Synthetic title '+(index+1),description:'Synthetic description '+(index+1),unmapped_field:'Kept without an invented alias.',...(['r5','r6','r7','r8','r9','r10'].includes(generation)?{ground_truth:{result:'Synthetic source truth'}}:{})});
  if(['r6','r7','r8','r9','r10'].includes(generation))for(const [index,row]of rows.entries())Object.assign(row,{enabled:index%2===0,priority:'normal',categories:['alpha'],note:index%2===0?null:'Synthetic note'});
  const workspace = await provider.createWorkspace(key, 'Synthetic browser fixture', 'main');
  await provider.writeWorkspace(key, workspace.id, 'data/samples.jsonl', Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n'));
  await provider.writeWorkspace(key, workspace.id, 'bundle-manifest.json', Buffer.from(JSON.stringify({ canonical_data: 'data/samples.jsonl', row_count: 12, synthetic: true })));
  await provider.writeWorkspace(key, workspace.id, 'packages/synthetic-skill.zip', attachment);
  if(['r6','r7','r8','r9','r10'].includes(generation))await provider.writeWorkspace(key,workspace.id,'.oxenweb/repository.json',Buffer.from(JSON.stringify({version:1,description:'合成 R6 验收：类型、选项、会话修改状态。',tags:['aisec','synthetic'],defaultBranch:'main',visibility:'private',collaborators:[],updatedAt:new Date().toISOString(),updatedBy:'Instance owner'})));
  await provider.writeWorkspace(key, workspace.id, 'README.md', Buffer.from('# AI 安全样本集 · 交互验收\n\n此项目只有合成文本与无执行行为的 ZIP，用于核对 R1/R2 完整工作流。\n\n## 使用方法\n\n- 在数据编辑中直接浏览、编辑和打标。\n- 负责人分配任务，另一位人员复核。\n- 合并后通过 Releases 下载固定版本。\n\n## 来源与许可\n\n本项目为合成验收数据，可用于本机测试。\n'));
  await provider.writeWorkspace(key, workspace.id, '.oxenweb/labels.json', Buffer.from(JSON.stringify({ version: 1, columns: [{ id: 'source', name: '来源', type: 'multi', description: '样本最初取得的渠道。', scopes: ['dataset', 'file', 'row'], options: [{ value: 'internal', displayName: '内部采集' }, { value: 'synthetic', displayName: '合成数据' }, { value: 'unknown', displayName: '未知' }] }, { id: 'risk', name: '风险判定', type: 'single', description: '人工判断，与源记录分开。', scopes: ['row'], options: [{ value: 'benign', displayName: '正常' }, { value: 'uncertain', displayName: '不确定' }] }, { id: 'evidence', name: '证据说明', type: 'text', scopes: ['row'], description: '记录判定依据。' }], assignments: [] })));
  if(['r4','r5','r6','r7','r8','r9','r10'].includes(generation))await provider.writeWorkspace(key,workspace.id,'.oxenweb/dataset.json',Buffer.from(JSON.stringify({version:1,id:'synthetic-'+generation,name:'Synthetic metadata and selection fixture',canonicalPath:'data/samples.jsonl',readmePath:'README.md',identityField:'id',attachmentFields:['package_path'],source:'descriptor',fields:{title:{displayName:'业务标题',description:'来自项目字段定义的标题说明，优先于通用字典。'},...(generation==='r10'?{priority:{displayName:'优先级',type:'string',enum:['low','normal','high'],optionColors:{[JSON.stringify(['string','low'])]:'#50C6A9',[JSON.stringify(['string','normal'])]:'#E9AE60',[JSON.stringify(['string','high'])]:'#EE8795'}},categories:{displayName:'类别',type:'array',items:{type:'string',enum:['alpha','beta']}}}:{})}})));
  if(['r7','r8','r9','r10'].includes(generation)){await provider.writeWorkspace(key,workspace.id,'notes.txt',Buffer.from('Header\nStable line\nAn old synthetic sentence.\nFooter\n'));await provider.writeWorkspace(key,workspace.id,'comparison.json',Buffer.from(JSON.stringify({version:1,decision:'pending',evidence:'Synthetic audit record.'})));}
  const baseline = await provider.commitWorkspace(key, workspace.id, 'Synthetic R2 browser fixture'); await provider.deleteWorkspace(key, workspace.id);
  await provider.createBranch(key, 'review-demo', baseline.id);
  const variant = await provider.createWorkspace(key, 'Synthetic ZIP difference', 'review-demo');
  await provider.writeWorkspace(key, variant.id, 'packages/synthetic-skill.zip', storedZip([{ name: 'SKILL.md', content: Buffer.from('# Synthetic package\n\nAn inert fixture for displaying archive contents.\n') }, { name: 'notes.txt', content: Buffer.from('Synthetic version two.\n') }, { name: 'new-note.txt', content: Buffer.from('Added synthetic text.\n') }]));
  if(['r7','r8','r9','r10'].includes(generation)){await provider.writeWorkspace(key,variant.id,'notes.txt',Buffer.from('Header\nStable line\nAn updated synthetic sentence.\nAdded context.\nFooter\n'));await provider.writeWorkspace(key,variant.id,'comparison.json',Buffer.from(JSON.stringify({version:1,decision:'approved',evidence:'Synthetic audit record.'})));}
  await provider.commitWorkspace(key, variant.id, 'Change synthetic archive members'); await provider.deleteWorkspace(key, variant.id);
}
let loseNextCommitReply=false;const commitWorkspace=provider.commitWorkspace.bind(provider);
if(generation==='r10')provider.commitWorkspace=async(...args)=>{const result=await commitWorkspace(...args);if(loseNextCommitReply){loseNextCommitReply=false;throw new ApiError(504,'QA_COMMIT_REPLY_LOST','合成故障：远端完成后回复丢失，请核对操作。');}return result;};
const app = await createApp(config, provider,new InstanceRuntime());
if(generation==='r10')app.post('/api/qa/fault/next-commit',async request=>{if(requestIdentity(request).kind!=='owner')throw new ApiError(403,'OWNER_REQUIRED','仅合成验收管理员可注入故障。');loseNextCommitReply=true;return {armed:true,synthetic:true};});
const qaMetrics={datasetQueries:0,draftSaves:0,commits:0,projectLabelSaves:0,fieldSaves:0,checkpointSaves:0};
app.addHook('onRequest',async request=>{const endpoint=request.url.split('?')[0]!;if(request.method==='POST'&&/\/dataset\/(?:draft\/)?query$/.test(endpoint))qaMetrics.datasetQueries++;if(request.method==='PUT'&&/\/dataset\/draft$/.test(endpoint))qaMetrics.draftSaves++;if(request.method==='POST'&&/\/dataset\/(save|draft\/commit)$/.test(endpoint))qaMetrics.commits++;if(request.method==='PUT'&&endpoint.endsWith('/project-labels'))qaMetrics.projectLabelSaves++;if(request.method==='PUT'&&endpoint.endsWith('/dataset/fields'))qaMetrics.fieldSaves++;if(request.method==='PUT'&&endpoint.endsWith('/dataset/ui-state'))qaMetrics.checkpointSaves++;});
app.get('/api/qa/metrics',async()=>({...qaMetrics}));
const base = '/api/repos/local/ai-safety-ui-qa';
if(generation!=='r2'){
  const check=async(method:'GET'|'POST',url:string,payload?:object)=>{const result=await app.inject({method,url,headers:{'x-oxen-request':'web'},...(payload===undefined?{}:{payload})});if(result.statusCode>=300)throw new Error(result.body);return result.json();};
  const schema=await check('GET',base+'/schema?ref=main');
  if(schema.binding?.version!==2){
    const layers:Record<string,unknown>={};
    for(const [layer,presetId]of [['dataset','dataset-ai-safety'],['sample','sample-injection']]){const id='qa_'+layer,draft=await check('POST','/api/governance/organizations/local/templates/from-preset',{presetId,id,name:layer==='dataset'?'AI 安全数据集':'提示词注入分析'});await check('POST','/api/governance/organizations/local/templates/'+id+'/publish',{expectedRevision:draft.revision});layers[layer!]={organizationId:'local',templateId:id,templateVersion:1};}
    const bound=await check('POST',base+'/schema/layers',{ref:'main',expectedCommit:schema.commitId,layers});
    const page=await check('GET',base+'/dataset?ref=main');
    const chosen=Object.fromEntries(['dataset_subject','purpose','modality','source'].map(id=>{const column=page.columnsByScope.dataset.find((item:any)=>item.id===id);return [id,column.type==='multi'?[column.options[0].value]:column.options[0].value];}));
    await check('POST',base+'/dataset/save',{ref:'main',expectedCommit:bound.commitId,message:'Synthetic catalog metadata',operations:[{op:'assign',scope:'dataset',values:chosen}]});
  }
}
const state = (await app.inject({ url: base + '/settings' })).json();
if (!state.policy.collaborators.length) {
  const actors: Array<{ name: string; id: string; role: string; token: string }> = [];
  for (const [name, role] of [['合成标注员 A', 'annotator'], ['合成标注员 B', 'annotator'], ['合成复核员', 'reviewer']] as const) {
    const response = await app.inject({ method: 'POST', url: base + '/access', headers: { 'x-oxen-request': 'web' }, payload: { name, role } });
    if (response.statusCode !== 201) throw new Error(response.body);
    const value = response.json(); actors.push({ name, role, id: value.collaborator.id, token: value.token });
  }
  await mkdir(folder, { recursive: true }); await writeFile(path.join(folder, 'actors.json'), JSON.stringify(actors), { mode: 0o600 });
}
if(generation==='r10')await seedR22ReleaseBrowserFixtures(app,provider);
await app.listen({ host: config.host, port: config.port });
process.stdout.write('Synthetic '+generation.toUpperCase()+' QA BFF ready at http://127.0.0.1:3005\n');
const stop = async () => { await app.close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
