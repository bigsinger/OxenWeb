import {test,expect,type Page} from '@playwright/test';
import {createPlaywrightScenarioAdapter} from './scenarios.mjs';
import {openPublishedRelease,openReleaseForm,openReleaseList,releaseQaProjects} from './release-flows.mjs';

test.describe.configure({timeout:60000});
const base=(repo:string)=>'/api/repos/local/'+repo;
const releaseList=(repo:string)=>new RegExp('/api/repos/local/'+repo+'/releases(?:\\?.*)?$');
const shares=(repo:string)=>new RegExp('/api/repos/local/'+repo+'/releases/[^/]+/shares(?:\\?.*)?$');
const unique=(name:string)=>'r22-browser-'+name+'-'+Date.now().toString(36);
const readbackUnavailable={error:{code:'SYNTHETIC_READBACK_UNAVAILABLE',message:'Synthetic list readback unavailable after the actual saved candidate.'}};

async function noOriginalLink(page:Page){await expect(page.getByRole('textbox',{name:'刚创建的分享链接',exact:true})).toHaveCount(0);}

test('release POST succeeds but GET fails: keep the confirmed ID and retry only reads',async({page})=>{
  let posts=0,failReads=false,savedId='';
  await page.route(releaseList(releaseQaProjects.a),async route=>{
    if(route.request().method()==='POST'){
      posts++;const response=await route.fetch({maxRetries:0});expect(response.status()).toBe(201);savedId=(await response.json()).id;failReads=true;
      await route.fulfill({response});return;
    }
    if(route.request().method()==='GET'&&failReads){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify(readbackUnavailable)});return;}
    await route.continue();
  });
  const api=createPlaywrightScenarioAdapter(page),version=unique('readback'),title='Synthetic confirmed POST with failed GET';
  await openReleaseList(api);const form=await openReleaseForm(api,{version,title});
  await form.getByRole('button',{name:'仅保存候选',exact:true}).click();await expect(form).toBeHidden();
  await expect(page.locator('.release-detail-heading h2')).toHaveText(title);
  await expect.poll(()=>new URL(page.url()).searchParams.get('release')).toBe(savedId);
  await expect(page.getByText(/操作已完成，但列表刷新失败/)).toBeVisible();expect(posts).toBe(1);
  failReads=false;await page.getByRole('button',{name:'只读重试刷新',exact:true}).click();
  await expect(page.getByText(/操作已完成，但列表刷新失败/)).toHaveCount(0);
  await expect(page.locator('.release-detail-heading h2')).toHaveText(title);expect(posts).toBe(1);
});

test('save and validate makes one candidate and one build while final publication still needs confirmation',async({page})=>{
  let saves=0,builds=0,publishes=0;
  page.on('request',request=>{const path=new URL(request.url()).pathname;if(request.method()!=='POST')return;if(path===base(releaseQaProjects.a)+'/releases')saves++;if(new RegExp('^'+base(releaseQaProjects.a)+'/releases/[^/]+/build$').test(path))builds++;if(new RegExp('^'+base(releaseQaProjects.a)+'/releases/[^/]+/publish$').test(path))publishes++;});
  const api=createPlaywrightScenarioAdapter(page);await openReleaseList(api);
  const form=await openReleaseForm(api,{version:unique('combined'),title:'Synthetic combined save and validate'});
  await form.getByRole('button',{name:'保存并校验',exact:true}).click();await expect(form).toBeHidden();
  await expect(page.getByRole('button',{name:'核对并发布',exact:true})).toBeVisible({timeout:30000});
  expect(saves).toBe(1);expect(builds).toBe(1);expect(publishes).toBe(0);
  await page.getByRole('button',{name:'核对并发布',exact:true}).click();
  const confirmation=page.getByRole('alertdialog',{name:'发布此版本',exact:true});await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText('替换现有已发布版本');await expect(confirmation).toContainText('旧下载链接和分享链接失效');
  expect(publishes).toBe(0);await confirmation.getByRole('button',{name:'取消',exact:true}).click();
  await expect(confirmation).toBeHidden();await expect(page.locator('.release-status.ready')).toHaveCount(1);expect(publishes).toBe(0);expect(saves).toBe(1);expect(builds).toBe(1);
});

test('filtered empty releases reset conditions, first empty project offers creation and snapshots use their own filters',async({page})=>{
  const api=createPlaywrightScenarioAdapter(page);await openReleaseList(api);
  await page.getByRole('textbox',{name:'搜索发布版本',exact:true}).fill('No matching synthetic release 8f4e');
  await expect(page.getByRole('heading',{name:'没有匹配的版本',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'创建第一个 Release',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'清除筛选',exact:true}).click();await expect(page.getByRole('textbox',{name:'搜索发布版本',exact:true})).toHaveValue('');
  await expect(page.getByRole('heading',{name:'当前发布',exact:true})).toBeVisible();
  await page.getByRole('combobox',{name:'筛选发布状态',exact:true}).selectOption('published');
  await page.getByRole('button',{name:'我的工作快照',exact:true}).click();
  const status=page.getByRole('combobox',{name:'筛选发布状态',exact:true});await expect(status).toHaveValue('all');
  await status.selectOption('ready');await expect(page.locator('.release-list-item .release-status').first()).toHaveText('可下载');
  await expect(status.locator('option[value="published"]')).toHaveCount(0);
  await openReleaseList(api,releaseQaProjects.empty);await expect(page.getByRole('heading',{name:'尚未发布版本',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'创建第一个 Release',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'清除筛选',exact:true})).toHaveCount(0);
});

test('an actual composing Tab event cannot fill a title while plain Tab preserves explicit author text',async({page})=>{
  const api=createPlaywrightScenarioAdapter(page);await openReleaseList(api);const form=await openReleaseForm(api);
  const title=form.getByRole('textbox',{name:'版本标题',exact:true});await title.focus();
  await title.evaluate((element:HTMLElement)=>element.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',code:'Tab',bubbles:true,isComposing:true})));
  await expect(title).toHaveValue('');
  await title.evaluate((element:HTMLElement)=>element.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',code:'Tab',bubbles:true,isComposing:false})));
  await expect(title).not.toHaveValue('');await title.fill('Synthetic author title');
  await title.evaluate((element:HTMLElement)=>element.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',code:'Tab',bubbles:true,isComposing:false})));
  await expect(title).toHaveValue('Synthetic author title');await title.fill('');
  await form.getByRole('button',{name:'关闭发布表单',exact:true}).click();await expect(form).toBeHidden();
});

test('a delayed real B share response cannot replace project A sharing after UI navigation',async({page})=>{
  let release!:()=>void,started!:()=>void,finished!:()=>void,held=false;
  const gate=new Promise<void>(resolve=>{release=resolve;}),requested=new Promise<void>(resolve=>{started=resolve;}),delivered=new Promise<void>(resolve=>{finished=resolve;});
  await page.route(shares(releaseQaProjects.b),async route=>{
    if(route.request().method()!=='GET'||held){await route.continue();return;}
    held=true;const response=await route.fetch({maxRetries:0});expect(response.status()).toBe(200);started();
    await gate;try{await route.fulfill({response});}catch{/* A cancelled old request is also isolated. */}finally{finished();}
  });
  try{
    const api=createPlaywrightScenarioAdapter(page);await openReleaseList(api,releaseQaProjects.b);await openPublishedRelease(api);
    await page.getByRole('button',{name:'管理下载链接',exact:true}).click();await requested;
    await page.getByLabel('切换项目',{exact:true}).click();
    await page.locator('.project-switch-list a[href="/repos/local/'+releaseQaProjects.a+'/overview"]').click();
    await expect(page).toHaveURL(new RegExp('/repos/local/'+releaseQaProjects.a+'/overview'));
    await page.getByRole('link',{name:'Releases',exact:true}).click();await openPublishedRelease(api);
    const filename=(await page.locator('.release-assets a[download]').filter({hasText:/\.zip\b/i}).innerText()).trim();
    await page.getByRole('button',{name:'管理下载链接',exact:true}).click();
    await expect(page.locator('.share-row').getByText('资产：'+filename,{exact:true})).toBeVisible();await noOriginalLink(page);
    release();await delivered;
    await expect(page.locator('.share-row').getByText('资产：'+filename,{exact:true})).toBeVisible();await noOriginalLink(page);
    await expect(page.getByText(/下载链接读取失败/)).toHaveCount(0);
  }finally{release();await page.unrouteAll({behavior:'ignoreErrors'});}
});

test('a real completed DELETE with its response cut is proven by GET without a second DELETE or original token',async({page})=>{
  let deletes=0,proofGets=0,sawDelete=false;
  page.on('request',request=>{if(sawDelete&&request.method()==='GET'&&shares(releaseQaProjects.b).test(request.url()))proofGets++;});
  await page.route(new RegExp('/api/repos/local/'+releaseQaProjects.b+'/releases/[^/]+/shares/[^/?]+$'),async route=>{
    if(route.request().method()!=='DELETE'){await route.continue();return;}
    deletes++;sawDelete=true;const response=await route.fetch({maxRetries:0});expect(response.status()).toBe(204);await route.abort('connectionreset');
  });
  const api=createPlaywrightScenarioAdapter(page);await openReleaseList(api,releaseQaProjects.b);await openPublishedRelease(api);
  await page.getByRole('button',{name:'管理下载链接',exact:true}).click();await expect(page.locator('.share-row').getByRole('button',{name:'撤销',exact:true})).toHaveCount(1);await noOriginalLink(page);
  await page.locator('.share-row').getByRole('button',{name:'撤销',exact:true}).click();
  const confirmation=page.getByRole('alertdialog',{name:'撤销分享链接',exact:true});await confirmation.getByRole('button',{name:'撤销链接',exact:true}).click();
  await expect(page.getByText('已从最新状态核对：该链接当前已撤销或不存在。',{exact:true})).toBeVisible();
  await expect.poll(()=>proofGets).toBeGreaterThan(0);expect(deletes).toBe(1);
  await expect(page.locator('.share-row').getByText('已撤销',{exact:true}).first()).toBeVisible();await expect(page.locator('.share-row').getByRole('button',{name:'撤销',exact:true})).toHaveCount(0);await noOriginalLink(page);
});

test('unchanged Enter and cancelled Escape restore the real cell focus without a sample draft or source write',async({page})=>{
  let datasetWrites=0;
  page.on('request',request=>{const path=new URL(request.url()).pathname;if(['POST','PUT','PATCH','DELETE'].includes(request.method())&&new RegExp('^'+base(releaseQaProjects.a)+'/dataset/(?:save|draft(?:/commit)?)$').test(path))datasetWrites++;});
  await page.goto('/repos/local/'+releaseQaProjects.a+'/table?branch=main');
  const sequence=page.getByRole('button',{name:'查看样本qa-1详情',exact:true});await expect(sequence).toBeVisible();
  await page.locator('.dw-resultbar .spin').waitFor({state:'hidden'});
  const close=page.getByRole('button',{name:'关闭样本详情',exact:true});if(await close.count())await close.click();
  const row=page.locator('.dw-grid table tbody tr').filter({has:sequence}),original='Synthetic sample 1. This text is an inert UI fixture.';
  const cell=row.getByRole('cell',{name:original,exact:true}),editor=page.getByRole('textbox',{name:'编辑 prompt',exact:true});
  await cell.dblclick();await expect(editor).toHaveValue(original);await editor.press('Enter');
  await expect(editor).toHaveCount(0);await expect(cell).toBeFocused();await expect(cell).toHaveText(original);
  await cell.dblclick();await expect(editor).toBeVisible();await editor.fill('Synthetic cancelled keyboard edit');await editor.press('Escape');
  await expect(editor).toHaveCount(0);await expect(cell).toBeFocused();await expect(cell).toHaveText(original);
  await expect(page.getByRole('dialog',{name:'样本详情',exact:true})).toHaveCount(0);await expect(page.locator('.dw-savebar')).toHaveCount(0);expect(datasetWrites).toBe(0);
});
