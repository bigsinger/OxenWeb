import test from 'node:test';
import assert from 'node:assert/strict';
import {extractTextFamilyFeatures,estimateTextSimilarity,findLikelyTextPairs} from '../../../scripts/analysis/text-families.js';
const key=new Uint8Array(32).fill(19);
const extract=(row:Record<string,unknown>,rowId='opaque-a',kind:'sensitive'|'prompt-injection'|'behavior-drift'='prompt-injection')=>extractTextFamilyFeatures({datasetKind:kind,sourceNamespace:'synthetic-source',row,rowId,hmacKey:key});
const body='Synthetic inert evaluation text with enough distinct context to test exact body fingerprints. No sample instruction is executed.';

test('exact full text joins across kinds without leaking plaintext; source identity is namespaced and missing placeholders are ignored',()=>{
 const a=extract({text:body,source_dataset:'alpha',source_id:'synthetic-private-source-id-17'}),b=extract({text:body,source_dataset:'beta',source_id:'synthetic-private-source-id-17'},'opaque-b','sensitive');
 assert.equal(a.hardKeys.find(item=>item.reason==='exact_primary_text')!.key,b.hardKeys.find(item=>item.reason==='exact_primary_text')!.key);
 assert.notEqual(a.hardKeys.find(item=>item.reason==='namespaced_source_id')!.key,b.hardKeys.find(item=>item.reason==='namespaced_source_id')!.key);
 const serialized=JSON.stringify(a);for(const secret of [body,'alpha','synthetic-private-source-id-17'])assert.ok(!serialized.includes(secret));
 assert.equal(extract({text:body,source_id:'unknown'}).hardKeys.some(item=>item.reason==='namespaced_source_id'),false);
 assert.equal(extractTextFamilyFeatures({datasetKind:'prompt-injection',sourceNamespace:'synthetic-source',row:{text:body},rowId:'opaque-a',hmacKey:new Uint8Array(32).fill(20)}).textFingerprints[0]!.exact===a.textFingerprints[0]!.exact,false);
});
test('Unicode/whitespace/case normalization and changed variables remain candidates rather than exact hard relations',()=>{
 const a=extract({text:body+' Case 12.'}),b=extract({text:body.toUpperCase()+'   Case 15.'},'opaque-b');
 assert.notEqual(a.textFingerprints[0]!.exact,b.textFingerprints[0]!.exact);
 assert.equal(a.candidateKeys.find(item=>item.reason==='variable_masked_template')!.key,b.candidateKeys.find(item=>item.reason==='variable_masked_template')!.key);
 assert.equal(a.hardKeys.some(item=>item.reason==='variable_masked_template'),false);
});
test('sensitive entity variants have local keyed digests and a masked template; shared entities alone never hard-join rows',()=>{
 const make=(entity:string)=>({text:'Synthetic account contact information appears in this controlled fixture: '+entity+'. Additional inert context.',ground_truth:{sensitive_values:[entity],sensitive_spans:[{start:1,end:2,text:entity}],categories:['synthetic']}});
 const a=extract(make('person-one@example.invalid'),'opaque-a','sensitive'),b=extract(make('person-two@example.invalid'),'opaque-b','sensitive');
 assert.notDeepEqual(a.entityDigests,b.entityDigests);assert.equal(a.candidateKeys.find(item=>item.reason==='entity_masked_template')!.key,b.candidateKeys.find(item=>item.reason==='entity_masked_template')!.key);
 assert.equal(a.hardKeys.some(item=>item.key===a.entityDigests[0]),false);assert.ok(!JSON.stringify(a).includes('person-one'));
 const malformed=extract({text:body,ground_truth:{sensitive_spans:[{start:5,end:2}] }},'opaque-c','sensitive');assert.equal(malformed.stats.invalidEntitySpans,1);
});
test('drift case identities are strong but common goals, traces and coarse classes remain candidate-only',()=>{
 const a=extract({case_id:'same-case',scenario_type:'attack',original_goal:body,trace:[{step:'Synthetic one'}]},'opaque-a','behavior-drift'),b=extract({case_id:'same-case',scenario_type:'benign',original_goal:body,trace:[{step:'Synthetic two'}]},'opaque-b','behavior-drift');
 assert.deepEqual(a.hardKeys,b.hardKeys);assert.equal(a.hardKeys.length,1);assert.equal(a.hardKeys[0]!.reason,'namespaced_case_id');
 assert.ok(a.candidateKeys.some(item=>item.reason==='exact_context'));assert.ok(!JSON.stringify(a).includes('same-case'));
 const other=extractTextFamilyFeatures({datasetKind:'behavior-drift',sourceNamespace:'other-source',row:{case_id:'same-case'},rowId:'opaque-c',hmacKey:key});assert.notEqual(a.hardKeys[0]!.key,other.hardKeys[0]!.key);
});
test('explicit parent keys join the namespaced source identity and never infer lineage from row names or categories',()=>{
 const a=extract({source_dataset:'alpha',source_id:'base',text:body}),b=extract({source_dataset:'alpha',source_id:'variant',meta:{parent_id:'base'},text:body+' Additional variant.'},'opaque-b');
 assert.equal(a.hardKeys.find(item=>item.reason==='namespaced_source_id')!.key,b.hardKeys.find(item=>item.reason==='explicit_parent_id')!.key);
 assert.equal(extract({id:'base-variant-1',attack_family:'coarse',benchmark_group:'coarse',text:body}).hardKeys.length,1);
});
test('observed field structures use sensitive span surface/canonical and drift source_sample_id, steps and authorization_rule',()=>{
 const sensitive=extract({text:'Synthetic contact displayed in the inert example is fixture-one@example.invalid, with complete surrounding context.',ground_truth:{sensitive_values:[],sensitive_spans:[{surface:'fixture-one@example.invalid',canonical:'fixture-one@example.invalid',start:50,end:77}] }},'opaque-a','sensitive');
 assert.equal(sensitive.stats.entities,1);assert.ok(sensitive.candidateKeys.some(item=>item.reason==='entity_masked_template'));assert.ok(!JSON.stringify(sensitive).includes('fixture-one'));
 const drift=extract({case_id:'synthetic-case',source_dataset:'synthetic-dataset',source_sample_id:'synthetic-item',user_query:body,authorization_rule:body,steps:[{name:'Synthetic action',arguments:{text:'Synthetic value'},observation:body}]},'opaque-b','behavior-drift');
 assert.ok(drift.hardKeys.some(item=>item.reason==='namespaced_source_id'));assert.ok(drift.textFingerprints.some(item=>item.path==='steps'));assert.ok(drift.textFingerprints.some(item=>item.path==='authorization_rule'));assert.equal(drift.textFingerprints.some(item=>item.path==='source_dataset'),false);
});
test('bounded lexical shortlist finds near duplicates, exposes broad/truncated limits and never implies semantic proof',()=>{
 const a=extract({text:body.repeat(6)}),b=extract({text:body.repeat(6)+' Synthetic footnote.'},'opaque-b'),c=extract({text:'Completely distinct synthetic corpus containing unrelated vocabulary and separate inert sentences.'.repeat(6)},'opaque-c');
 assert.ok(estimateTextSimilarity(a.textFingerprints[0]!,b.textFingerprints[0]!)>0.86);
 const result=findLikelyTextPairs([a,b,c]);assert.ok(result.pairs.some(pair=>pair.left==='opaque-a'&&pair.right==='opaque-b'));assert.equal(result.truncated,false);assert.ok(!JSON.stringify(result).includes(body));
 const limited=extractTextFamilyFeatures({datasetKind:'prompt-injection',sourceNamespace:'synthetic',rowId:'opaque-d',row:{text:body.repeat(30)},hmacKey:key,maximumApproximationChars:128});assert.ok(limited.flags.includes('approximation_truncated'));assert.ok(limited.textFingerprints[0]!.shingleSketch.length<=64);
 const broad=findLikelyTextPairs([a,b,c,extract({text:body.repeat(6)},'opaque-d')],{maximumBucket:2});assert.ok(broad.skippedBroadBuckets>0);
});
test('invalid key and limits fail with generic messages, and input records remain byte-for-byte JSON unchanged',()=>{
 const row={text:body,meta:{parent_id:'base'},ground_truth:{sensitive_values:['synthetic-value']}};const before=JSON.stringify(row);extract(row);assert.equal(JSON.stringify(row),before);
 assert.throws(()=>extractTextFamilyFeatures({datasetKind:'sensitive',sourceNamespace:'synthetic',rowId:'opaque',row,hmacKey:new Uint8Array(8)}),/32-byte/);
 assert.throws(()=>extractTextFamilyFeatures({datasetKind:'sensitive',sourceNamespace:'synthetic',rowId:'opaque',row,hmacKey:key,sketchSize:1}),/limits/);
});
