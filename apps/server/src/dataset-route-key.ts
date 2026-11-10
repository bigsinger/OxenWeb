import type {RepoKey} from './provider.js';
import {ApiError} from './errors.js';
import {safeSegment} from './safety.js';

/** A decoded namespace/repository identifier; decode URL parameters exactly once upstream. */
export function datasetRepositoryKey(value:string):RepoKey{
  const pieces=value.split('/');
  if(pieces.length!==2)throw new ApiError(400,'DATASET_ID_INVALID','数据集ID须为命名空间/项目。');
  return {namespace:safeSegment(pieces[0]!),repo:safeSegment(pieces[1]!)};
}
