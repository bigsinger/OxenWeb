import type {DatasetRelease} from '../../../packages/shared/src/releases';
export function releaseFormSuggestions(releases:DatasetRelease[],name:string,branch:string){
  const versions=new Set(releases.filter(item=>item.kind==='release').map(item=>item.version.toLowerCase()));let patch=0;while(versions.has(`v0.1.${patch}`))patch++;
  const version=`v0.1.${patch}`;
  return {version,title:`${name} ${version}`,sourceRef:branch,scoringRuleVersion:'aisec-score-v1',notes:'## 本版变更\n\n- 请填写新增、修订与复核情况。\n\n## 使用说明\n\n- 请说明用途、评测规则与已知限制。'};
}
/** No mutation on mount; only explicit button/Tab action accepts a hint, preserving user input. */
export function acceptReleaseHint(value:string,suggestion:string){return value===''?suggestion:value;}
