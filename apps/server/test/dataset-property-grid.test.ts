import test from 'node:test';
import assert from 'node:assert/strict';
import {datasetPropertyRows,datasetPropertyText,filterDatasetProperties} from '../../web/src/dataset-property-grid.js';

test('property rows show all actual and configured fields in project order, preserving missing/null/empty distinctions',()=>{
  const record={id:'synthetic-1',body:'',nullable:null,extra:false};
  const fields={body:{displayName:'正文',description:'原始文本',order:1},id:{order:0},configured:{type:'string' as const,visible:false,order:2}};
  const rows=datasetPropertyRows(record,fields);
  assert.deepEqual(rows.map(row=>row.id),['id','body','configured','nullable','extra']);
  assert.equal(rows[1]?.displayName,'正文');assert.equal(rows[1]?.text,'（空字符串）');
  assert.equal(rows[2]?.present,false);assert.equal(rows[2]?.text,'（未设置）');assert.equal(rows[2]?.declaredType,'string');
  assert.equal(rows[3]?.type,'null');assert.equal(rows[3]?.text,'null');assert.equal(rows[4]?.text,'false');
  assert.deepEqual(record,{id:'synthetic-1',body:'',nullable:null,extra:false});
});

test('property search uses source IDs, aliases, type and help without searching values or changing source order',()=>{
  const rows=datasetPropertyRows({zeta:'private-token',alpha:2},{zeta:{displayName:'正文',description:'样本输入文本'},alpha:{type:'integer'}});
  assert.deepEqual(filterDatasetProperties(rows,'正文').map(row=>row.id),['zeta']);
  assert.deepEqual(filterDatasetProperties(rows,' 输入 ').map(row=>row.id),['zeta']);
  assert.deepEqual(filterDatasetProperties(rows,'INTEGER').map(row=>row.id),['alpha']);
  assert.deepEqual(filterDatasetProperties(rows,'private-token'),[]);
  assert.deepEqual(filterDatasetProperties(rows,'',true).map(row=>row.id),['alpha','zeta']);
  assert.deepEqual(rows.map(row=>row.id),['zeta','alpha']);
});

test('long values are detected for explicit expansion while JSON, typed options and untrusted text stay data',()=>{
  const payload='<script>do not execute</script>\n'.repeat(8);
  const rows=datasetPropertyRows({prompt:payload,quality:'gold',list:[false,2],object:{nested:'x'}},{quality:{optionLabels:{'["string","gold"]':'金标'}}});
  assert.equal(rows[0]?.long,true);assert.equal(rows[0]?.text,payload);assert.equal(rows[1]?.optionLabel,'金标');
  assert.equal(rows[2]?.type,'array');assert.equal(rows[2]?.text,JSON.stringify([false,2],null,2));
  assert.equal(rows[3]?.type,'object');assert.equal(datasetPropertyText(undefined,false),'（未设置）');
  const record=JSON.parse('{"__proto__":"untrusted","constructor":"value"}') as Record<string,unknown>;
  assert.deepEqual(datasetPropertyRows(record).map(row=>[row.id,row.value]),[['__proto__','untrusted'],['constructor','value']]);
});
