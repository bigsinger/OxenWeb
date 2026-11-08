import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import './style.css';
import { request } from './api';
const router = createRouter({history: createWebHistory(),scrollBehavior:(to,from,saved)=>saved??(to.path!==from.path?{top:0}:undefined), routes: [
  {path:'/', component:()=>import('./views/RepositoriesView.vue')},
  {path:'/explore', name:'explore', component:()=>import('./views/RepositoriesView.vue')},
  {path:'/labels',name:'labels',component:()=>import('./views/LabelGovernanceView.vue'),beforeEnter:async()=>{try{const access=await request<{canManage:boolean}>('/governance/access');return access.canManage?true:{path:'/',query:{notice:'label-management-denied'}};}catch{return {path:'/',query:{notice:'label-management-denied'}};}}},
  {path:'/repos/:namespace/:repo/:tab?', component:()=>import('./views/RepositoryView.vue')},
]});
createApp(App).use(createPinia()).use(router).use(VueQueryPlugin).mount('#app');
