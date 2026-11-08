import type { DatasetFieldMetadata, DatasetFieldOption, DatasetFieldType } from './field-metadata.js';
import type { DatasetFieldConflict } from './dataset-field-types.js';

export type DatasetFieldIssueCode = DatasetFieldConflict['code'];
export function datasetFieldTypeMatches(value: unknown, type: DatasetFieldType): boolean {
  if(type==='array')return Array.isArray(value);
  if(type==='object')return value!==null&&typeof value==='object'&&!Array.isArray(value);
  if(type==='number')return typeof value==='number'&&Number.isFinite(value);
  if(type==='integer')return typeof value==='number'&&Number.isFinite(value)&&Number.isInteger(value);
  return typeof value===type;
}
export function datasetFieldOptionMatches(value: unknown, option: DatasetFieldOption): boolean { return typeof value===typeof option&&value===option; }

/** Required controls key presence. Nullable controls null; neither invents a default value. */
export function datasetFieldValueIssue(definition: DatasetFieldMetadata, value: unknown, present=true): DatasetFieldIssueCode|undefined {
  if(!present||value===undefined)return definition.required?'required':undefined;
  if(value===null)return definition.nullable===false?'null':undefined;
  if(definition.type&&!datasetFieldTypeMatches(value,definition.type))return 'type';
  if(definition.enum&&!definition.enum.some(option=>datasetFieldOptionMatches(value,option)))return 'enum';
  if(Array.isArray(value)&&definition.items)for(const item of value){
    if(definition.items.type&&!datasetFieldTypeMatches(item,definition.items.type))return 'item-type';
    if(definition.items.enum&&!definition.items.enum.some(option=>datasetFieldOptionMatches(item,option)))return 'item-enum';
  }
  return undefined;
}
export function datasetRecordFieldIssues(record:Record<string,unknown>,fields:Readonly<Record<string,DatasetFieldMetadata>>={}):Array<{field:string;code:DatasetFieldIssueCode}>{
  const issues:Array<{field:string;code:DatasetFieldIssueCode}>=[];
  for(const [field,definition]of Object.entries(fields)){
    const code=datasetFieldValueIssue(definition,record[field],Object.hasOwn(record,field));
    if(code)issues.push({field,code});
  }
  return issues;
}
