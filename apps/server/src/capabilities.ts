import { z } from 'zod';
import type { DatasetCapability, RepositoryRole } from '../../../packages/shared/src/index.js';
export const capabilityNames = ['read', 'data.edit', 'dataset.assign', 'annotation.assign', 'annotation.review', 'tasks.manage', 'schema.bind', 'schema.manage', 'merge.execute', 'release.manage', 'release.share', 'release.hidden', 'data.export', 'project.admin'] as const;
export const capabilitySchema = z.enum(capabilityNames);
export const repositoryRoleSchema = z.enum(['viewer', 'annotator', 'editor', 'reviewer', 'lead', 'admin']);
const projectAll = capabilityNames.filter(capability => capability !== 'schema.manage');
export const roleCapabilities: Record<RepositoryRole | 'guest', readonly DatasetCapability[]> = {
  guest: ['read'], viewer: ['read', 'data.export'], annotator: ['read', 'annotation.assign', 'data.export'],
  editor: ['read', 'data.edit', 'annotation.assign', 'data.export'], reviewer: ['read', 'annotation.review', 'data.export'],
  lead: ['read', 'dataset.assign', 'tasks.manage', 'schema.bind', 'merge.execute', 'release.manage', 'release.share', 'data.export'], admin: projectAll,
};
