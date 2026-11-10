/**
 * Shared UI-only scenarios. Never imports app state, sends HTTP requests, creates
 * browser sessions or reads credentials. CUA and Playwright run the same steps.
 *
 * CUA: const api=createCuaScenarioAdapter(existingTab);
 *      await tableScenario(api,{origin:'http://127.0.0.1:5173',onStep:label=>...});
 * CI:  const api=createPlaywrightScenarioAdapter(page); await tableScenario(api);
 */
export function createCuaScenarioAdapter(tab){
  const p=tab.playwright;
  return {goto:url=>tab.goto(url),getByRole:(...args)=>p.getByRole(...args),getByLabel:(...args)=>p.getByLabel(...args),getByText:(...args)=>p.getByText(...args),locator:(...args)=>p.locator(...args),evaluate:(...args)=>p.evaluate(...args),snapshot:()=>p.domSnapshot(),waitVisible:(locator,timeout=20000)=>locator.waitFor({state:'visible',timeoutMs:timeout}),waitHidden:(locator,timeout=20000)=>locator.waitFor({state:'hidden',timeoutMs:timeout}),waitForEvent:(event,timeout=30000)=>p.waitForEvent(event,{timeoutMs:timeout})};
}
export function createPlaywrightScenarioAdapter(page){
  return {goto:url=>page.goto(url),getByRole:(...args)=>page.getByRole(...args),getByLabel:(...args)=>page.getByLabel(...args),getByText:(...args)=>page.getByText(...args),locator:(...args)=>page.locator(...args),evaluate:(...args)=>page.evaluate(...args),snapshot:()=>page.locator('body').innerText(),waitVisible:(locator,timeout=20000)=>locator.waitFor({state:'visible',timeout}),waitHidden:(locator,timeout=20000)=>locator.waitFor({state:'hidden',timeout}),waitForEvent:(event,timeout=30000)=>page.waitForEvent(event,{timeout})};
}
function ensure(value,message){if(!value)throw new Error('UI acceptance: '+message);}
// Attach both handlers immediately: CUA may reject event observation on policy
// review before the subsequent click finishes. Retain and rethrow that exact error.
const capturedEvent=promise=>Promise.resolve(promise).then(value=>({ok:true,value}),error=>({ok:false,error}));
function eventValue(result){if(!result.ok)throw result.error;return result.value;}
const url=(options,path)=>new URL(path,options.origin??'http://127.0.0.1:5173').href;
async function observed(api,options,label){const state=await api.snapshot();ensure(!state.includes('[plugin:vite:')&&!state.includes('Internal Server Error'),'no framework error overlay after '+label);await options.onStep?.(label);return state;}
const project='/repos/local/ai-safety-ui-qa';
const sequence=(api,id)=>api.getByRole('button',{name:`查看样本${id}详情`,exact:true});
async function closeDetails(api,options){await api.waitHidden(api.locator('.dw-resultbar .spin'));const close=api.getByRole('button',{name:'关闭样本详情',exact:true});if(await close.count()){await close.click();await observed(api,options,'close details');}}

/** Non-destructive: only display/filter preferences and a cancelled inline edit. */
export async function tableScenario(api,options={}){
  await api.goto(url(options,project+'/table?branch=main'));await api.waitVisible(sequence(api,'qa-1'));await observed(api,options,'load synthetic table');
  await closeDetails(api,options);
  const grid=api.getByRole('region',{name:'数据编辑工作台'}),table=grid.locator('.dw-grid table');
  const headers=await table.locator('thead th').allTextContents();
  for(const text of ['title','业务标题','priority','优先级','categories','类别','最后修改时间','最后操作人'])ensure(headers.some(header=>header.includes(text)),'configured/system header present: '+text);
  const geometry=await api.evaluate(()=>({tableWidth:document.querySelector('.dw-grid table')?.getBoundingClientRect().width,body:getComputedStyle(document.querySelector('.dw-grid tbody td .dw-cell-text')).fontSize,header:getComputedStyle(document.querySelector('.dw-header-id')).fontSize,alias:getComputedStyle(document.querySelector('.dw-header-alias')).fontSize}));
  ensure(geometry.body==='14px'&&geometry.header==='14px'&&geometry.alias==='12px','readable source/header/alias font sizes');
  await sequence(api,'qa-1').click();await observed(api,options,'sequence qa-1 opens details');
  const details=api.getByRole('dialog',{name:'样本详情',exact:true});ensure((await details.locator('header code').innerText()).trim()==='qa-1','qa-1 details selected');
  await sequence(api,'qa-2').click();await observed(api,options,'sequence qa-2 updates already-open details once');ensure((await details.locator('header code').innerText()).trim()==='qa-2','second sequence click directly switches details');
  const afterWidth=await table.evaluate(element=>element.getBoundingClientRect().width);ensure(afterWidth===geometry.tableWidth,'overlay does not shrink table');
  const firstRow=table.locator('tbody tr').filter({has:sequence(api,'qa-1')}),prompt=grid.getByRole('cell',{name:'Synthetic sample 1. This text is an inert UI fixture.',exact:true});
  await firstRow.getByRole('cell',{name:'qa-1',exact:true}).click();await observed(api,options,'visible ID body cell closes details without opening a row');ensure(await details.count()===0,'body click does not open details');
  await prompt.dblclick();await observed(api,options,'double click opens inline text control');const editor=api.getByRole('textbox',{name:'编辑 prompt',exact:true});await api.waitVisible(editor);await editor.press('Escape');await observed(api,options,'Escape cancels unchanged inline control');ensure(await editor.count()===0,'inline control cancelled');
  const priority=firstRow.getByText('normal',{exact:true});
  ensure(await priority.evaluate(element=>getComputedStyle(element).color)==='rgb(233, 174, 96)','configured priority option color used in grid');
  const timeButton=api.getByRole('button',{name:/^按最后修改时间排序；(?:未排序|当前升序|当前降序)$/}),timeHeader=table.locator('th').filter({has:timeButton});
  await timeButton.click();await observed(api,options,'last-modified ascending');await api.waitHidden(grid.locator('.dw-resultbar .spin'));ensure(await timeHeader.getAttribute('aria-sort')==='ascending','time ascending state');
  await timeButton.click();await observed(api,options,'last-modified descending');await api.waitHidden(grid.locator('.dw-resultbar .spin'));ensure(await timeHeader.getAttribute('aria-sort')==='descending','time descending state');
  await timeButton.click();await observed(api,options,'clear last-modified sorting');await api.waitHidden(grid.locator('.dw-resultbar .spin'));ensure(await timeHeader.getAttribute('aria-sort')==='none','sort reset');
  await api.getByRole('button',{name:/^条件筛选/}).click();await observed(api,options,'open time filters');await api.getByRole('combobox',{name:'筛选字段',exact:true}).selectOption('system.updated_at');await observed(api,options,'choose system time filter');
  await api.getByRole('combobox',{name:'筛选操作',exact:true}).selectOption('gt');await observed(api,options,'choose greater-than filter');await api.getByLabel('最后修改时间筛选值',{exact:true}).fill('2099-01-01T00:00');await observed(api,options,'enter future cutoff');
  await api.getByRole('button',{name:'添加条件',exact:true}).click();await api.waitVisible(api.getByText('没有匹配样本',{exact:true}));await observed(api,options,'future time cutoff gives real empty result');
  await api.getByRole('button',{name:'清除全部条件',exact:true}).click();await api.waitVisible(sequence(api,'qa-1'));await observed(api,options,'clear filter restores synthetic rows');
  return {scenario:'table',configuredHeaders:true,systemHeaders:true,directSequenceSwitch:true,bodySelectionAndInlineCancel:true,stableTableWidth:true,optionColor:true,timeSortAndFilter:true,fonts:geometry};
}

/** Read-only manager pages. It deliberately never issues or displays a token. */
export async function managementScenario(api,options={}){
  for(const [path,title,region] of [['/access','访问管理','访问与令牌管理'],['/account/tokens','我的访问令牌','访问与令牌管理'],['/activity','操作日志','全局操作日志']]){
    await api.goto(url(options,path));await api.waitVisible(api.getByRole('heading',{name:title,exact:true}));await observed(api,options,'load '+title);
    const panel=api.getByRole('region',{name:region,exact:true});ensure(await panel.isVisible(),'manager region visible: '+title);
    ensure(await api.getByRole('textbox',{name:'一次性访问令牌',exact:true}).count()===0,'no original tokens in management listing');
  }
  await api.getByRole('textbox',{name:'人员',exact:true}).fill('No such synthetic actor');await observed(api,options,'enter audit no-match filter');await api.getByRole('button',{name:'筛选',exact:true}).click();await api.waitVisible(api.getByText('当前条件下没有操作记录。',{exact:true}));await observed(api,options,'audit empty filter is explicit');
  await api.getByRole('button',{name:'清除筛选',exact:true}).click();await observed(api,options,'clear audit filter');
  const fit=await api.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));ensure(fit.document<=fit.viewport,'management page does not overflow document horizontally');
  return {scenario:'management',pages:3,noSecretsRendered:true,emptyAuditFilter:true,layout:fit};
}

/** Exercise existing edit → diff workflow and restore original text without a commit. */
export async function readmeScenario(api,options={}){
  await api.goto(url(options,project+'/overview?branch=main'));await api.waitVisible(api.getByRole('button',{name:'编辑说明',exact:true}));await observed(api,options,'load synthetic README');
  await api.getByRole('button',{name:'编辑说明',exact:true}).click();await observed(api,options,'open README editor');const field=api.getByRole('textbox',{name:'数据集说明 Markdown',exact:true});const original=await field.evaluate(element=>element.value);
  ensure(original.includes('AI 安全样本集 · 交互验收'),'README scenario limited to the synthetic fixture');
  await field.fill(original+'\n\nSynthetic browser acceptance note, cancelled before commit.\n');await observed(api,options,'edit synthetic README input');
  await api.locator('.readme-editor nav').getByRole('button',{name:'核对修改',exact:true}).click();await observed(api,options,'review README diff before any commit');
  ensure((await api.locator('.readme-editor [data-diff-kind="added"]').allTextContents()).some(text=>text.includes('Synthetic browser acceptance note')),'README insertion highlighted');ensure(await api.getByRole('button',{name:'提交到分支',exact:true}).isVisible(),'explicit commit follows diff');
  await api.locator('.readme-editor nav').getByRole('button',{name:'编辑 Markdown',exact:true}).click();await observed(api,options,'return to README input');await field.fill(original);await observed(api,options,'restore original README text');await api.getByRole('button',{name:'返回阅读',exact:true}).click();await observed(api,options,'leave unchanged README in reading mode');
  return {scenario:'readme',highlightedDiff:true,explicitCommitStep:true,originalRestored:true,committed:false};
}

/**
 * Requires options.filePath: absolute path to the committed two-row synthetic
 * fixture (or equivalent inert JSONL). Performs real browser upload and download.
 * The caller verifies the returned local ZIP path, never a page fetch/API shortcut.
 */
export async function transferScenario(api,options={}){
  ensure(typeof options.filePath==='string'&&options.filePath.length>0,'transfer needs an absolute synthetic fixture path');
  await api.goto(url(options,project+'/table?branch=main'));await api.waitVisible(sequence(api,'qa-1'));await closeDetails(api,options);await observed(api,options,'load table before synthetic upload');
  const beforeText=await api.locator('.dw-header .dw-count').innerText(),before=Number(beforeText.replace(/\D/g,''));ensure(Number.isSafeInteger(before)&&before>=12,'synthetic fixture row total readable');
  await api.getByRole('button',{name:'导入样本',exact:true}).click();await observed(api,options,'open import steps');const dialog=api.getByRole('dialog',{name:'导入样本',exact:true});
  const choosing=capturedEvent(api.waitForEvent('filechooser'));await dialog.getByLabel('选择样本导入文件',{exact:true}).click();const chooser=eventValue(await choosing);await chooser.setFiles(options.filePath);await observed(api,options,'upload inert JSONL through browser file chooser');
  const preview=dialog.getByRole('button',{name:'预览并校验目标数据集',exact:true});await api.waitVisible(preview);await preview.click();await api.waitVisible(dialog.getByRole('heading',{name:/追加导入.*2条/}));await observed(api,options,'preview two-row append on pinned branch');
  await dialog.getByLabel('提交说明',{exact:true}).fill('Browser synthetic JSONL append acceptance');await observed(api,options,'set import commit explanation');await dialog.getByRole('checkbox',{name:/确认在此分支生成一次导入提交/}).check();await observed(api,options,'explicitly confirm one import commit');
  await dialog.getByRole('button',{name:'确认导入并提交',exact:true}).click();await api.waitHidden(dialog);await api.waitVisible(sequence(api,'r10-browser-import-one'));await observed(api,options,'committed append appears as a real row');
  const afterText=await api.locator('.dw-header .dw-count').innerText(),after=Number(afterText.replace(/\D/g,''));ensure(after===before+2,'two rows added to complete dataset');
  await api.getByRole('link',{name:'Releases',exact:true}).click();await api.waitVisible(api.getByRole('button',{name:'导出工作快照',exact:true}));await observed(api,options,'open version delivery page');await api.getByRole('button',{name:'导出工作快照',exact:true}).click();
  const snapshot=api.getByRole('dialog',{name:'导出完整工作快照',exact:true});await api.waitVisible(snapshot);await snapshot.getByRole('checkbox',{name:'我已核对整份数据集的内容、导出字段与接收对象。',exact:true}).check();await observed(api,options,'confirm complete committed dataset snapshot scope');await snapshot.getByRole('button',{name:'生成工作快照',exact:true}).click();await api.waitHidden(snapshot);await observed(api,options,'queue fixed-commit working snapshot');
  const archive=api.locator('.release-assets a[download]').filter({hasText:/\.zip\b/i});await api.waitVisible(archive,60000);await observed(api,options,'snapshot has a real downloadable ZIP asset');
  const downloading=capturedEvent(api.waitForEvent('download',60000));await archive.click();await observed(api,options,'request snapshot download through browser');const download=eventValue(await downloading),downloadPath=await download.path();ensure(typeof downloadPath==='string'&&downloadPath.length>0,'browser download completed to a local file');
  return {scenario:'transfer',uploadedRows:2,totalRows:after,browserFileChooser:true,browserDownload:true,downloadPath};
}
