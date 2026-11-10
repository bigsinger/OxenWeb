import test from 'node:test';
import assert from 'node:assert/strict';
import {auditBoundaryOverlap,type BoundaryAuditRow} from '../../../scripts/analysis/boundary-overlap.js';

test('repeated fingerprints are deduplicated per row and shared/holdout boundary rows are distinct from unclassified rows',()=>{
 const rows:BoundaryAuditRow[]=[{id:'opaque-a',visibility:'shared',fingerprints:['opaque-f1','opaque-f1']},{id:'opaque-b',visibility:'holdout',fingerprints:['opaque-f1','opaque-f2']},{id:'opaque-c',visibility:'unclassified',fingerprints:['opaque-f2']}];
 const before=JSON.stringify(rows),result=auditBoundaryOverlap(rows);
 assert.equal(result.repeatedFingerprintCount,2);assert.equal(result.repeatedFingerprintRows,3);assert.equal(result.sharedHoldoutOverlapFingerprintCount,1);assert.equal(result.sharedAffectedRows,1);assert.equal(result.holdoutAffectedRows,1);assert.equal(result.boundaryAffectedRows,2);
 assert.deepEqual(result.privateBoundaryFingerprintIndex,[{fingerprint:'opaque-f1',shared:['opaque-a'],holdout:['opaque-b'],unclassified:[]}]);
 assert.deepEqual(result.strictComponents.sizeDistribution,[{size:3,components:1,rows:3}]);assert.equal(result.strictComponents.mixedBoundaryComponents,1);assert.equal(JSON.stringify(rows),before);
});
test('strict connectivity includes base groups and indirect fingerprint bridges without declaring same-origin truth',()=>{
 const result=auditBoundaryOverlap([{id:'a',visibility:'shared',baseGroup:'base-1',fingerprints:[]},{id:'b',visibility:'unclassified',baseGroup:'base-1',fingerprints:['f1']},{id:'c',visibility:'unclassified',fingerprints:['f1','f2']},{id:'d',visibility:'holdout',fingerprints:['f2']}],{targetRows:1});
 assert.equal(result.sharedHoldoutOverlapFingerprintCount,0);assert.equal(result.holdoutAffectedRows,0);assert.equal(result.strictComponents.mixedBoundaryComponents,1);assert.equal(result.strictComponents.holdoutRowsInMixedComponents,1);assert.equal(result.strictComponents.largest,4);
 assert.equal(result.strictComponents.exactTargetReachable,false);assert.deepEqual(result.strictComponents.nearestReachableRows,[0]);assert.equal(result.strictComponents.nearestBelow,0);assert.equal(result.strictComponents.nearestAbove,4);assert.equal(result.strictComponents.nontrivialHoldoutPossible,false);assert.match(result.interpretation,/not an adjudicated/);
});
test('empty corpus and rows without fingerprints are valid and have no fabricated overlap',()=>{
 const empty=auditBoundaryOverlap([]);assert.equal(empty.totalRows,0);assert.equal(empty.strictComponents.count,0);assert.equal(empty.strictComponents.largest,0);assert.equal(empty.strictComponents.exactTargetReachable,true);assert.deepEqual(empty.strictComponents.nearestReachableRows,[0]);assert.equal(empty.strictComponents.nontrivialHoldoutPossible,false);
 const singleton=auditBoundaryOverlap([{id:'a',visibility:'shared',fingerprints:[]},{id:'b',visibility:'holdout',fingerprints:[]}],{targetRows:1});assert.equal(singleton.repeatedFingerprintCount,0);assert.equal(singleton.strictComponents.count,2);assert.equal(singleton.strictComponents.exactTargetReachable,true);
});
test('giant strict entity component makes 20 percent unattainable even if the nominal split exists',()=>{
 const rows:BoundaryAuditRow[]=Array.from({length:1000},(_,index)=>({id:'opaque-'+index,visibility:index<800?'shared':'holdout',fingerprints:['shared-entity-fingerprint']}));
 const result=auditBoundaryOverlap(rows);assert.equal(result.repeatedFingerprintCount,1);assert.equal(result.repeatedFingerprintRows,1000);assert.equal(result.holdoutAffectedRows,200);assert.equal(result.strictComponents.targetRows,200);assert.equal(result.strictComponents.largest,1000);assert.equal(result.strictComponents.exactTargetReachable,false);assert.deepEqual(result.strictComponents.nearestReachableRows,[0]);assert.equal(result.strictComponents.nearestAbove,1000);assert.equal(result.strictComponents.minimumAbsoluteDeviation,200);
});
test('subset-sum uses whole component row sizes and reports equally near quantities without assigning members',()=>{
 const rows:BoundaryAuditRow[]=Array.from({length:20},(_,index)=>({id:'opaque-'+index,visibility:'unclassified',baseGroup:index<6?'group-6-a':index<12?'group-6-b':'group-8',fingerprints:[]}));
 const impossible=auditBoundaryOverlap(rows,{targetRows:7});assert.deepEqual(impossible.strictComponents.nearestReachableRows,[6,8]);assert.equal(impossible.strictComponents.exactTargetReachable,false);assert.equal(impossible.strictComponents.minimumAbsoluteDeviation,1);
 const possible=auditBoundaryOverlap(rows,{targetRows:14});assert.equal(possible.strictComponents.exactTargetReachable,true);assert.deepEqual(possible.strictComponents.nearestReachableRows,[14]);assert.equal(Object.hasOwn(possible,'assignments'),false);
});
test('invalid identities, scopes and targets are rejected with generic messages',()=>{
 assert.throws(()=>auditBoundaryOverlap([{id:'a',visibility:'shared',fingerprints:[]},{id:'a',visibility:'holdout',fingerprints:[]}]),/unique opaque/);
 assert.throws(()=>auditBoundaryOverlap([{id:'a',visibility:'invalid' as 'shared',fingerprints:[]}]),/valid scopes/);
 assert.throws(()=>auditBoundaryOverlap([{id:'a',visibility:'shared',fingerprints:['']}]),/opaque fingerprints/);
 assert.throws(()=>auditBoundaryOverlap([],{targetRows:1}),/target rows/);
 assert.throws(()=>auditBoundaryOverlap([],{targetFraction:NaN}),/limits/);
});
