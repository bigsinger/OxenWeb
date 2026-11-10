import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readZipMembers} from '../../apps/server/src/zip-io.js';
import {createPlaywrightScenarioAdapter,tableScenario,managementScenario,readmeScenario,transferScenario} from './scenarios.mjs';

test('sample table: full headers, direct sequence switching, inline cancel, colors and time filters',async({page})=>{
  const result=await tableScenario(createPlaywrightScenarioAdapter(page));expect(result.timeSortAndFilter).toBe(true);
});
test('administrator access, personal tokens and audit list are meaningful and show no original token',async({page})=>{
  const result=await managementScenario(createPlaywrightScenarioAdapter(page));expect(result.pages).toBe(3);
});
test('manager pages remain usable at 390px without full-page horizontal overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});const result=await managementScenario(createPlaywrightScenarioAdapter(page));expect(result.layout.document).toBeLessThanOrEqual(390);
});
test('README changes show highlighted diff before commit and cancelled input restores original',async({page})=>{
  const result=await readmeScenario(createPlaywrightScenarioAdapter(page));expect(result.originalRestored).toBe(true);expect(result.committed).toBe(false);
});
test('real synthetic JSONL upload and snapshot download preserve records and exclude system activity columns',async({page})=>{
  const fixture=path.join(path.dirname(fileURLToPath(import.meta.url)),'fixtures/append-synthetic.jsonl');
  const result=await transferScenario(createPlaywrightScenarioAdapter(page),{filePath:fixture});
  const bytes=await readFile(result.downloadPath),members=new Map((await readZipMembers(bytes)).filter(member=>member.type==='file').map(member=>[member.name,member.content]));
  expect(bytes.subarray(0,2).toString()).toBe('PK');
  const records=members.get('samples.jsonl')!.toString('utf8').trim().split('\n').map(line=>JSON.parse(line));expect(records).toHaveLength(result.totalRows);
  expect(records.filter(row=>['r10-browser-import-one','r10-browser-import-two'].includes(row.data.id))).toHaveLength(2);
  for(const row of records){expect(row).not.toHaveProperty('rowActivity');expect(row).not.toHaveProperty('system');expect(row.data).not.toHaveProperty('system.updated_at');expect(row.data).not.toHaveProperty('system.actor');}
  const sums=members.get('checksums.sha256')!.toString('utf8').trim().split('\n');expect(sums.length).toBeGreaterThan(5);
  for(const line of sums){const match=/^([a-f0-9]{64})\s+(.+)$/.exec(line);expect(match).not.toBeNull();const content=members.get(match![2]!);expect(content).toBeDefined();expect(createHash('sha256').update(content!).digest('hex')).toBe(match![1]);}
});
