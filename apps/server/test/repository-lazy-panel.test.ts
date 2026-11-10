import test from 'node:test';
import assert from 'node:assert/strict';
import {createRenderer,defineComponent,h,nextTick,ref} from 'vue';
import {lazyRepositoryPanel} from '../../web/src/lazy-repository-panel.js';

interface Node {type:string;text:string;props:Record<string,any>;children:Node[];parent:Node|null}
const node=(type:string,text=''):Node=>({type,text,props:{},children:[],parent:null});
function host(){
  const renderer=createRenderer<Node,Node>({
    createElement:type=>node(type),createText:text=>node('#text',text),createComment:text=>node('#comment',text),
    setText:(n,text)=>{n.text=text;},setElementText:(n,text)=>{n.text=text;n.children=[];},
    parentNode:n=>n.parent,nextSibling:n=>n.parent?.children[n.parent.children.indexOf(n)+1]??null,
    patchProp:(n,key,_old,value)=>{n.props[key]=value;},
    insert:(n,parent,anchor)=>{if(n.parent){const index=n.parent.children.indexOf(n);if(index>=0)n.parent.children.splice(index,1);}n.parent=parent;const index=anchor?parent.children.indexOf(anchor):-1;if(index<0)parent.children.push(n);else parent.children.splice(index,0,n);},
    remove:n=>{if(n.parent){const index=n.parent.children.indexOf(n);if(index>=0)n.parent.children.splice(index,1);n.parent=null;}},
  });
  return {renderer,root:node('root')};
}
const find=(root:Node,predicate:(n:Node)=>boolean):Node|undefined=>predicate(root)?root:root.children.map(child=>find(child,predicate)).find(Boolean);
const text=(root:Node):string=>root.text+root.children.map(text).join('');
const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));await nextTick();};

test('repository panels load only when rendered, without a fast-load flash, and preserve workbench refresh/ref and events',async()=>{
  let calls=0,resolve!:(value:any)=>void,refreshed=0,changed=0;const pending=new Promise<any>(done=>{resolve=done;});
  const Child=defineComponent({props:{branch:String},emits:['saved'],setup(props,{slots,emit,expose}){expose({refresh:()=>++refreshed});return()=>h('button',{onClick:()=>emit('saved')},[props.branch,slots.default?.()]);}});
  const Lazy=lazyRepositoryPanel('数据编辑',()=>{calls++;return pending;});assert.equal(calls,0);
  const {renderer,root}=host(),panel=ref<any>(),app=renderer.createApp({setup:()=>()=>h(Lazy,{branch:'synthetic-main',ref:panel,onSaved:()=>changed++},{default:()=>h('span','synthetic context')})});
  app.mount(root);assert.equal(calls,1);assert.equal(find(root,n=>n.props.role==='status'),undefined);
  resolve(Child);await settle();assert.equal(text(root),'synthetic-mainsynthetic context');assert.equal(find(root,n=>n.props.role==='status'),undefined);
  assert.equal(panel.value.refresh(),1);assert.equal(refreshed,1);find(root,n=>n.type==='button')!.props.onClick();assert.equal(changed,1);assert.equal(calls,1);app.unmount();
});

test('a slow or failed panel keeps navigation-independent feedback and only explicitly reloads code, never auto-retrying a write',async()=>{
  let calls=0,reloads=0,reject!:(cause:Error)=>void;const pending=new Promise<any>((_resolve,fail)=>{reject=fail;});
  const Lazy=lazyRepositoryPanel('发布',()=>{calls++;return pending;},()=>{reloads++;});
  const {renderer,root}=host(),app=renderer.createApp({render:()=>h('main',[h('nav','项目导航仍可用'),h(Lazy)])});app.config.errorHandler=()=>{};
  app.mount(root);await new Promise(resolve=>setTimeout(resolve,230));await nextTick();assert.ok(find(root,n=>n.props.role==='status'));assert.ok(text(root).includes('正在载入发布'));
  reject(new Error('Synthetic loader diagnostic must not be shown'));await settle();assert.ok(find(root,n=>n.props.role==='alert'));assert.ok(text(root).includes('项目导航仍可用'));assert.ok(!text(root).includes('diagnostic'));assert.equal(calls,1);assert.equal(reloads,0);
  find(root,n=>n.type==='button')!.props.onClick();assert.equal(reloads,1);assert.equal(calls,1);app.unmount();
});
