import test from 'node:test';
import assert from 'node:assert/strict';
import { naturalQuery } from '../src/natural-query.js';
import type { FilePreview } from '../../../packages/shared/src/index.js';
const table:FilePreview={path:'data.csv',kind:'table',mime:'text/csv',size:100,columns:[{name:'label',dtype:'string'},{name:'score',dtype:'number'},{name:'caption',dtype:'string'}],rows:[{label:'approved',score:0.9,caption:'forest'},{label:'review',score:0.6,caption:'coast'},{label:'approved',score:0.8,caption:'coast'}],totalRows:3};
test('Chinese numeric predicates and ordering are applied before limiting',()=>{const result=naturalQuery(table,'score 大于 0.7 按score降序 前1行');assert.equal(result.totalRows,2);assert.equal(result.rows[0]?.score,0.9);assert.equal(result.rows.length,1);});
test('English conjunctions filter multiple fields and count',()=>{const result=naturalQuery(table,'count where label equals approved and score > 0.85');assert.equal(result.rows[0]?.count,1);});
test('Global quoted text query and sampled scope are explicit',()=>{const result=naturalQuery({...table,totalRows:1000},'搜索“coast”');assert.equal(result.totalRows,2);assert.match(result.explanation,/不代表完整数据集/);});
test('Never evaluates query code, rejects unknown predicates after a recognized predicate',()=>{assert.throws(()=>naturalQuery(table,'score > 0.5 and evil = 1'),/未识别/);assert.equal(naturalQuery(table,"'; DROP TABLE data;").totalRows,0);});
