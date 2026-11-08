import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inspectArchive, archiveLimits } from '../src/archive.js';
import { ApiError } from '../src/errors.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { DemoProvider } from '../src/demo.js';
import type { RepoKey } from '../src/provider.js';

interface FixtureEntry { name: string; content?: Buffer | string; deflate?: boolean; declaredSize?: number; compressedSize?: number; flags?: number; attributes?: number; crc?: number }
/** Tiny fixture writer: names and central-directory metadata may deliberately be invalid. */
function zip(entries: FixtureEntry[]) {
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content ?? '');
    const payload = entry.deflate ? deflateRawSync(content) : content, local = Buffer.alloc(30), header = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE((entry.flags ?? 0) | 0x800, 6); local.writeUInt16LE(entry.deflate ? 8 : 0, 8); local.writeUInt32LE(entry.crc ?? crc32(content), 14); local.writeUInt32LE(entry.compressedSize ?? payload.length, 18); local.writeUInt32LE(entry.declaredSize ?? content.length, 22); local.writeUInt16LE(name.length, 26);
    header.writeUInt32LE(0x02014b50); header.writeUInt16LE(0x0314, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE((entry.flags ?? 0) | 0x800, 8); header.writeUInt16LE(entry.deflate ? 8 : 0, 10); header.writeUInt32LE(entry.crc ?? crc32(content), 16); header.writeUInt32LE(entry.compressedSize ?? payload.length, 20); header.writeUInt32LE(entry.declaredSize ?? content.length, 24); header.writeUInt16LE(name.length, 28); header.writeUInt32LE(entry.attributes ?? 0, 38); header.writeUInt32LE(offset, 42);
    locals.push(local, name, payload); central.push(header, name); offset += local.length + name.length + payload.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const rejects = (content: Buffer, code: string, entry?: string) => assert.rejects(inspectArchive(content, entry), (error: unknown) => error instanceof ApiError && error.code === code);

test('ZIP manifest preserves names, byte sizes and SHA-256; selected Skill/HTML is literal UTF-8', async () => {
  const text = '# Synthetic Skill\n<script>globalThis.executed=true</script>\n[external](https://example.test/)';
  const content = zip([{ name: 'skills/' }, { name: 'skills/SKILL.md', content: text, deflate: true }, { name: '空.txt', content: '' }]);
  const manifest = await inspectArchive(content);
  assert.equal(manifest.sha256, createHash('sha256').update(content).digest('hex'));
  assert.equal(manifest.size, content.length); assert.equal(manifest.entries.length, 3);
  assert.deepEqual(manifest.entries.map(entry => [entry.name, entry.type]), [['skills/', 'directory'], ['skills/SKILL.md', 'file'], ['空.txt', 'file']]);
  assert.equal(manifest.selected, undefined); assert.equal(manifest.totalUncompressedSize, Buffer.byteLength(text));
  const selected = await inspectArchive(content, 'skills/SKILL.md');
  assert.deepEqual(selected.selected, { name: 'skills/SKILL.md', size: Buffer.byteLength(text), text, truncated: false });
  assert.equal((globalThis as Record<string, unknown>).executed, undefined);
  assert.equal((await inspectArchive(content, '空.txt')).selected?.text, '');
  await rejects(content, 'ARCHIVE_ENTRY_NOT_FOUND', 'missing.md'); await rejects(content, 'ARCHIVE_DIRECTORY', 'skills/');
});

test('ZIP rejects unsafe paths, ambiguous names, links, encryption and malformed input', async () => {
  for (const name of ['../secret', '/absolute', 'C:/absolute', 'C:relative', 'a\\b', 'a/../b', 'a//b', './b', 'a\u0000b']) await rejects(zip([{ name, content: 'unsafe' }]), 'ARCHIVE_INVALID');
  await rejects(zip([{ name: 'link', content: '../target', attributes: (0xa1ff << 16) >>> 0 }]), 'ARCHIVE_INVALID');
  await rejects(zip([{ name: 'encrypted', flags: 1, content: 'hidden' }]), 'ARCHIVE_INVALID');
  await rejects(zip([{ name: 'a', content: '1' }, { name: 'a', content: '2' }]), 'ARCHIVE_INVALID');
  await rejects(zip([{ name: 'é.txt' }, { name: 'e\u0301.txt' }]), 'ARCHIVE_INVALID');
  await rejects(Buffer.from('not a zip'), 'ARCHIVE_INVALID');
});

test('ZIP limits archive bytes, count, declared expansion, entry size and compression ratio', async () => {
  await rejects(Buffer.alloc(archiveLimits.bytes + 1), 'ARCHIVE_SIZE_LIMIT');
  await rejects(zip(Array.from({ length: 5001 }, (_, i) => ({ name: `${i}.txt` }))), 'ARCHIVE_COUNT_LIMIT');
  await rejects(zip([{ name: 'big', deflate: true, declaredSize: archiveLimits.entryBytes + 1, compressedSize: 20_000 }]), 'ARCHIVE_ENTRY_LIMIT');
  await rejects(zip([{ name: 'ratio', deflate: true, declaredSize: 1001, compressedSize: 1 }]), 'ARCHIVE_RATIO_LIMIT');
  await rejects(zip(Array.from({ length: 11 }, (_, i) => ({ name: `${i}.txt`, deflate: true, declaredSize: archiveLimits.entryBytes, compressedSize: 20_000 }))), 'ARCHIVE_EXPANDED_LIMIT');
});

test('ZIP selected text is bounded, CRC checked and rejects binary or invalid UTF-8', async () => {
  const large = zip([{ name: 'large.txt', content: Buffer.alloc(archiveLimits.textBytes + 1, 65) }]);
  assert.equal((await inspectArchive(large)).entries.length, 1);
  await rejects(large, 'ARCHIVE_TEXT_LIMIT', 'large.txt');
  await rejects(zip([{ name: 'bad-crc.txt', content: 'safe', crc: 123 }]), 'ARCHIVE_INVALID', 'bad-crc.txt');
  await rejects(zip([{ name: 'binary', content: Buffer.from([0, 1, 2]) }]), 'ARCHIVE_INVALID', 'binary');
  await rejects(zip([{ name: 'invalid.txt', content: Buffer.from([0xc0, 0xaf]) }]), 'ARCHIVE_INVALID', 'invalid.txt');
  await rejects(zip([{ name: 'wrong-size.txt', content: 'more bytes', deflate: true, declaredSize: 1 }]), 'ARCHIVE_INVALID', 'wrong-size.txt');
  const exact = 'x'.repeat(archiveLimits.textBytes);
  assert.equal((await inspectArchive(zip([{ name: 'exact.txt', content: exact }]), 'exact.txt')).selected?.text.length, archiveLimits.textBytes);
});

test('ZIP route pins branch revision and enforces existing repository read ACL', async t => {
  const root = path.resolve('.data/tests'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'archive-test-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const archive = zip([{ name: 'SKILL.md', content: 'Synthetic skill text.' }]), reads: string[] = [];
  class ArchiveProvider extends DemoProvider {
    override async raw(key: RepoKey, ref: string, filename: string) {
      if (filename === 'skill.zip') { reads.push(ref); return { filename, mime: 'application/zip', content: archive }; }
      return super.raw(key, ref, filename);
    }
  }
  const token = 'archive-owner-test-token', config = loadConfig({ DEMO_MODE: 'true', DEMO_DATA_FILE: path.join(directory, 'state.json'), BFF_TOKEN: token });
  const provider = new ArchiveProvider(config.demoFile), app = await createApp(config, provider); t.after(() => app.close());
  const base = '/api/repos/oxen/visual-search', headers = { authorization: `Bearer ${token}`, 'x-oxen-request': 'web' };
  const commitId = (await provider.branches({ namespace: 'oxen', repo: 'visual-search' })).find(branch => branch.name === 'main')!.commitId;
  const response = await app.inject({ url: `${base}/archive?ref=main&path=skill.zip&entry=SKILL.md`, headers });
  assert.equal(response.statusCode, 200); assert.equal(response.json().commitId, commitId); assert.equal(reads.at(-1), commitId); assert.equal(response.json().selected.text, 'Synthetic skill text.');
  assert.equal((await app.inject({ url: `${base}/archive?ref=${commitId}&path=skill.zip`, headers })).statusCode, 200);
  assert.equal((await app.inject({ url: `${base}/archive?path=notes.txt`, headers })).statusCode, 422);
  const policy = await app.inject({ method: 'PATCH', url: base, headers, payload: { visibility: 'private' } }); assert.equal(policy.statusCode, 200);
  const before = reads.length, denied = await app.inject(`${base}/archive?ref=main&path=skill.zip`);
  assert.ok([401, 403].includes(denied.statusCode)); assert.equal(reads.length, before);
});
