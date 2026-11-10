/** Keep modal keyboard focus inside the dialog while preserving normal interior navigation. */
export function releaseDialogKey(event:KeyboardEvent){
  if(event.key!=='Tab'||!(event.currentTarget instanceof HTMLElement))return;
  const root=event.currentTarget,controls=[...root.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],summary,[tabindex="0"]')].filter(element=>element.getClientRects().length>0);
  const first=controls[0],last=controls.at(-1);if(!first)return;
  if(event.shiftKey&&(document.activeElement===first||!root.contains(document.activeElement))){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
}
