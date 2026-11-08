import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import type { Readable } from 'node:stream';
import { fromBuffer, type Entry, type ZipFile } from 'yauzl';
import { ApiError } from './errors.js';

export const archiveLimits = Object.freeze({ bytes: 25 * 1024 * 1024, entries: 5000, expandedBytes: 100 * 1024 * 1024, entryBytes: 10 * 1024 * 1024, textBytes: 256 * 1024, ratio: 1000, timeoutMs: 10_000 });
export interface ArchiveEntry { name: string; type: 'file' | 'directory'; compressedSize: number; uncompressedSize: number }
export interface ArchiveInspection {
  sha256: string;
  size: number;
  totalUncompressedSize: number;
  entries: ArchiveEntry[];
  selected?: { name: string; size: number; text: string; truncated: false };
}

function invalid(message = 'ZIP 结构无效或不受支持，未读取条目内容。') { return new ApiError(422, 'ARCHIVE_INVALID', message); }
function validateEntry(entry: Entry): ArchiveEntry {
  const name = entry.fileName;
  if (!name || name.length > 1024 || /[\\\x00-\x1f\x7f]/.test(name) || name.startsWith('/') || /^[A-Za-z]:/.test(name)) throw invalid('ZIP 包含不安全的条目路径。');
  const segments = name.replace(/\/$/, '').split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) throw invalid('ZIP 包含不安全的条目路径。');
  const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
  if (mode !== 0 && mode !== 0x8000 && mode !== 0x4000) throw invalid('ZIP 包含符号链接或其他特殊条目，不能在此查看。');
  if (entry.isEncrypted() || (entry.generalPurposeBitFlag & 0x40) !== 0) throw invalid('不支持查看加密 ZIP。');
  if (![0, 8].includes(entry.compressionMethod)) throw invalid('ZIP 使用了不受支持的压缩方法。');
  if (![entry.compressedSize, entry.uncompressedSize].every(value => Number.isSafeInteger(value) && value >= 0)) throw invalid();
  if (entry.uncompressedSize > archiveLimits.entryBytes) throw new ApiError(413, 'ARCHIVE_ENTRY_LIMIT', 'ZIP 单个条目的展开大小不能超过 10 MiB。');
  if (entry.uncompressedSize > Math.max(1, entry.compressedSize) * archiveLimits.ratio) throw new ApiError(413, 'ARCHIVE_RATIO_LIMIT', 'ZIP 条目压缩比超过只读查看上限。');
  const type = name.endsWith('/') || mode === 0x4000 || (entry.externalFileAttributes & 0x10) !== 0 ? 'directory' : 'file';
  if (type === 'directory' && entry.uncompressedSize !== 0) throw invalid('ZIP 目录条目包含异常数据。');
  return { name, type, compressedSize: entry.compressedSize, uncompressedSize: entry.uncompressedSize };
}

/** Inspect a central directory in memory; never extract files or execute sample content. */
export async function inspectArchive(content: Buffer, selectedName?: string): Promise<ArchiveInspection> {
  if (content.length > archiveLimits.bytes) throw new ApiError(413, 'ARCHIVE_SIZE_LIMIT', 'ZIP 查看上限为 25 MiB。');
  return new Promise((resolve, reject) => {
    let zip: ZipFile | undefined, stream: Readable | undefined, settled = false, totalUncompressedSize = 0;
    const entries: ArchiveEntry[] = [], names = new Set<string>();
    let selected: Entry | undefined;
    const timer = setTimeout(() => finish(new ApiError(408, 'ARCHIVE_TIMEOUT', 'ZIP 读取超时，请使用更小的压缩包。')), archiveLimits.timeoutMs);
    function finish(error?: unknown, result?: ArchiveInspection) {
      if (settled) return;
      settled = true; clearTimeout(timer); stream?.destroy(); zip?.close();
      if (error) reject(error instanceof ApiError ? error : invalid());
      else resolve(result!);
    }
    const result = (): ArchiveInspection => ({ sha256: createHash('sha256').update(content).digest('hex'), size: content.length, entries, totalUncompressedSize });
    fromBuffer(content, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true, autoClose: false }, (error, opened) => {
      if (settled) { opened?.close(); return; }
      if (error || !opened) { finish(error ?? invalid()); return; }
      zip = opened;
      // Keep this listener after settlement to consume errors from a cancelled reader.
      zip.on('error', finish);
      if (zip.entryCount > archiveLimits.entries) { finish(new ApiError(413, 'ARCHIVE_COUNT_LIMIT', 'ZIP 条目不能超过 5,000 个。')); return; }
      zip.on('entry', (entry: Entry) => {
        if (settled) return;
        try {
          if (entries.length >= archiveLimits.entries) throw new ApiError(413, 'ARCHIVE_COUNT_LIMIT', 'ZIP 条目不能超过 5,000 个。');
          const item = validateEntry(entry), normalizedName = item.name.normalize('NFC');
          if (names.has(normalizedName)) throw invalid('ZIP 包含重复或歧义条目路径。');
          names.add(normalizedName); entries.push(item); totalUncompressedSize += item.uncompressedSize;
          if (totalUncompressedSize > archiveLimits.expandedBytes) throw new ApiError(413, 'ARCHIVE_EXPANDED_LIMIT', 'ZIP 声明的展开总大小不能超过 100 MiB。');
          if (entry.fileName === selectedName) selected = entry;
          zip!.readEntry();
        } catch (cause) { finish(cause); }
      });
      zip.on('end', () => {
        if (settled) return;
        if (selectedName === undefined) { finish(undefined, result()); return; }
        if (!selected) { finish(new ApiError(404, 'ARCHIVE_ENTRY_NOT_FOUND', 'ZIP 中没有此条目。')); return; }
        const item = entries.find(entry => entry.name === selectedName)!;
        if (item.type === 'directory') { finish(new ApiError(422, 'ARCHIVE_DIRECTORY', '请选择 ZIP 中的文本文件。')); return; }
        if (selected.uncompressedSize > archiveLimits.textBytes) { finish(new ApiError(413, 'ARCHIVE_TEXT_LIMIT', '单条目文本预览上限为 256 KiB，未返回截断内容。')); return; }
        zip!.openReadStream(selected, (cause, source) => {
          if (settled) { source?.destroy(); return; }
          if (cause || !source) { finish(cause ?? invalid()); return; }
          stream = source;
          const chunks: Buffer[] = []; let size = 0, checksum = 0;
          source.on('error', finish);
          source.on('data', (chunk: Buffer) => {
            if (settled) return;
            size += chunk.length;
            if (size > archiveLimits.textBytes || size > selected!.uncompressedSize) { finish(new ApiError(413, 'ARCHIVE_TEXT_LIMIT', '条目实际大小超过文本预览限制。')); return; }
            checksum = crc32(chunk, checksum); chunks.push(chunk);
          });
          source.on('end', () => {
            if (settled) return;
            if (size !== selected!.uncompressedSize || checksum !== selected!.crc32) { finish(invalid('ZIP 条目长度或 CRC 校验失败。')); return; }
            try {
              const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
              if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw invalid('此条目为二进制数据，不提供文本预览。');
              finish(undefined, { ...result(), selected: { name: selectedName, size, text, truncated: false } });
            } catch (cause) { finish(cause instanceof ApiError ? cause : invalid('此条目不是有效的 UTF-8 文本，不能在此预览。')); }
          });
        });
      });
      zip.readEntry();
    });
  });
}
