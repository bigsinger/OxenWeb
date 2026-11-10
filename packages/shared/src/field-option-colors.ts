import type {DatasetFieldMetadata,DatasetFieldOption} from './field-metadata.js';
/** Shared vivid palette for the dark workbench. Colors are presentation, never label meanings. */
const palette=['#8CC8FF','#F6AF86','#99DCAB','#D2B0FF','#F0CA72','#81DDD7','#F2A9CF','#B8D77C','#AAB9FF','#EDB7A0','#91D0C0','#DEB6E7'];
export function fieldOptionKey(value:DatasetFieldOption):string{return JSON.stringify([typeof value,value]);}
export function validFieldOptionColor(value:unknown):value is string{return typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);}
export function nextFieldOptionColor(used:readonly string[]=[]):string{
  const chosen=new Set(used.map(color=>color.toUpperCase()));const base=palette.find(color=>!chosen.has(color));if(base)return base;
  // Keep later options distinct without cycling the initial palette.
  for(let index=0;index<1000;index++){
    const hue=(index*137.508+17)%360,s=.66,l=.73,c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((hue/60)%2-1)),m=l-c/2;
    const rgb=hue<60?[c,x,0]:hue<120?[x,c,0]:hue<180?[0,c,x]:hue<240?[0,x,c]:hue<300?[x,0,c]:[c,0,x];
    const color='#'+rgb.map(value=>Math.round((value+m)*255).toString(16).padStart(2,'0')).join('').toUpperCase();if(!chosen.has(color))return color;
  }
  return '#D2B0FF';
}
export function datasetFieldOptionColor(field:DatasetFieldMetadata|undefined,value:unknown):string|undefined{
  if(!field||!['string','number','boolean'].includes(typeof value))return;
  const options=field.enum??field.items?.enum;if(!options)return;
  const index=options.findIndex(option=>fieldOptionKey(option)===fieldOptionKey(value as DatasetFieldOption));if(index<0)return;
  const saved=field.optionColors?.[fieldOptionKey(value as DatasetFieldOption)];if(validFieldOptionColor(saved))return saved;
  const used:string[]=[];for(let position=0;position<=index;position++){const item=options[position]!,explicit=field.optionColors?.[fieldOptionKey(item)];used.push(validFieldOptionColor(explicit)?explicit:nextFieldOptionColor(used));}return used[index];
}
