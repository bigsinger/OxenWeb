import type {DatasetSnapshot,DatasetAttachment} from '../../../packages/shared/src/dataset.js';
import {ApiError} from './errors.js';
import {safeFilePath} from './safety.js';
import {projectReleaseFields} from './release-field-projection.js';
export function selectedReleaseAttachments(snapshot: DatasetSnapshot): DatasetAttachment[] {
  // Even a complete dataset only includes attachments referenced by retained export fields.
  const projection = projectReleaseFields(snapshot, true), byPath = new Map<string, Set<string>>();
  const sourcePaths=new Set([snapshot.path,snapshot.descriptor.canonicalPath,snapshot.readmePath,snapshot.descriptor.readmePath,snapshot.descriptor.importManifestPath,snapshot.descriptor.identityMapPath].filter((filename):filename is string=>!!filename).map(filename=>filename.normalize('NFC').toLowerCase()));
  projection.rows.forEach((row, index) => { for (const field of projection.descriptor.attachmentFields) {
    const raw = row[field]; for (const candidate of Array.isArray(raw) ? raw : [raw]) {
      if (typeof candidate !== 'string' || !candidate || /^[a-z][a-z0-9+.-]*:/i.test(candidate)) continue;
      const filename = safeFilePath(candidate);
      if (sourcePaths.has(filename.normalize('NFC').toLowerCase()) || /^(?:\.oxenweb|\.oxen|provenance|source\/(?:archives|files))(?:\/|$)/i.test(filename)) throw new ApiError(422, 'RELEASE_EXPORT_SOURCE_ATTACHMENT', '发布附件不得指向完整源表、主库 README、来源归档或控制文件。');
      const ids = byPath.get(filename) ?? new Set<string>(); ids.add(snapshot.rowIds[index]!); byPath.set(filename, ids);
    }
  }});
  for (const filename of byPath.keys()) if (!snapshot.attachments.some(item => item.path === filename)) throw new ApiError(422, 'RELEASE_ATTACHMENT_REFERENCE', '所引用的样本附件缺少可验证的附件映射。');
  return [...byPath].sort(([a], [b]) => a.localeCompare(b)).map(([filename, ids]) => ({ ...snapshot.attachments.find(item => item.path === filename)!, rowIds: [...ids] }));
}
