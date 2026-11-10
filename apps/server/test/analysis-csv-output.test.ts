import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisCsvCell} from '../../../scripts/analysis/csv-output.js';
test('analysis CSV neutralizes formula-like untrusted identifiers without changing JSONL identity',()=>{for(const value of ['=1+1','+formula','-formula','@lookup','\t=1','\r\n@lookup','\uFEFF=1']){assert.ok(analysisCsvCell(value).startsWith('"\''));assert.equal(JSON.parse(JSON.stringify(value)),value);}});
test('analysis CSV preserves ordinary identifiers, links, quotes and multiline text',()=>{assert.equal(analysisCsvCell('id:0123'),'"id:0123"');assert.equal(analysisCsvCell('a"b\nc'),'"a""b\nc"');assert.equal(analysisCsvCell('http://localhost:3001/'),'"http://localhost:3001/"');});
test('analysis CSV serializes structured candidate metadata without evaluating it',()=>{assert.equal(analysisCsvCell(['gold','regression']),'"[""gold"",""regression""]"');assert.equal(analysisCsvCell(null),'"null"');});
