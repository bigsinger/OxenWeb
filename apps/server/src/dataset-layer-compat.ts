import type { DatasetLabelRecord } from '../../../packages/shared/src/dataset.js';
import type { ProjectSchemaBinding } from '../../../packages/shared/src/governance-types.js';
import type { LabelState } from '../../../packages/shared/src/index.js';

export function recordUsesActiveLayer(record:DatasetLabelRecord,binding:ProjectSchemaBinding|undefined):boolean{
  if(binding?.version!==2)return true;
  const layer=record.scope==='dataset'?'dataset':'sample',active=binding.layers[layer];if(!active)return false;
  const previous=record.templateSnapshot.binding as ProjectSchemaBinding|undefined;
  if(previous?.version!==2)return false;
  const old=previous.layers[layer];if(!old)return false;if(old.checksum===active.checksum)return true;
  if(old.organizationId!==active.organizationId||old.templateId!==active.templateId)return false;
  for(const values of [record.values,...record.spans.map(item=>item.values),...record.steps.map(item=>item.values)])for(const [id,value]of Object.entries(values)){
    if(value===null)continue;
    const a=old.snapshot.dimensions.find(item=>item.id===id),b=active.snapshot.dimensions.find(item=>item.id===id),scope=active.snapshot.bindings.find(item=>item.dimensionId===id);
    if(!a||!b||a.semanticKey!==b.semanticKey||a.type!==b.type||!scope?.scopes.includes(record.scope))return false;
    if(b.type==='text'){if(typeof value!=='string')return false;continue;}
    if(b.type==='single'&&typeof value!=='string'||b.type==='multi'&&!Array.isArray(value))return false;
    for(const selected of Array.isArray(value)?value:[value]){const before=a.options.find(option=>(option.legacyValue??option.id)===selected),after=b.options.find(option=>(option.legacyValue??option.id)===selected);if(!before||!after||before.id!==after.id)return false;}
  }
  return true;
}
/** Only the current dataset/sample schema contributes values. Retired definitions are not materialized. */
export function separateDatasetLayers(state:LabelState,records:DatasetLabelRecord[],binding:ProjectSchemaBinding|undefined){
  const activeState={...state,assignments:binding?.version===2?[]:state.assignments};
  return {state:activeState,records:records.filter(record=>recordUsesActiveLayer(record,binding))};
}
