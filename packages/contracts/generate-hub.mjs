import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import openapiTS, { astToString } from 'openapi-typescript';

const root = new URL('../../', import.meta.url);
const raw = await readFile(new URL('contracts/oxen_hub_api.json', root));
const provenance = JSON.parse(await readFile(new URL('contracts/hub-source.json', root), 'utf8'));
if (createHash('sha256').update(raw).digest('hex') !== provenance.sha256) throw new Error('Pinned Hub OpenAPI checksum differs; review the upstream contract before changing provenance.');
const spec = JSON.parse(raw.toString('utf8'));
// Keep the separate hosted Hub contract separate from the open-source server API.
// Generated type availability does not imply a configured or verified Hub feature.
const ast = await openapiTS(spec, { silent: true });
await mkdir(new URL('packages/contracts/src/', root), { recursive: true });
await writeFile(new URL('packages/contracts/src/hub.d.ts', root), astToString(ast));
const operations = Object.values(spec.paths).reduce((sum, item) => sum + Object.keys(item).filter(method => /^(get|post|put|patch|delete|head|options|trace)$/.test(method)).length, 0);
console.log(`Generated separate Oxen Hub ${spec.info.version} types (${Object.keys(spec.paths).length} paths, ${operations} operations); no hosted features were invoked.`);
