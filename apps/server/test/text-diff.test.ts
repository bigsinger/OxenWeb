import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTextDiff,diffDisplayText,inlineTextDiff} from '../../web/src/text-diff.js';

test('line diff preserves context, correct sides and old/new numbers',()=>{
  const diff=buildTextDiff('first\nold value\nlast\n','first\nnew value\nlast\n');
  assert.equal(diff.additions,1);assert.equal(diff.deletions,1);
  const rows=diff.hunks.flatMap(h=>h.lines);assert.deepEqual(rows.map(row=>[row.kind,row.oldLine,row.newLine]),[['context',1,1],['removed',2,undefined],['added',undefined,2],['context',3,3]]);
  assert.equal(rows.filter(row=>row.kind!=='added').map(row=>row.text+'\n').join(''),'first\nold value\nlast\n');
  assert.equal(rows.filter(row=>row.kind!=='removed').map(row=>row.text+'\n').join(''),'first\nnew value\nlast\n');
});
test('inline highlighting pinpoints Chinese, emoji and whitespace without altering text',()=>{
  for(const [before,after]of [['提示词：正常😀结尾','提示词：异常😁结尾'],['a\tb','a b'],['false','true']]){
    const diff=inlineTextDiff(before!,after!);assert.equal(diff.before.map(p=>p.text).join(''),before);assert.equal(diff.after.map(p=>p.text).join(''),after);
    assert.ok(diff.before.some(part=>part.changed)||diff.after.some(part=>part.changed));
  }
});
test('large line fallback retains exact Unicode strings and valid character boundaries',()=>{
  const before='a'.repeat(4500)+'😀old'+'尾'.repeat(4500),after='a'.repeat(4500)+'😁new'+'尾'.repeat(4500),diff=inlineTextDiff(before,after);
  assert.equal(diff.before.map(p=>p.text).join(''),before);assert.equal(diff.after.map(p=>p.text).join(''),after);
  for(const part of [...diff.before,...diff.after])assert.equal(new TextDecoder().decode(new TextEncoder().encode(part.text)),part.text);
});
test('JSON display formatting exposes changed fields but raw whitespace remains inspectable',()=>{
  const a=diffDisplayText('{"id":"a","enabled":true}','record.json',true),b=diffDisplayText('{"id":"a","enabled":false}','record.json',true),diff=buildTextDiff(a.text,b.text);
  assert.equal(a.formatted,true);assert.equal(diff.additions,1);assert.equal(diff.deletions,1);
  assert.equal(diff.hunks.flatMap(h=>h.lines).filter(row=>row.kind==='removed')[0]!.text.trim(),'"enabled": true');
  assert.equal(diffDisplayText(' {"a":1}','record.json',false).text,' {"a":1}');
  assert.equal(diffDisplayText('not JSON','record.json',true).formatted,false);
  assert.equal(buildTextDiff(diffDisplayText(' {"a":1}','record.json',true).text,diffDisplayText('{"a":1}','record.json',true).text).unchanged,true);
});
test('separated edits become context hunks and expanded view restores unchanged lines',()=>{
  const old=Array.from({length:80},(_,index)=>'line '+index),next=[...old];next[5]='change five';next[70]='change seventy';
  const compact=buildTextDiff(old.join('\n'),next.join('\n'),3),expanded=buildTextDiff(old.join('\n'),next.join('\n'),3,true);
  assert.equal(compact.hunks.length,2);assert.ok(compact.hiddenLines>50);assert.ok(compact.hunks[1]!.hiddenBefore>50);
  assert.equal(expanded.hunks.length,1);assert.equal(expanded.hiddenLines,0);assert.equal(expanded.hunks[0]!.lines.length,82);
});
test('JSON structure formatting never conceals numeric precision or literal changes',()=>{
  for(const text of ['{"id":9007199254740993}','{"value":0.10000000000000001}','{"value":1e309}','{"value":-0}']){
    assert.deepEqual(diffDisplayText(text,'record.json',true),{text,formatted:false});
  }
  assert.equal(diffDisplayText('{"quoted":"9007199254740993","value":12}','record.json',true).formatted,true);
});
test('empty lines, missing terminal newlines and CRLF changes are not hidden',()=>{
  const added=buildTextDiff('','\n');assert.equal(added.additions,1);assert.equal(added.hunks[0]!.lines[0]!.text,'');
  const end=buildTextDiff('line','line\n');assert.equal(end.deletions,1);assert.equal(end.additions,1);assert.equal(end.hunks[0]!.lines.find(row=>row.kind==='removed')!.ending,'无换行');
  const crlf=buildTextDiff('a\r\n','a\n');assert.equal(crlf.deletions,1);assert.equal(crlf.hunks[0]!.lines[0]!.ending,'CRLF');
});
test('input and rendering limits are explicit rather than reporting no differences',()=>{
  const big=buildTextDiff('a'.repeat(500001),'b'.repeat(500001));assert.equal(big.limited,true);assert.equal(big.unchanged,false);assert.equal(big.hunks.length,0);
  const old=Array.from({length:2002},(_,index)=>'old '+index).join('\n'),next=Array.from({length:2002},(_,index)=>'new '+index).join('\n'),coarse=buildTextDiff(old,next);
  assert.equal(coarse.coarse,true);assert.equal(coarse.limited,true);assert.equal(coarse.additions,2002);assert.equal(coarse.deletions,2002);assert.equal(coarse.hunks.flatMap(h=>h.lines).length,2500);
});
