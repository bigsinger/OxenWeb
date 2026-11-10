import {createHmac} from 'node:crypto';
export const splitNames=['train','dev','test'] as const;
export type CandidateSplit=typeof splitNames[number];
export interface FourDimensionNode {id:string;kind:string;groupId:string;stratum:string;sourceClass:string;blocked:boolean;qualityRank:number;regressionRank:number}
const tie=(seed:Uint8Array,scope:string,id:string)=>createHmac('sha256',seed).update(JSON.stringify([scope,id])).digest('hex');
/** Correlation groups are indivisible; ratios count rows, never numbers of groups. */
export function allocateThreeSplits(nodes:readonly FourDimensionNode[],seed:Uint8Array,ratios:readonly[number,number,number]=[.6,.2,.2]){
 if(!seed.byteLength||ratios.some(n=>!Number.isFinite(n)||n<0)||Math.abs(ratios.reduce((a,b)=>a+b,0)-1)>1e-9)throw Error('Invalid candidate allocation parameters');
 const seen=new Set<string>(),groups=new Map<string,FourDimensionNode[]>();
 for(const n of nodes){if(!n.id||seen.has(n.id)||!n.groupId)throw Error('Invalid candidate node');seen.add(n.id);const group=groups.get(n.groupId)??[];group.push(n);groups.set(n.groupId,group);}
 const blockedGroups=new Set([...groups].filter(([,members])=>members.some(n=>n.blocked)).map(([id])=>id));
 const active=nodes.filter(n=>!blockedGroups.has(n.groupId));
 const totals=new Map<string,number>(),importance=new Map<string,number>();
 const vector=(n:FourDimensionNode)=>[[JSON.stringify([n.kind]),1],[JSON.stringify([n.kind,'class',n.sourceClass]),3],[JSON.stringify([n.kind,'stratum',n.stratum]),.15]] as const;
 for(const n of active)for(const[key,power]of vector(n)){totals.set(key,(totals.get(key)??0)+1);importance.set(key,power);}
 const counts=splitNames.map(()=>new Map<string,number>()),byId:Record<string,CandidateSplit|null>=Object.create(null);
 const groupVectors=[...groups].filter(([id])=>!blockedGroups.has(id)).map(([id,members])=>{const values=new Map<string,number>();for(const n of members)for(const[key]of vector(n))values.set(key,(values.get(key)??0)+1);return{id,members,values,tie:tie(seed,'split',id),split:0};}).sort((a,b)=>b.members.length-a.members.length||a.tie.localeCompare(b.tie));
 const cost=(split:number,key:string,count:number)=>{const total=totals.get(key)!,target=total*ratios[split]!;return importance.get(key)!*(count-target)**2/Math.max(1,target);};
 const delta=(g:typeof groupVectors[number],split:number,sign:number)=>{let sum=0;for(const[key,size]of g.values){const count=counts[split]!.get(key)??0;sum+=cost(split,key,count+sign*size)-cost(split,key,count);}return sum;};
 const apply=(g:typeof groupVectors[number],split:number,sign:number)=>{for(const[key,size]of g.values)counts[split]!.set(key,(counts[split]!.get(key)??0)+sign*size);};
 for(const g of groupVectors){g.split=[0,1,2].filter(index=>ratios[index]!>0).sort((a,b)=>delta(g,a,1)-delta(g,b,1)||tie(seed,'choice',g.id+':'+a).localeCompare(tie(seed,'choice',g.id+':'+b)))[0]!;apply(g,g.split,1);}
 let moves=0,passes=0;for(;passes<12;passes++){let changed=0;for(const g of groupVectors){let best=g.split,bestChange=-1e-10;for(const split of [0,1,2]){if(split===g.split||ratios[split]===0)continue;const change=delta(g,g.split,-1)+delta(g,split,1);if(change<bestChange){bestChange=change;best=split;}}if(best!==g.split){apply(g,g.split,-1);g.split=best;apply(g,best,1);changed++;moves++;}}if(!changed)break;}
 for(const[id,members]of groups)for(const n of members)byId[n.id]=blockedGroups.has(id)?null:splitNames[groupVectors.find(g=>g.id===id)!.split]!;
 return{byId,blockedGroups:[...blockedGroups],method:'deterministic-grouped-greedy-local-moves',globallyOptimal:false,passes,moves,ratios:[...ratios],ratioDenominator:'eligible rows per kind (blocked excluded)'};
}
export function joinCandidateGroups(nodes:readonly FourDimensionNode[],relations:readonly string[][],seed:Uint8Array):FourDimensionNode[]{
 const parent=new Map(nodes.map(n=>[n.id,n.id]));const root=(id:string):string=>{let result=parent.get(id)!;while(parent.get(result)!==result)result=parent.get(result)!;let current=id;while(parent.get(current)!==result){const next=parent.get(current)!;parent.set(current,result);current=next;}return result;};
 const join=(ids:readonly string[])=>{const known=ids.filter(id=>parent.has(id));if(!known.length)return;const first=root(known[0]!);for(const id of known)parent.set(root(id),first);};
 const baseline=new Map<string,string[]>();for(const n of nodes){const ids=baseline.get(n.groupId)??[];ids.push(n.id);baseline.set(n.groupId,ids);}for(const ids of baseline.values())join(ids);for(const ids of relations)join(ids);
 const components=new Map<string,string[]>();for(const n of nodes){const id=root(n.id),members=components.get(id)??[];members.push(n.id);components.set(id,members);}const names=new Map([...components].map(([id,members])=>[id,'strict-'+tie(seed,'component',members.sort().join('|')).slice(0,24)]));return nodes.map(n=>({...n,groupId:names.get(root(n.id))!}));
}
export function fingerprintCrossings(index:readonly {members:string[]}[],assignment:Readonly<Record<string,string|null>>){const affected=new Set<string>();let fingerprints=0;for(const item of index){const members=item.members.filter(id=>assignment[id]!==undefined&&assignment[id]!==null);if(new Set(members.map(id=>assignment[id])).size>1){fingerprints++;members.forEach(id=>affected.add(id));}}const byBucket:Record<string,number>={};for(const id of affected){const bucket=assignment[id]!;byBucket[bucket]=(byBucket[bucket]??0)+1;}return{fingerprints,affectedRows:affected.size,byBucket};}
export function reviewPriority(nodes:readonly FourDimensionNode[],assignment:Readonly<Record<string,CandidateSplit|null>>,seed:Uint8Array,fraction:number,rank:'qualityRank'|'regressionRank',allow:(n:FourDimensionNode)=>boolean=()=>true){
 const selected=new Set<string>();for(const kind of new Set(nodes.map(n=>n.kind))){const kindRows=nodes.filter(n=>n.kind===kind),eligible=kindRows.filter(n=>assignment[n.id]!==null&&allow(n)),budget=Math.min(eligible.length,Math.round(kindRows.length*fraction));const groups=new Map<string,FourDimensionNode[]>();for(const n of eligible){const key=assignment[n.id]+'|'+n.sourceClass;const list=groups.get(key)??[];list.push(n);groups.set(key,list);}const chosen=new Map<string,number>();for(const list of groups.values())list.sort((a,b)=>b[rank]-a[rank]||tie(seed,rank,a.id).localeCompare(tie(seed,rank,b.id)));while([...chosen.values()].reduce((a,b)=>a+b,0)<budget){const key=[...groups.keys()].filter(key=>(chosen.get(key)??0)<groups.get(key)!.length).sort((a,b)=>(chosen.get(a)??0)/groups.get(a)!.length-(chosen.get(b)??0)/groups.get(b)!.length||a.localeCompare(b))[0];if(!key)break;const count=chosen.get(key)??0;selected.add(groups.get(key)![count]!.id);chosen.set(key,count+1);}}return selected;
}
