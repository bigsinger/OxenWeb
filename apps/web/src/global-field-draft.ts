import type { GlobalFieldDefinition } from '../../../packages/shared/src/global-fields';

/** Directory DTOs originate in JSON transport/storage; Vue may wrap every nested node in a Proxy. */
export function cloneGlobalFieldDraft(fields: readonly GlobalFieldDefinition[]): GlobalFieldDefinition[] {
  return JSON.parse(JSON.stringify(fields)) as GlobalFieldDefinition[];
}
