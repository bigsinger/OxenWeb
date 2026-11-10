import type {DatasetFieldMetadata} from './field-metadata.js';
import {fieldOptionKey} from './field-option-colors.js';

/** A display alias never changes the stored option ID or its primitive type. */
export function datasetFieldOptionLabel(definition:DatasetFieldMetadata|undefined,value:unknown):string|undefined {
  if(typeof value!=='string'&&typeof value!=='number'&&typeof value!=='boolean')return;
  const label=definition?.optionLabels?.[fieldOptionKey(value)];
  return typeof label==='string'&&label.trim()?label:undefined;
}
