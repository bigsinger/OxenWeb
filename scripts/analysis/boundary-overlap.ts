/** Pure audit of opaque derived fingerprints. No source records, files, services or automatic assignments. */
export type AuditVisibility='shared'|'holdout'|'unclassified';
export interface BoundaryAuditRow {id:string;visibility:AuditVisibility;fingerprints:string[];baseGroup?:string}
export interface BoundaryFingerprintIndex {fingerprint:string;shared:string[];holdout:string[];unclassified:string[]}
export interface BoundaryPrivateComponent {members:string[];size:number;sharedRows:number;holdoutRows:number;unclassifiedRows:number}
export interface BoundaryOverlapAudit {
 totalRows:number;distinctFingerprintCount:number;repeatedFingerprintCount:number;repeatedFingerprintRows:number;
 sharedHoldoutOverlapFingerprintCount:number;sharedAffectedRows:number;holdoutAffectedRows:number;boundaryAffectedRows:number;
 /** Local/private member references only. Exclude these indexes from public/algorithm-facing summaries. */
 privateRepeatedFingerprintIndex:BoundaryFingerprintIndex[];
 privateBoundaryFingerprintIndex:BoundaryFingerprintIndex[];
 strictComponents:{
  count:number;largest:number;sizeDistribution:{size:number;components:number;rows:number}[];
  mixedBoundaryComponents:number;sharedRowsInMixedComponents:number;holdoutRowsInMixedComponents:number;
  targetFraction:number;targetRows:number;exactTargetReachable:boolean;
  nearestReachableRows:number[];nearestBelow:number|null;nearestAbove:number|null;minimumAbsoluteDeviation:number;
  nontrivialHoldoutPossible:boolean;privateComponents:BoundaryPrivateComponent[];
 };
 interpretation:'Equal entity/member fingerprints are a strict-isolation assumption, not an adjudicated same-origin claim.';
}

class Components {
 private parent:number[];private sizes:number[];
 constructor(count:number){this.parent=Array.from({length:count},(_,index)=>index);this.sizes=new Array(count).fill(1);}
 find(index:number):number {let root=index;while(this.parent[root]!==root)root=this.parent[root]!;while(index!==root){const next=this.parent[index]!;this.parent[index]=root;index=next;}return root;}
 join(a:number,b:number){a=this.find(a);b=this.find(b);if(a===b)return;if(this.sizes[a]!<this.sizes[b]!)[a,b]=[b,a];this.parent[b]=a;this.sizes[a]=this.sizes[a]!+this.sizes[b]!;}
}
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;

/** Reachability uses whole connected components and counts ROWS, never a percentage of groups. */
export function auditBoundaryOverlap(rows:readonly BoundaryAuditRow[],options:{targetFraction?:number;targetRows?:number}={}):BoundaryOverlapAudit {
 const targetFraction=options.targetFraction??0.2;
 if(!Number.isFinite(targetFraction)||targetFraction<0||targetFraction>1||rows.length>1000000)throw new Error('Boundary audit limits are invalid.');
 const targetRows=options.targetRows??Math.round(rows.length*targetFraction);
 if(!Number.isInteger(targetRows)||targetRows<0||targetRows>rows.length)throw new Error('Boundary audit target rows are invalid.');
 const seenIds=new Set<string>(),fingerprints=new Map<string,number[]>(),baseGroups=new Map<string,number>(),components=new Components(rows.length);
 for(let index=0;index<rows.length;index++){
  const row=rows[index]!;
  if(typeof row.id!=='string'||!row.id||seenIds.has(row.id)||!['shared','holdout','unclassified'].includes(row.visibility)||!Array.isArray(row.fingerprints)||row.fingerprints.length>4096)throw new Error('Boundary audit rows require unique opaque identities and valid scopes.');
  seenIds.add(row.id);
  if(row.baseGroup!==undefined){if(typeof row.baseGroup!=='string'||!row.baseGroup)throw new Error('Boundary audit base group is invalid.');const first=baseGroups.get(row.baseGroup);if(first===undefined)baseGroups.set(row.baseGroup,index);else components.join(first,index);}
  for(const fingerprint of new Set(row.fingerprints)){
   if(typeof fingerprint!=='string'||!fingerprint||fingerprint.length>512)throw new Error('Boundary audit requires nonempty opaque fingerprints.');
   const bucket=fingerprints.get(fingerprint);if(bucket){components.join(bucket[0]!,index);bucket.push(index);}else fingerprints.set(fingerprint,[index]);
  }
 }
 const privateRepeatedFingerprintIndex:BoundaryFingerprintIndex[]=[],privateBoundaryFingerprintIndex:BoundaryFingerprintIndex[]=[],repeatedRows=new Set<string>(),sharedRows=new Set<string>(),holdoutRows=new Set<string>();
 for(const[fingerprint,indexes]of fingerprints){
  if(indexes.length<2)continue;
  const item:BoundaryFingerprintIndex={fingerprint,shared:[],holdout:[],unclassified:[]};
  for(const index of indexes){const row=rows[index]!;item[row.visibility].push(row.id);repeatedRows.add(row.id);}
  for(const visibility of ['shared','holdout','unclassified']as const)item[visibility].sort(compare);
  privateRepeatedFingerprintIndex.push(item);
  if(item.shared.length&&item.holdout.length){privateBoundaryFingerprintIndex.push(item);for(const id of item.shared)sharedRows.add(id);for(const id of item.holdout)holdoutRows.add(id);}
 }
 privateRepeatedFingerprintIndex.sort((a,b)=>compare(a.fingerprint,b.fingerprint));privateBoundaryFingerprintIndex.sort((a,b)=>compare(a.fingerprint,b.fingerprint));
 const componentMap=new Map<number,BoundaryPrivateComponent>();
 for(let index=0;index<rows.length;index++){
  const row=rows[index]!,root=components.find(index),component=componentMap.get(root)??{members:[],size:0,sharedRows:0,holdoutRows:0,unclassifiedRows:0};
  component.members.push(row.id);component.size++;if(row.visibility==='shared')component.sharedRows++;else if(row.visibility==='holdout')component.holdoutRows++;else component.unclassifiedRows++;componentMap.set(root,component);
 }
 const privateComponents=[...componentMap.values()];for(const component of privateComponents)component.members.sort(compare);privateComponents.sort((a,b)=>b.size-a.size||compare(a.members[0]!,b.members[0]!));
 const sizeCounts=new Map<number,number>();for(const component of privateComponents)sizeCounts.set(component.size,(sizeCounts.get(component.size)??0)+1);
 const sizeDistribution=[...sizeCounts].sort((a,b)=>a[0]-b[0]).map(([size,count])=>({size,components:count,rows:size*count}));
 // Binary decomposition of identical component sizes avoids one shift per singleton on large corpora.
 let reachable=1n;const mask=(1n<<BigInt(rows.length+1))-1n;
 for(const{size,components:count}of sizeDistribution){let remaining=count,chunk=1;while(remaining){const take=Math.min(chunk,remaining);reachable=(reachable|(reachable<<BigInt(size*take)))&mask;remaining-=take;chunk*=2;}}
 const possible=(count:number)=>((reachable>>BigInt(count))&1n)===1n;
 let nearestBelow:number|null=null,nearestAbove:number|null=null;
 for(let count=targetRows;count>=0;count--)if(possible(count)){nearestBelow=count;break;}
 for(let count=targetRows;count<=rows.length;count++)if(possible(count)){nearestAbove=count;break;}
 const distances=[nearestBelow,nearestAbove].filter((value):value is number=>value!==null),minimumAbsoluteDeviation=Math.min(...distances.map(value=>Math.abs(value-targetRows))),nearestReachableRows=[...new Set(distances.filter(value=>Math.abs(value-targetRows)===minimumAbsoluteDeviation))].sort((a,b)=>a-b),mixed=privateComponents.filter(component=>component.sharedRows>0&&component.holdoutRows>0);
 return{
  totalRows:rows.length,distinctFingerprintCount:fingerprints.size,repeatedFingerprintCount:privateRepeatedFingerprintIndex.length,repeatedFingerprintRows:repeatedRows.size,
  sharedHoldoutOverlapFingerprintCount:privateBoundaryFingerprintIndex.length,sharedAffectedRows:sharedRows.size,holdoutAffectedRows:holdoutRows.size,boundaryAffectedRows:sharedRows.size+holdoutRows.size,privateRepeatedFingerprintIndex,privateBoundaryFingerprintIndex,
  strictComponents:{count:privateComponents.length,largest:privateComponents[0]?.size??0,sizeDistribution,mixedBoundaryComponents:mixed.length,sharedRowsInMixedComponents:mixed.reduce((sum,item)=>sum+item.sharedRows,0),holdoutRowsInMixedComponents:mixed.reduce((sum,item)=>sum+item.holdoutRows,0),targetFraction,targetRows,exactTargetReachable:possible(targetRows),nearestReachableRows,nearestBelow,nearestAbove,minimumAbsoluteDeviation,nontrivialHoldoutPossible:privateComponents.length>1,privateComponents},
  interpretation:'Equal entity/member fingerprints are a strict-isolation assumption, not an adjudicated same-origin claim.',
 };
}
