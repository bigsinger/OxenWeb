import {createHmac} from 'node:crypto';

/** Offline, read-only features. This module has no filesystem, HTTP, model or process access. */
export type TextDatasetKind='sensitive'|'prompt-injection'|'behavior-drift';
export type TextFamilyReason='namespaced_source_id'|'namespaced_case_id'|'explicit_parent_id'|'exact_primary_text'|'normalized_text'|'entity_masked_template'|'variable_masked_template'|'exact_context'|'context_template';
export interface TextFamilyKey {reason:TextFamilyReason;channel:string;key:string}
export interface TextFingerprint {
 channel:string;path:string;exact:string;normalized:string;template?:string;chars:number;
 shingleSketch:string[];sampledShingles:number;samplingStride:number;approximationTruncated:boolean;
}
export interface TextFamilyFeatures {
 rowId:string;kind:TextDatasetKind;hardKeys:TextFamilyKey[];candidateKeys:TextFamilyKey[];
 textFingerprints:TextFingerprint[];entityDigests:string[];flags:string[];
 stats:{textChannels:number;primaryChars:number;entities:number;invalidEntitySpans:number};
}
export interface TextFamilyOptions {
 datasetKind:TextDatasetKind;sourceNamespace:string;row:Record<string,unknown>;rowId:string;hmacKey:Uint8Array;
 /** Override after inspecting field STRUCTURE. Dotted paths are literal object traversal, never expressions. */
 paths?:{primary?:string[];context?:string[];caseId?:string;sourceDataset?:string;sourceId?:string;parents?:string[]};
 minimumExactChars?:number;maximumApproximationChars?:number;maximumSampledShingles?:number;sketchSize?:number;
}
const defaultContexts=['user_query','original_goal','trusted_context','target_goal','attack_payload','authorization_rule','steps','expected_plan_trajectory','trajectory','trace','messages','conversation','user_prompt','task_goal'];
const identityMissing=new Set(['unknown','none','null','n/a','na','not applicable','未知','不适用','未提供']);
function at(row:Record<string,unknown>,path:string):unknown {let value:unknown=row;for(const key of path.split('.')){if(value===null||typeof value!=='object'||Array.isArray(value)||!Object.hasOwn(value,key))return undefined;value=(value as Record<string,unknown>)[key];}return value;}
function stable(value:unknown):string {
 if(value===null)return'null';
 if(typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return'['+value.map(stable).join(',')+']';
 if(value&&typeof value==='object')return'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable((value as Record<string,unknown>)[key])).join(',')+'}';
 throw new Error('Text analysis accepts finite JSON values only.');
}
function id(value:unknown):string|undefined {
 const text=typeof value==='string'?value:typeof value==='number'&&Number.isFinite(value)?String(value):undefined;
 return text&&text.trim()&&text.length<=2048&&!identityMissing.has(text.trim().toLowerCase())?text:undefined;
}
const normalized=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim();
function boundedInteger(value:number|undefined,fallback:number,min:number,max:number){const result=value??fallback;if(!Number.isInteger(result)||result<min||result>max)throw new Error('Text feature limits are invalid.');return result;}

/** Domain-separated HMAC protects low-entropy entities and source IDs; keep the key local. */
export function extractTextFamilyFeatures(options:TextFamilyOptions):TextFamilyFeatures {
 if(options.hmacKey.byteLength<32||!options.rowId||!options.sourceNamespace)throw new Error('A local 32-byte key and opaque identities are required.');
 const {row,datasetKind:kind}=options,minimum=boundedInteger(options.minimumExactChars,32,1,4096),maxChars=boundedInteger(options.maximumApproximationChars,40000,128,1000000),maxShingles=boundedInteger(options.maximumSampledShingles,2048,64,16384),sketchSize=boundedInteger(options.sketchSize,64,16,256);
 const mac=(domain:string,value:unknown)=>createHmac('sha256',options.hmacKey).update(stable([domain,value])).digest('hex');
 const output:TextFamilyFeatures={rowId:options.rowId,kind,hardKeys:[],candidateKeys:[],textFingerprints:[],entityDigests:[],flags:[],stats:{textChannels:0,primaryChars:0,entities:0,invalidEntitySpans:0}};
 const add=(hard:boolean,reason:TextFamilyReason,channel:string,domain:string,value:unknown)=>{const key=mac(domain,value),target=hard?output.hardKeys:output.candidateKeys;if(!target.some(item=>item.key===key&&item.channel===channel&&item.reason===reason))target.push({reason,channel,key});};
 const sourceDataset=id(at(row,options.paths?.sourceDataset??'source_dataset'))??id(at(row,'source'))??options.sourceNamespace;
 const sourceId=id(at(row,options.paths?.sourceId??(kind==='behavior-drift'?'source_sample_id':'source_id')));
 if(sourceId)add(true,'namespaced_source_id','source_identity','source-id-v1',[kind,sourceDataset,sourceId]);
 if(kind==='behavior-drift'){
  const caseId=id(at(row,options.paths?.caseId??'case_id'));
  if(caseId)add(true,'namespaced_case_id','case_identity','case-id-v1',[options.sourceNamespace,sourceDataset,caseId]);else output.flags.push('missing_case_id');
 }
 const parentPaths=options.paths?.parents??['parent_id','original_id','origin_id','base_id','meta.parent_id','meta.original_id','meta.origin_id','meta.base_id','meta.augmentation_of'];
 for(const path of parentPaths){const parent=id(at(row,path));if(parent)add(true,'explicit_parent_id','source_identity','source-id-v1',[kind,sourceDataset,parent]);}

 const entityValues=new Set<string>();
 function entity(value:unknown){if(typeof value==='string'&&value.length&&value.length<=4096)entityValues.add(value);else if(value&&typeof value==='object'&&!Array.isArray(value)){const record=value as Record<string,unknown>;for(const key of ['value','text','entity','surface','canonical'])if(typeof record[key]==='string')entity(record[key]);}}
 if(kind==='sensitive'){
  const values=at(row,'ground_truth.sensitive_values');if(Array.isArray(values)){values.slice(0,256).forEach(entity);if(values.length>256)output.flags.push('entity_values_truncated');}
  const spans=at(row,'ground_truth.sensitive_spans');if(Array.isArray(spans)&&spans.length>256)output.flags.push('entity_spans_truncated');if(Array.isArray(spans))for(const span of spans.slice(0,256)){
   if(!span||typeof span!=='object'||Array.isArray(span)){output.stats.invalidEntitySpans++;continue;}
   const record=span as Record<string,unknown>;entity(record);const start=record.start,end=record.end;
   if(start!==undefined||end!==undefined)if(!Number.isInteger(start)||!Number.isInteger(end)||(start as number)<0||(end as number)<=(start as number))output.stats.invalidEntitySpans++;
  }
  output.entityDigests=[...entityValues].map(value=>mac('sensitive-entity-v1',value)).sort();output.stats.entities=entityValues.size;
 }
 const primaryPaths=options.paths?.primary??(kind==='behavior-drift'?[]:['text']);
 const contextPaths=options.paths?.context??(kind==='behavior-drift'?defaultContexts:[]);
 const channels:[string,unknown,boolean][]=[];
 for(const path of primaryPaths){const value=at(row,path);if(typeof value==='string'&&value.trim())channels.push([path,value,true]);else if(value!==undefined&&value!==null)output.flags.push('non_text_primary');}
 for(const path of contextPaths){const value=at(row,path);if(value!==undefined&&value!==null&&value!==''&&(!Array.isArray(value)||value.length))channels.push([path,value,false]);}
 const seen=new Set<string>();
 for(const[path,value,primary]of channels){
  if(seen.has(path))continue;seen.add(path);
  const text=typeof value==='string'?value:stable(value);if(!text.trim())continue;
  const normalizedText=normalized(text),exact=mac('text-exact-v1',text),norm=mac('text-normalized-v1',normalizedText);
  const feature:TextFingerprint={channel:primary?'primary_text':'context:'+path,path,exact,normalized:norm,chars:text.length,shingleSketch:[],sampledShingles:0,samplingStride:1,approximationTruncated:normalizedText.length>maxChars};
  if(primary){output.stats.primaryChars+=text.length;if(text.length>=minimum)add(true,'exact_primary_text','primary_text','text-exact-v1',text);else output.flags.push('short_primary_text');}
  else if(text.length>=minimum)add(false,'exact_context',feature.channel,'text-exact-v1',text);
  if(normalizedText.length>=minimum)add(false,'normalized_text',feature.channel,'text-normalized-v1',normalizedText);

  let template=text,entityReplacements=0;
  if(kind==='sensitive')for(const value of [...entityValues].sort((a,b)=>b.length-a.length)){if(template.includes(value)){template=template.split(value).join('<sensitive-entity>');entityReplacements++;}}
  if(entityReplacements&&normalized(template).replaceAll('<sensitive-entity>','').length>=minimum){feature.template=mac('entity-masked-template-v1',normalized(template));add(false,'entity_masked_template',feature.channel,'entity-masked-template-v1',normalized(template));}
  // Candidate-only normalization: identifiers, URL destinations and encoding can be attack semantics.
  const variableTemplate=normalized(template).replace(/https?:\/\/[^\s<>"']+/gu,'<url>').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gu,'<email>').replace(/\b\d+(?:[.,:/_-]\d+)*\b/gu,'<number>').replace(/\{\{[^{}]{1,128}\}\}/gu,'<placeholder>');
  if(variableTemplate!==normalizedText&&variableTemplate.replace(/<(?:url|email|number|placeholder|sensitive-entity)>/gu,'').length>=minimum){if(!feature.template)feature.template=mac('variable-masked-template-v1',variableTemplate);add(false,primary?'variable_masked_template':'context_template',feature.channel,'variable-masked-template-v1',variableTemplate);}

  const characters=Array.from(normalizedText.slice(0,maxChars)),possible=Math.max(0,characters.length-4),stride=Math.max(1,Math.ceil(possible/maxShingles)),shingles=new Set<string>();feature.samplingStride=stride;
  for(let offset=0;offset<possible;offset+=stride)shingles.add(mac('character-5gram-v1',characters.slice(offset,offset+5).join('')));
  feature.sampledShingles=shingles.size;feature.shingleSketch=[...shingles].sort().slice(0,sketchSize);
  output.textFingerprints.push(feature);if(feature.approximationTruncated)output.flags.push('approximation_truncated');
 }
 output.stats.textChannels=output.textFingerprints.length;
 if(!output.stats.textChannels)output.flags.push('missing_analyzable_text');
 output.flags=[...new Set(output.flags)].sort();
 return output;
}

/** Bottom-k estimate is candidate evidence only, never proof of semantic independence or same origin. */
export function estimateTextSimilarity(a:TextFingerprint,b:TextFingerprint,sketchSize=64):number {
 const left=new Set(a.shingleSketch),right=new Set(b.shingleSketch),union=[...new Set([...left,...right])].sort().slice(0,sketchSize);
 return union.length?union.filter(value=>left.has(value)&&right.has(value)).length/union.length:0;
}
export interface TextCandidatePair {left:string;right:string;leftChannel:string;rightChannel:string;similarity:number;reason:'lexical_near_duplicate';approximationLimited:boolean}
/** Bounded inverted-index shortlist, then bottom-k comparison. Broad common shingles are not family edges. */
export function findLikelyTextPairs(features:TextFamilyFeatures[],options:{minimumSimilarity?:number;minimumChars?:number;maximumBucket?:number;maximumComparisons?:number}={}) {
 const threshold=options.minimumSimilarity??0.86,minimumChars=options.minimumChars??80,maximumBucket=options.maximumBucket??64,maximumComparisons=options.maximumComparisons??400000;
 if(threshold<0||threshold>1||maximumBucket<2||maximumComparisons<1)throw new Error('Text pair limits are invalid.');
 const texts=features.flatMap(feature=>feature.textFingerprints.filter(text=>text.chars>=minimumChars).map(text=>({rowId:feature.rowId,text}))),buckets=new Map<string,number[]>();
 for(let index=0;index<texts.length;index++)for(const key of texts[index]!.text.shingleSketch.slice(0,8)){const bucket=buckets.get(key)??[];bucket.push(index);buckets.set(key,bucket);}
 const pairs:TextCandidatePair[]=[],seen=new Set<string>();let compared=0,skippedBroadBuckets=0,truncated=false;
 outer:for(const bucket of buckets.values()){
  if(bucket.length>maximumBucket){skippedBroadBuckets++;continue;}
  for(let i=0;i<bucket.length;i++)for(let j=i+1;j<bucket.length;j++){
   const x=Math.min(bucket[i]!,bucket[j]!),y=Math.max(bucket[i]!,bucket[j]!),a=texts[x]!,b=texts[y]!;
   if(a.rowId===b.rowId)continue;const pair=x+':'+y;if(seen.has(pair))continue;seen.add(pair);
   if(Math.min(a.text.chars,b.text.chars)/Math.max(a.text.chars,b.text.chars)<0.65)continue;
   if(compared>=maximumComparisons){truncated=true;break outer;}compared++;
   const similarity=estimateTextSimilarity(a.text,b.text);
   if(similarity>=threshold)pairs.push({left:a.rowId,right:b.rowId,leftChannel:a.text.channel,rightChannel:b.text.channel,similarity,reason:'lexical_near_duplicate',approximationLimited:a.text.approximationTruncated||b.text.approximationTruncated||a.text.samplingStride>1||b.text.samplingStride>1});
  }
 }
 return{pairs,compared,skippedBroadBuckets,truncated,textChannels:texts.length};
}
