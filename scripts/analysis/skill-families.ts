/**
 * Offline static features only. Callers supply pinned bytes; this module has no filesystem,
 * network, CLI or execution capability. Fingerprints are evidence, never safety judgments.
 */
import {createHash,createHmac} from 'node:crypto';
import path from 'node:path';
import {readZipMembers,utf8Text,type ZipBounds} from '../../apps/server/src/zip-io.js';

export const skillAnalysisBounds:ZipBounds={bytes:16*1024*1024,entries:512,expanded:32*1024*1024,entry:8*1024*1024,ratio:1000,timeout:20_000};
export type SkillMemberRole='skill-document'|'code-or-config'|'nested-archive'|'support-document'|'other';
export interface SkillMemberFeature {
  pathHmac:string;
  contentHmac:string;
  role:SkillMemberRole;
  bytes:number;
  templateHmac?:string;
  textTokenCount?:number;
}
export interface SkillPackageFeatures {
  nodeId:string;
  zipSha256:string;
  /** Sorted normalized member paths + actual member SHA; no ZIP timestamps or compression. */
  contentSetSha256:string;
  /** Same as above, excluding expected ground-truth metadata; no label-derived family grouping. */
  payloadSetSha256:string;
  /** Path-independent multiset; catches renamed members but remains only a candidate clue. */
  payloadBytesSetSha256:string;
  contentSetHmac:string;
  payloadSetHmac:string;
  payloadBytesSetHmac:string;
  keyContentSetHmac?:string;
  keyTemplateSetHmac?:string;
  members:SkillMemberFeature[];
  memberCount:number;
  directoryCount:number;
  expandedBytes:number;
  nestedArchiveCount:number;
  rootSkillDocumentPresent:boolean;
  rootExpectedMetadataPresent:boolean;
  roleCounts:Record<SkillMemberRole,number>;
  /** Keyed bottom-k lexical shingles; approximate candidates only, no original text/tokens. */
  textBottomK:string[];
  textSimhash?:string;
  totalTextTokens:number;
  textTruncatedForSketch:boolean;
  sourceFieldsPresent:string[];
  versionFieldsPresent:string[];
  declaredShaMatches?:boolean;
  declaredBytesMatch?:boolean;
  nestedArchivesExpanded:false;
}
export interface SkillPackageAnalysisInput {
  nodeId:string;
  row:Readonly<Record<string,unknown>>;
  resolveZip:(packagePath:string)=>Promise<Buffer>;
  fingerprintKey:Uint8Array|string;
  bounds?:ZipBounds;
}
export class SkillAnalysisError extends Error {
  constructor(readonly code:string){super(code);this.name='SkillAnalysisError';}
}
const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const fail=(code:string):never=>{throw new SkillAnalysisError(code);};
const object=(value:unknown):Record<string,unknown>|undefined=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const present=(value:unknown)=>value!==undefined&&value!==null&&value!=='';
const roles:SkillMemberRole[]=['skill-document','code-or-config','nested-archive','support-document','other'];
const reserved=/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
function safeRelativePath(value:unknown){
  if(typeof value!=='string'||!value||value.length>1024||/[\\\x00-\x1f\x7f]/.test(value)||value.startsWith('/')||/^[A-Za-z]:/.test(value))return fail('SKILL_UNSAFE_PATH');
  const normalized=value.normalize('NFC'),parts=normalized.replace(/\/$/,'').split('/');
  if(parts.some(part=>!part||part==='.'||part==='..'||/[<>:"|?*]/.test(part)||/[. ]$/.test(part)||reserved.test(part)||Buffer.byteLength(part)>255))return fail('SKILL_UNSAFE_PATH');
  return normalized;
}
function memberRole(name:string):SkillMemberRole{
  const basename=path.posix.basename(name).toLowerCase(),extension=path.posix.extname(basename);
  if(basename==='skill.md')return'skill-document';
  if(/\.(?:zip|jar|whl|gz|bz2|xz|7z|rar|tar)$/i.test(basename))return'nested-archive';
  if(/^(?:readme|license|licence|notice|copying|changelog|authors|contributors)(?:\.|$)/i.test(basename)||/^(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|requirements\.txt|poetry\.lock|uv\.lock|cargo\.lock|package\.json|pyproject\.toml)$/.test(basename))return'support-document';
  if(['.py','.js','.mjs','.cjs','.ts','.tsx','.jsx','.sh','.bash','.zsh','.ps1','.psm1','.bat','.cmd','.rb','.go','.rs','.java','.c','.h','.cc','.cpp','.php','.pl','.lua','.sql','.yaml','.yml','.json','.toml','.ini','.cfg','.xml'].includes(extension))return'code-or-config';
  return'other';
}
/** Broad template normalization only creates weak candidate evidence. Raw bytes remain distinct. */
function candidateTemplate(text:string){
  return text.normalize('NFC').replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,'<uuid>')
    .replace(/\b(?:skill|sample|case)[-_ ]?\d{2,}\b/gi,'<sample-id>')
    .replace(/https?:\/\/[^\s<>"'`]+/gi,'<url>')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'<email>')
    .replace(/\b\d+(?:\.\d+)*\b/g,'<number>').replace(/\s+/g,' ').trim();
}
function lexicalTokens(text:string){return text.normalize('NFC').toLocaleLowerCase('en-US').match(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu)??[];}
function sketch(tokens:string[],key:Uint8Array|string){
  const bottom=new Set<string>(),votes=new Int32Array(64),counts=new Map<string,number>();
  for(let i=0;i+4<tokens.length;i++)bottom.add(createHmac('sha256',key).update('skill-shingle-v1\0'+tokens.slice(i,i+5).join('\0')).digest('hex').slice(0,16));
  for(const token of tokens)counts.set(token,(counts.get(token)??0)+1);
  for(const[token,count]of counts){const bytes=createHmac('sha256',key).update('skill-token-v1\0'+token).digest();const weight=1+Math.floor(Math.log2(count));for(let bit=0;bit<64;bit++)votes[bit]!+=(bytes[bit>>>3]!&(1<<(bit%8)))?weight:-weight;}
  let simhash=0n;for(let bit=0;bit<64;bit++)if(votes[bit]!>0)simhash|=1n<<BigInt(bit);
  return{bottom:[...bottom].sort().slice(0,64),simhash:tokens.length>=20?simhash.toString(16).padStart(16,'0'):undefined};
}
function metadataPresence(row:Readonly<Record<string,unknown>>){
  const source=['source_dataset','source_id','source_url','repository','repo_url','original_skill','upstream_skill','parent_id'];
  const version=['version','source_version','upstream_version','revision','parent_version'];
  const nested=['meta','metadata','provenance','_provenance','_oxenweb_provenance','_oxenweb_source'];
  const sourceFieldsPresent=source.filter(key=>present(row[key])),versionFieldsPresent=version.filter(key=>present(row[key]));
  for(const root of nested){const value=object(row[root]);if(value){for(const key of source)if(present(value[key]))sourceFieldsPresent.push(root+'.'+key);for(const key of version)if(present(value[key]))versionFieldsPresent.push(root+'.'+key);}}
  return{sourceFieldsPresent:sourceFieldsPresent.sort(),versionFieldsPresent:versionFieldsPresent.sort()};
}

export async function analyzeSkillPackage(input:SkillPackageAnalysisInput):Promise<SkillPackageFeatures>{
  if(typeof input.nodeId!=='string'||!input.nodeId)return fail('SKILL_NODE_ID_REQUIRED');
  if((typeof input.fingerprintKey==='string'?Buffer.byteLength(input.fingerprintKey):input.fingerprintKey.byteLength)<16)return fail('SKILL_FINGERPRINT_KEY_REQUIRED');
  const packagePath=safeRelativePath(input.row.package_path);if(!packagePath.toLowerCase().endsWith('.zip'))return fail('SKILL_PACKAGE_NOT_ZIP');
  let content:Buffer;try{content=await input.resolveZip(packagePath);}catch{return fail('SKILL_RESOLVE_FAILED');}
  if(!Buffer.isBuffer(content))return fail('SKILL_RESOLVER_NOT_BYTES');
  const zipSha256=digest(content),declaredSha=input.row.package_sha256,declaredBytes=input.row.package_bytes;
  if(present(declaredSha)&&(typeof declaredSha!=='string'||declaredSha.toLowerCase()!==zipSha256))return fail('SKILL_DECLARED_DIGEST_MISMATCH');
  if(present(declaredBytes)&&declaredBytes!==content.length)return fail('SKILL_DECLARED_SIZE_MISMATCH');
  let entries:Awaited<ReturnType<typeof readZipMembers>>;
  try{entries=await readZipMembers(content,input.bounds??skillAnalysisBounds);}catch(error){const code=object(error)?.code;return fail(typeof code==='string'&&/^ZIP_[A-Z_]+$/.test(code)?code:'SKILL_ZIP_REJECTED');}
  const mac=(scope:string,value:string|Uint8Array)=>createHmac('sha256',input.fingerprintKey).update(scope+'\0').update(value).digest('hex');
  const seen=new Set<string>(),members:SkillMemberFeature[]=[],fileItems:{name:string;sha:string;expected:boolean}[]=[],roleCounts=Object.fromEntries(roles.map(role=>[role,0])) as Record<SkillMemberRole,number>;
  const keyDigests:string[]=[],templateDigests:string[]=[],allTokens:string[]=[];let totalTextTokens=0,expandedBytes=0,directoryCount=0,textTruncatedForSketch=false;
  const sketchTokenLimit=120_000;
  for(const entry of entries){
    const name=safeRelativePath(entry.name),collision=name.replace(/\/$/,'').toLocaleLowerCase('en-US');if(seen.has(collision))return fail('SKILL_CASE_COLLISION');seen.add(collision);
    if(entry.type==='directory'){directoryCount++;continue;}
    expandedBytes+=entry.content.length;const expected=name==='_expected.json',role=memberRole(name);roleCounts[role]++;
    fileItems.push({name,sha:entry.sha256,expected});
    const item:SkillMemberFeature={pathHmac:mac('member-path-v1',name),contentHmac:mac('member-content-v1',entry.content),role,bytes:entry.content.length};
    if(!expected&&(role==='skill-document'||role==='code-or-config')){
      keyDigests.push(role+'\0'+item.contentHmac);
      const text=utf8Text(entry.content,2*1024*1024);if(text!==undefined){
        const template=candidateTemplate(text),tokens=lexicalTokens(text);item.templateHmac=mac('member-template-v1',template);item.textTokenCount=tokens.length;templateDigests.push(role+'\0'+item.templateHmac);
        totalTextTokens+=tokens.length;const free=Math.max(0,sketchTokenLimit-allTokens.length);for(let index=0;index<Math.min(tokens.length,free);index++)allTokens.push(tokens[index]!);if(tokens.length>free)textTruncatedForSketch=true;
      }
    }
    members.push(item);
  }
  if(!fileItems.length)return fail('SKILL_EMPTY_PACKAGE');
  const sorted=fileItems.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0),payload=sorted.filter(file=>!file.expected);if(!payload.length)return fail('SKILL_EMPTY_PAYLOAD');const textSketch=sketch(allTokens,input.fingerprintKey);
  const contentSet=sorted.map(file=>file.name+'\0'+file.sha).join('\n'),payloadSet=payload.map(file=>file.name+'\0'+file.sha).join('\n'),payloadBytesSet=payload.map(file=>file.sha).sort().join('\n');
  return{nodeId:input.nodeId,zipSha256,contentSetSha256:digest(contentSet),payloadSetSha256:digest(payloadSet),payloadBytesSetSha256:digest(payloadBytesSet),contentSetHmac:mac('full-content-set-v1',contentSet),payloadSetHmac:mac('payload-content-set-v1',payloadSet),payloadBytesSetHmac:mac('payload-pathless-set-v1',payloadBytesSet),
    ...(keyDigests.length?{keyContentSetHmac:mac('key-content-set-v1',keyDigests.sort().join('\n'))}:{}),...(templateDigests.length?{keyTemplateSetHmac:mac('key-template-set-v1',templateDigests.sort().join('\n'))}:{}),members,memberCount:fileItems.length,directoryCount,expandedBytes,nestedArchiveCount:roleCounts['nested-archive'],rootSkillDocumentPresent:fileItems.some(file=>file.name.toLowerCase()==='skill.md'),rootExpectedMetadataPresent:fileItems.some(file=>file.name==='_expected.json'),roleCounts,textBottomK:textSketch.bottom,...(textSketch.simhash?{textSimhash:textSketch.simhash}:{}),totalTextTokens,textTruncatedForSketch,...metadataPresence(input.row),...(present(declaredSha)?{declaredShaMatches:true}:{}),...(present(declaredBytes)?{declaredBytesMatch:true}:{}),nestedArchivesExpanded:false};
}

/** Exact member sets are hard evidence; weaker key/template similarity must be reviewed. */
export function skillPairEvidence(left:SkillPackageFeatures,right:SkillPackageFeatures){
  const exactZip=left.zipSha256===right.zipSha256,exactContentSet=left.contentSetSha256===right.contentSetSha256,exactPayloadSet=left.payloadSetSha256===right.payloadSetSha256;
  const renamedPayloadCandidate=left.payloadBytesSetSha256===right.payloadBytesSetSha256;
  const keyContentCandidate=!!left.keyContentSetHmac&&left.keyContentSetHmac===right.keyContentSetHmac;
  const templateCandidate=!!left.keyTemplateSetHmac&&left.keyTemplateSetHmac===right.keyTemplateSetHmac;
  const intersection=left.textBottomK.filter(value=>right.textBottomK.includes(value)).length,union=new Set([...left.textBottomK,...right.textBottomK]).size;
  return{exactZip,exactContentSet,exactPayloadSet,hardRelation:exactZip||exactContentSet||exactPayloadSet,renamedPayloadCandidate,keyContentCandidate,templateCandidate,lexicalBottomKJaccard:union?intersection/union:0};
}

export type SkillFamilyReason='skill_zip_exact'|'skill_member_set_exact'|'skill_payload_set_exact'|'skill_pathless_payload_candidate'|'skill_key_content_candidate'|'skill_template_candidate';
export interface SkillFamilyKey {key:string;reason:SkillFamilyReason;strength:'hard'|'candidate'}
/** Join only equal keys with the same reason. Candidate buckets do not authorize hard merges. */
export function skillFamilyKeys(feature:SkillPackageFeatures):SkillFamilyKey[]{
  return[
    {key:feature.zipSha256,reason:'skill_zip_exact',strength:'hard'},
    {key:feature.contentSetHmac,reason:'skill_member_set_exact',strength:'hard'},
    {key:feature.payloadSetHmac,reason:'skill_payload_set_exact',strength:'hard'},
    {key:feature.payloadBytesSetHmac,reason:'skill_pathless_payload_candidate',strength:'candidate'},
    ...(feature.keyContentSetHmac?[{key:feature.keyContentSetHmac,reason:'skill_key_content_candidate' as const,strength:'candidate' as const}]:[]),
    ...(feature.keyTemplateSetHmac?[{key:feature.keyTemplateSetHmac,reason:'skill_template_candidate' as const,strength:'candidate' as const}]:[])
  ];
}
