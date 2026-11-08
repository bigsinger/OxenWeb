import type {GovernanceDimension,PublishedDimension} from '@oxen/shared';

export function latestPublishedDimension(dimension:GovernanceDimension|undefined):PublishedDimension|undefined{
  return dimension?.versions.reduce<PublishedDimension|undefined>((latest,item)=>!latest||item.version>latest.version?item:latest,undefined);
}

/** Reading the UI state must never upgrade an existing template binding. */
export function dimensionBindingState(dimension:GovernanceDimension|undefined,selectedVersion:number){
  const selected=dimension?.versions.find(item=>item.version===selectedVersion),latest=latestPublishedDimension(dimension);
  return {selected,latest,status:!selected?'missing' as const:latest?.version===selected.version?'latest' as const:'pinned' as const};
}
