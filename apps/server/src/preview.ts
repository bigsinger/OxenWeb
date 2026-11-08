import path from 'node:path';
import type { FilePreview, TableColumn } from '../../../packages/shared/src/index.js';
import { parseJsonl, stableRowIds } from './jsonl.js';

export function mimeFor(filename: string): string {
  const types: Record<string, string> = { '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.json': 'application/json', '.jsonl': 'application/x-ndjson', '.ndjson': 'application/x-ndjson', '.md': 'text/markdown', '.txt': 'text/plain', '.py': 'text/plain', '.ts': 'text/plain', '.yaml': 'text/yaml', '.yml': 'text/yaml', '.toml': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
  return types[path.extname(filename).toLowerCase()] ?? 'application/octet-stream';
}

// RFC 4180 quoted fields, including escaped quotes and embedded newlines.
export function parseDelimited(input: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (c === '"') {
      if (quoted && input[i + 1] === '"') { field += '"'; i++; }
      else if (!field || quoted) quoted = !quoted;
      else field += c;
    } else if (c === delimiter && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field); if (row.some(value => value.length > 0)) rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function tableFrom(content: string, filename: string): { columns: TableColumn[]; rows: Record<string, unknown>[] } | undefined {
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.csv' || extension === '.tsv') {
    const [header, ...values] = parseDelimited(content, extension === '.tsv' ? '\t' : ',');
    if (!header) return { columns: [], rows: [] };
    const unique = header.map((name, i) => name || `column_${i + 1}`).map((name, i, all) => all.indexOf(name) === i ? name : `${name}_${i + 1}`);
    return { columns: unique.map(name => ({ name, dtype: 'string' })), rows: values.map(row => Object.fromEntries(unique.map((name, i) => [name, row[i] ?? '']))) };
  }
  if (extension === '.jsonl' || extension === '.ndjson') {
    return parseJsonl(content);
  }
  return undefined;
}

export function makePreview(filename: string, content: Buffer, url: string, page: number, pageSize: number): FilePreview {
  const mime = mimeFor(filename);
  const base = { path: filename, size: content.length, mime, url };
  if (mime.startsWith('image/')) return { ...base, kind: 'image' };
  if (mime.startsWith('audio/')) return { ...base, kind: 'audio' };
  if (mime.startsWith('video/')) return { ...base, kind: 'video' };
  if (mime === 'application/pdf') return { ...base, kind: 'pdf' };
  const table = /\.(jsonl|ndjson)$/i.test(filename) ? parseJsonl(content) : tableFrom(content.toString('utf8'), filename);
  if (table) return { ...base, kind: 'table', columns: table.columns, rows: table.rows.slice((page - 1) * pageSize, page * pageSize), rowIds: stableRowIds(table.rows).slice((page - 1) * pageSize, page * pageSize), totalRows: table.rows.length, page, pageSize };
  if (mime.startsWith('text/') || mime === 'application/json' || /\.(gitignore|sql|rs|sh|xml|html|css)$/i.test(filename)) {
    const limit = 512 * 1024;
    return { ...base, kind: 'text', text: content.subarray(0, limit).toString('utf8'), truncated: content.length > limit };
  }
  return { ...base, kind: 'binary' };
}
