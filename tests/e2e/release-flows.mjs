/** UI-only release steps shared by remote Playwright and isolated CUA acceptance. */
export const releaseQaProjects={a:'ai-safety-ui-qa',b:'ai-safety-ui-qa-b',empty:'ai-safety-ui-qa-empty'};
export async function openReleaseList(api,repo=releaseQaProjects.a,options={}){
  await api.goto(new URL('/repos/local/'+repo+'/releases?branch=main',options.origin??'http://127.0.0.1:5173').href);
  await api.waitVisible(api.getByRole('button',{name:'创建 Release',exact:true}));
  await api.waitVisible(api.locator('.release-search'));
}
export async function openPublishedRelease(api){
  const current=api.locator('.release-list-item').filter({has:api.locator('.release-status.published')});
  await api.waitVisible(current);await current.click();
  await api.waitVisible(api.getByRole('button',{name:'管理下载链接',exact:true}));
}
export async function openReleaseForm(api,values={}){
  await api.getByRole('button',{name:'创建 Release',exact:true}).click();
  const form=api.getByRole('dialog',{name:'创建 Release',exact:true});await api.waitVisible(form);
  if(values.version!==undefined)await form.getByRole('textbox',{name:/^版本号/}).fill(values.version);
  if(values.title!==undefined)await form.getByRole('textbox',{name:'版本标题',exact:true}).fill(values.title);
  await api.waitVisible(form.locator('.release-preview-commit'));return form;
}
