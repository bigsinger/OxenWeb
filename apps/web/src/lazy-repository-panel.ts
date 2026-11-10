import {defineAsyncComponent,defineComponent,h,type AsyncComponentLoader,type Component} from 'vue';
import {LoaderCircle} from 'lucide-vue-next';

/** Load only the active panel; failure recovery never automatically replays a dataset write. */
export function lazyRepositoryPanel<T extends Component>(name:string,loader:AsyncComponentLoader<T>,reload:()=>void=()=>window.location.reload()):T{
  const Loading=defineComponent({
    name:'RepositoryPanelLoading',
    setup:()=>()=>h('section',{class:'repository-panel-loading',role:'status'},[h(LoaderCircle,{class:'spin','aria-hidden':'true'}),h('p','正在载入'+name+'…')]),
  });
  const Failed=defineComponent({name:'RepositoryPanelLoadFailed',setup:()=>()=>h('section',{class:'repository-panel-loading',role:'alert'},[
    h('p',name+'暂未载入。请检查连接后刷新页面，也可以切换其他板块。'),
    // Browsers may cache failed ES module imports; a page reload is the reliable recovery boundary.
    h('button',{type:'button',class:'btn',onClick:reload},'刷新页面重试'),
  ])});
  return defineAsyncComponent<T>({
    loader,
    delay:200,
    loadingComponent:Loading,
    errorComponent:Failed,
  });
}
