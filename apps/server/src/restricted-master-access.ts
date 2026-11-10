import type {FastifyInstance} from 'fastify';
import type {RequestIdentity} from '../../../packages/shared/src/index.js';
import type {RepoKey} from './provider.js';
import type {RepositoryAccessService} from './repository-access.js';
import {requestIdentity} from './auth.js';
import {ApiError} from './errors.js';
import {safeSegment} from './safety.js';

/** Download consumers do not receive source access to a mixed-visibility master.
 * This deliberately protects the whole repository, including old commits. It is
 * not row-level ACL and never rewrites or filters the original source/history.
 */
export class RestrictedMasterAccess {
  constructor(private access:Pick<RepositoryAccessService,'permissions'>,private restricted:(key:RepoKey)=>Promise<boolean>|boolean){}
  async mayReadSource(key:RepoKey,identity:RequestIdentity){
    const permissions=await this.access.permissions(key,identity);
    if(!permissions.read)return false;
    return !await this.restricted(key)||permissions.admin||permissions.capabilities?.['release.hidden']===true;
  }
  async requireSource(key:RepoKey,identity:RequestIdentity){
    if(!await this.mayReadSource(key,identity))throw new ApiError(identity.kind==='guest'?401:403,'RESTRICTED_MASTER_SOURCE_REQUIRED','此项目为受限样本主库，仅管理员或获准读取隐藏数据的人员可访问源数据、搜索及历史。算法／QA请使用获准的非隐藏发布包；普通项目读取权限不包含隐藏主库权限。');
  }
  install(app:FastifyInstance){
    app.addHook('onRequest',async request=>{
      const pathname=request.url.split('?')[0]!,match=/^\/api\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(pathname);
      if(!match)return;
      const tail=match[3]??'';
      // All release/snapshot exits enforce their own asset-level authorization.
      // Every other repository route is closed, including unknown/new aliases.
      if(/^\/(?:releases|snapshots)(?:\/|$)/.test(tail))return;
      const key={namespace:safeSegment(decodeURIComponent(match[1]!)),repo:safeSegment(decodeURIComponent(match[2]!))};
      await this.requireSource(key,requestIdentity(request));
    });
  }
}
