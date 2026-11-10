import type {DatasetRelease,ReleaseAsset} from '../../../packages/shared/src/releases';

/** Downloads are shared only with explicit backend authority. */
export function shareableReleaseAssets(release:DatasetRelease|undefined):ReleaseAsset[]{
  return !release||release.kind!=='release'||release.status!=='published'?[]:release.assets.filter(asset=>asset.shareable===true&&asset.audience==='shared');
}

/** Refresh generated text without silently overwriting an author's own explanation. */
export function refreshedReleaseNotes(current:string,previousGenerated:string,nextGenerated:string){
  return current===''||current===previousGenerated?nextGenerated:current;
}

/** The API retains one published release per project; publishing selects it automatically. */
export function latestPublishedDatasetRelease(releases:DatasetRelease[]){
  return releases.find(item=>item.kind==='release'&&item.status==='published');
}

export function releaseCleanupWarning(release:Pick<DatasetRelease,'status'|'cleanupPending'>|undefined){
  return release?.status==='published'&&release.cleanupPending===true?'新版已发布，旧下载链接已失效；旧文件清理尚未完成，请联系管理员核查存储后重试清理。':undefined;
}
