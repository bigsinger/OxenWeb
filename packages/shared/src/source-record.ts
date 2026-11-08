/** Source identities/provenance and pre-existing reference truth are separate from human annotations. */
const referenceTruth=new Set(['truth','ground_truth','expected','expected_label','_expected','label','labels']);
const reservedFields=['id','uid','__bundle_provenance','__proto__','constructor','prototype'];
export function sourceFieldIsReadOnly(field:string,identityField:string,record:Record<string,unknown>):boolean{
  return field===identityField||reservedFields.includes(field.toLowerCase())||Object.hasOwn(record,field)&&referenceTruth.has(field.toLowerCase());
}
export function protectedSourceFieldIds(record:Record<string,unknown>,identityField:string,candidate?:Record<string,unknown>):string[]{
  return [...new Set([...reservedFields,identityField,...Object.keys(record),...Object.keys(candidate??{})].filter(field=>field&&sourceFieldIsReadOnly(field,identityField,record)))];
}
