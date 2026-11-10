import path from 'node:path';
import type {BackupSource} from './backup.js';

/** Active controls only. Source protection is independent from release retention. */
export function controlBackupSources(control:string):BackupSource[]{
  const files=['governance.json','access-credentials.json','annotation-tasks.json','merge-requests.json','merge-resolutions.json','repository-policy-branches.json','repository-activity.json','repository-recycle-bin.json','live-workspace-branches.json','live-extensions.json','operation-journal.json','global-audit.json','evaluation-policy.json','source-access-markers.json'];
  const result:BackupSource[]=files.map(name=>({id:name.replace(/\.json$/,'').replaceAll('.','-'),root:path.join(control,name),kind:'control'}));
  for(const [id,folder,kind]of [['dataset-drafts','dataset-drafts','drafts'],['dataset-ui-state','dataset-ui-state','drafts'],['releases','releases','release']] as const)result.push({id,root:path.join(control,folder),kind});
  return result;
}
