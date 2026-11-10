import test from 'node:test';
import assert from 'node:assert/strict';
import {storedZip,sha256} from '../src/zip-io.js';
import {analyzeSkillPackage,skillPairEvidence,skillFamilyKeys,SkillAnalysisError,skillAnalysisBounds} from '../../../scripts/analysis/skill-families.js';

const key=Buffer.alloc(32,7);
const fixture=(options:{sample?:string;expected?:string;script?:string;readme?:string;nested?:boolean}={})=>storedZip([
 {name:'SKILL.md',content:Buffer.from('Synthetic skill sample-'+(options.sample??'000001')+' document with enough inert lexical material to compare local variants. This is plain data; no instruction should be executed. https://synthetic.invalid/fixture')},
 {name:'scripts/check.py',content:Buffer.from(options.script??'print("synthetic inert text")\n')},
 {name:'README.md',content:Buffer.from(options.readme??'Common synthetic readme only')},
 {name:'_expected.json',content:Buffer.from(JSON.stringify({result:options.expected??'normal',reason:'Synthetic fixture only'}))},
 ...(options.nested?[{name:'payload/nested.zip',content:Buffer.from('intentionally invalid opaque nested archive bytes')}]:[])
]);
const analyze=(bytes:Buffer,nodeId='opaque-one',row:Record<string,unknown>={})=>analyzeSkillPackage({nodeId,row:{package_path:'packages/synthetic.zip',...row},resolveZip:async()=>bytes,fingerprintKey:key});

test('static ZIP features ignore container timestamps and retain nested archives opaque',async()=>{
 const original=fixture({nested:true}),retimed=Buffer.from(original);retimed.writeUInt16LE(0x2222,10);
 const left=await analyze(original),right=await analyze(retimed,'opaque-two');
 assert.notEqual(left.zipSha256,right.zipSha256);assert.equal(left.contentSetSha256,right.contentSetSha256);assert.equal(left.nestedArchiveCount,1);assert.equal(left.nestedArchivesExpanded,false);assert.equal(left.memberCount,5);assert.equal(left.rootSkillDocumentPresent,true);assert.equal(left.rootExpectedMetadataPresent,true);assert.equal(skillPairEvidence(left,right).hardRelation,true);
});

test('source truth is excluded from payload family signatures without modifying or interpreting it',async()=>{
 const left=await analyze(fixture({expected:'normal'})),right=await analyze(fixture({expected:'malicious'}),'opaque-two');
 assert.notEqual(left.contentSetSha256,right.contentSetSha256);assert.equal(left.payloadSetSha256,right.payloadSetSha256);assert.equal(skillPairEvidence(left,right).exactPayloadSet,true);assert.equal(left.members.length,4);
});

test('template-like rewrites are weak candidates, never automatic hard merges',async()=>{
 const left=await analyze(fixture({sample:'000001'})),right=await analyze(fixture({sample:'000002'}),'opaque-two');
 const evidence=skillPairEvidence(left,right);assert.equal(evidence.hardRelation,false);assert.equal(evidence.templateCandidate,true);assert.equal(evidence.keyContentCandidate,false);assert.ok(left.textBottomK.length>0);assert.equal(left.textBottomK.every(value=>/^[a-f0-9]{16}$/.test(value)),true);assert.match(left.textSimhash!,/^[a-f0-9]{16}$/);
 const serialized=JSON.stringify(left);for(const text of ['print(','https://','scripts/check.py','Common synthetic','sample-000001'])assert.equal(serialized.includes(text),false);
});

test('common readmes cannot produce a hard or key-content relation between different skills',async()=>{
 const left=await analyze(fixture({sample:'000001',script:'print("one")'})),right=await analyze(fixture({sample:'000002',script:'print("two")'}),'opaque-two');
 const evidence=skillPairEvidence(left,right);assert.equal(evidence.hardRelation,false);assert.equal(evidence.keyContentCandidate,false);assert.equal(left.roleCounts['support-document'],1);
});

test('wrong declared source hash or byte count rejects before archive parsing',async()=>{
 const bytes=fixture();await assert.rejects(analyze(bytes,'opaque',{package_sha256:'f'.repeat(64)}),(e:unknown)=>e instanceof SkillAnalysisError&&e.code==='SKILL_DECLARED_DIGEST_MISMATCH');
 await assert.rejects(analyze(bytes,'opaque',{package_bytes:1}),(e:unknown)=>e instanceof SkillAnalysisError&&e.code==='SKILL_DECLARED_SIZE_MISMATCH');
 const result=await analyze(bytes,'opaque',{package_sha256:sha256(bytes),package_bytes:bytes.length});assert.equal(result.declaredShaMatches,true);assert.equal(result.declaredBytesMatch,true);
});

test('case collisions, unsafe Windows names, corrupt CRC and bounded expansion fail closed',async()=>{
 const collision=storedZip([{name:'SKILL.md',content:Buffer.from('one')},{name:'skill.md',content:Buffer.from('two')}]);await assert.rejects(analyze(collision),(e:unknown)=>e instanceof SkillAnalysisError&&e.code==='SKILL_CASE_COLLISION');
 const reserved=storedZip([{name:'CON.txt',content:Buffer.from('data')}]);await assert.rejects(analyze(reserved),(e:unknown)=>e instanceof SkillAnalysisError&&e.code==='SKILL_UNSAFE_PATH');
 const corrupt=fixture();const nameLength=corrupt.readUInt16LE(26);corrupt[30+nameLength]^=1;await assert.rejects(analyze(corrupt),(e:unknown)=>e instanceof SkillAnalysisError&&e.code==='ZIP_INTEGRITY');
 await assert.rejects(analyzeSkillPackage({nodeId:'opaque',row:{package_path:'packages/synthetic.zip'},resolveZip:async()=>fixture(),fingerprintKey:key,bounds:{...skillAnalysisBounds,entry:1}}),(e:unknown)=>e instanceof SkillAnalysisError&&e.code==='ZIP_ENTRY_LIMIT');
});

test('resolver paths are validated and errors never include untrusted raw causes',async()=>{
 let called=false;await assert.rejects(analyzeSkillPackage({nodeId:'opaque',row:{package_path:'../unsafe.zip'},resolveZip:async()=>{called=true;return fixture();},fingerprintKey:key}),(e:unknown)=>e instanceof SkillAnalysisError&&e.code==='SKILL_UNSAFE_PATH');assert.equal(called,false);
 await assert.rejects(analyzeSkillPackage({nodeId:'opaque',row:{package_path:'packages/synthetic.zip'},resolveZip:async()=>{throw Error('secret untrusted sample');},fingerprintKey:key}),(e:unknown)=>e instanceof SkillAnalysisError&&e.message==='SKILL_RESOLVE_FAILED');
});

test('metadata reports only field availability and keyed features vary with the analysis key',async()=>{
 const row={source_id:'synthetic-source',meta:{source_version:'v1',source_url:'https://synthetic.invalid'}};
 const left=await analyze(fixture(),'opaque',row),right=await analyzeSkillPackage({nodeId:'opaque',row:{package_path:'packages/synthetic.zip',...row},resolveZip:async()=>fixture(),fingerprintKey:Buffer.alloc(32,8)});
 assert.deepEqual(left.sourceFieldsPresent,['meta.source_url','source_id']);assert.deepEqual(left.versionFieldsPresent,['meta.source_version']);assert.equal(left.zipSha256,right.zipSha256);assert.notEqual(left.keyContentSetHmac,right.keyContentSetHmac);assert.equal(JSON.stringify(left).includes('synthetic-source'),false);
});

test('join keys separate hard package evidence from pathless and template candidates',async()=>{
 const left=await analyze(fixture()),keys=skillFamilyKeys(left);
 assert.deepEqual(keys.filter(item=>item.strength==='hard').map(item=>item.reason),['skill_zip_exact','skill_member_set_exact','skill_payload_set_exact']);
 assert.equal(keys.find(item=>item.reason==='skill_pathless_payload_candidate')!.strength,'candidate');
 assert.equal(keys.find(item=>item.reason==='skill_template_candidate')!.strength,'candidate');
 assert.equal(keys.filter(item=>item.reason!=='skill_zip_exact').every(item=>/^[a-f0-9]{64}$/.test(item.key)),true);
 assert.notEqual(left.contentSetHmac,left.contentSetSha256);assert.notEqual(left.payloadSetHmac,left.payloadSetSha256);
});

test('ground-truth-only packages do not become an empty-payload duplicate family',async()=>{
 await assert.rejects(analyze(storedZip([{name:'_expected.json',content:Buffer.from('{"result":"normal"}')}])) ,(e:unknown)=>e instanceof SkillAnalysisError&&e.code==='SKILL_EMPTY_PAYLOAD');
});

test('only exact root expected metadata is excluded; nested same-name bytes remain payload',async()=>{
 const build=(nested:string)=>storedZip([{name:'SKILL.md',content:Buffer.from('Synthetic static skill document')},{name:'_expected.json',content:Buffer.from('{"result":"normal"}')},{name:'metadata/_expected.json',content:Buffer.from(nested)}]);
 const left=await analyze(build('synthetic nested one')),right=await analyze(build('synthetic nested two'),'opaque-two');
 assert.notEqual(left.payloadSetSha256,right.payloadSetSha256);assert.notEqual(left.keyContentSetHmac,right.keyContentSetHmac);assert.equal(skillPairEvidence(left,right).hardRelation,false);assert.equal(left.rootExpectedMetadataPresent,true);
 const caseVariant=await analyze(storedZip([{name:'SKILL.md',content:Buffer.from('Synthetic static skill document')},{name:'_EXPECTED.JSON',content:Buffer.from('{"result":"normal"}')} ]));
 assert.equal(caseVariant.rootExpectedMetadataPresent,false);
});

test('empty ZIP is rejected without producing empty family keys',async()=>{
 await assert.rejects(analyze(storedZip([])),(e:unknown)=>e instanceof SkillAnalysisError&&e.code==='SKILL_EMPTY_PACKAGE');
});
