import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import openapiTS, { astToString } from 'openapi-typescript';

const root = new URL('../../', import.meta.url);
const sourcePath = new URL('contracts/oxen_server_openapi.json', root);
const provenance = JSON.parse(await readFile(new URL('contracts/source.json', root), 'utf8'));
const raw = await readFile(sourcePath);
const hash = createHash('sha256').update(raw).digest('hex');
if (hash !== provenance.sha256) {
  throw new Error('Pinned OpenAPI checksum differs from contracts/source.json; review the upstream contract before updating provenance.');
}
const spec = JSON.parse(raw.toString('utf8'));
const corrections = [];

// services/workspaces.rs registers these operations on the workspace collection.
// The published annotations accidentally append controller function names.
for (const [method, from] of [
  ['put', '/api/repos/{namespace}/{repo_name}/workspaces/get_or_create'],
  ['delete', '/api/repos/{namespace}/{repo_name}/workspaces/clear'],
]) {
  const to = '/api/repos/{namespace}/{repo_name}/workspaces';
  const operation = spec.paths[from]?.[method];
  if (!operation || spec.paths[to]?.[method]) throw new Error(`Expected upstream workspace route defect changed: ${method} ${from}`);
  spec.paths[to][method] = operation;
  delete spec.paths[from][method];
  if (Object.keys(spec.paths[from]).length === 0) delete spec.paths[from];
  corrections.push({ method, from, to, evidence: 'crates/oxen-server/src/services/workspaces.rs@0d3045335f93d77171f95f599a3cee3a080622ae' });
}
for (const [from, to] of [
  ['/api/repos/{namespace}/{repo_name}/compare/{base_head}/entries', '/api/repos/{namespace}/{repo_name}/compare/entries/{base_head}'],
  ['/api/repos/{namespace}/{repo_name}/compare/{base_head}/commits', '/api/repos/{namespace}/{repo_name}/compare/commits/{base_head}'],
  ['/api/repos/{namespace}/{repo_name}/compare/{base_head}/tree', '/api/repos/{namespace}/{repo_name}/compare/dir_tree/{base_head}'],
  ['/api/repos/{namespace}/{repo_name}/compare/{base_head}/dir/{dir}/entries', '/api/repos/{namespace}/{repo_name}/compare/entries/{base_head}/dir/{dir}'],
]) {
  if (!spec.paths[from]?.get || spec.paths[to]) throw new Error(`Expected upstream compare route defect changed: ${from}`);
  spec.paths[to] = spec.paths[from];
  delete spec.paths[from];
  corrections.push({ method: 'get', from, to, evidence: 'crates/oxen-server/src/services/compare.rs@0d3045335f93d77171f95f599a3cee3a080622ae' });
}
for (const [from, sourceMethod, to, actualMethod, evidence] of [
  ['/api/repos/{namespace}/{repo_name}/data_frames/{resource}/index', 'post', '/api/repos/{namespace}/{repo_name}/data_frames/index/{resource}', 'post', 'crates/oxen-server/src/services/data_frames.rs'],
  ['/api/repos/{namespace}/{repo_name}/metadata/{resource}', 'get', '/api/repos/{namespace}/{repo_name}/meta/{resource}', 'get', 'crates/oxen-server/src/services/meta.rs'],
  ['/api/repos/{namespace}/{repo_name}/metadata/{resource}', 'put', '/api/repos/{namespace}/{repo_name}/meta/{resource}', 'post', 'crates/oxen-server/src/services/meta.rs'],
]) {
  const operation = spec.paths[from]?.[sourceMethod];
  if (!operation || spec.paths[to]?.[actualMethod]) throw new Error(`Expected upstream metadata/index route defect changed: ${sourceMethod} ${from}`);
  spec.paths[to] ??= {};
  spec.paths[to][actualMethod] = operation;
  delete spec.paths[from][sourceMethod];
  if (Object.keys(spec.paths[from]).length === 0) delete spec.paths[from];
  corrections.push({ from: `${sourceMethod} ${from}`, to: `${actualMethod} ${to}`, evidence: `${evidence}@0d3045335f93d77171f95f599a3cee3a080622ae` });
}
// FileContents derives ToSchema for its Rust enum, but its custom Serde wire
// implementation serializes Text with serialize_str and accepts JSON via visit_str.
// Its visitor has no visit_seq, so do not advertise JSON byte arrays as supported.
const fileContents = spec.components.schemas.FileContents;
if (!fileContents?.oneOf?.some(item => item.properties?.Text?.type === 'string')) throw new Error('Expected upstream FileContents schema defect changed.');
spec.components.schemas.FileContents = {
  type: 'string',
  description: 'JSON text content. The fixed server uses custom Serde serialize_str/visit_str. Upload binary files through the documented multipart file endpoint.',
};
corrections.push({ schema: 'FileContents', from: 'externally tagged Rust enum objects', to: 'plain JSON string (verified text transport)', evidence: 'crates/liboxen/src/model/file.rs@0d3045335f93d77171f95f599a3cee3a080622ae' });

// These four controllers consume web::Query<T> in the pinned official Rust source.
// Preserve the downloaded original; this overlay repairs generator metadata only.
const queryParameters = new Map([
  ['/api/repos/{namespace}/{repo_name}/dir/{resource}', ['page', 'page_size', 'api_version', 'depth', 'sort_by', 'reverse']],
  ['/api/repos/{namespace}/{repo_name}/commits/history/{resource}', ['page', 'page_size']],
  ['/api/repos/{namespace}/{repo_name}/data_frames/{resource}', ['columns', 'delimiter', 'find_embedding_where', 'filter', 'output', 'output_column', 'page_size', 'page', 'row', 'randomize', 'reverse', 'slice', 'sort_by', 'sort_by_similarity_to', 'sql', 'take']],
  ['/api/repos/{namespace}/{repo_name}/workspaces', ['name']],
]);
for (const [path, names] of queryParameters) {
  const operation = spec.paths[path]?.get;
  if (!operation) throw new Error(`Expected GET operation missing: ${path}`);
  for (const name of names) {
    const parameter = operation.parameters?.find((item) => item.name === name);
    if (!parameter || parameter.in !== 'path') throw new Error(`Expected upstream parameter defect changed: ${path} ${name}`);
    parameter.in = 'query';
    parameter.required = false;
    corrections.push({ method: 'get', path, parameter: name, from: 'required path', to: 'optional query' });
  }
}
// The upstream reuses operationId across controller modules. Give every operation
// a stable unique identifier without changing its method, path, payload, or response.
for (const [path, pathItem] of Object.entries(spec.paths)) {
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']) {
    const operation = pathItem[method];
    if (!operation) continue;
    operation['x-original-operation-id'] = operation.operationId;
    operation.operationId = `${method}_${path.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
  }
}
await mkdir(new URL('packages/contracts/src/', root), { recursive: true });
await writeFile(new URL('contracts/oxen_server_openapi.normalized.json', root), `${JSON.stringify(spec, null, 2)}\n`);
await writeFile(new URL('contracts/normalization.json', root), `${JSON.stringify({ sourceSha256: hash, corrections, operationIds: 'unique method + path; original retained in x-original-operation-id' }, null, 2)}\n`);
const ast = await openapiTS(spec, { silent: true });
await writeFile(new URL('packages/contracts/src/oxen.d.ts', root), astToString(ast));
console.log(`Generated Oxen ${spec.info.version} types; ${corrections.length} source-verified metadata corrections.`);
