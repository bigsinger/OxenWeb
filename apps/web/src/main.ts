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
  {path:'/fields',name:'fields',component:()=>import('./views/FieldManagementView.vue'),beforeEnter:async()=>{try{const access=await request<{canManage:boolean}>('/global-fields/access');return access.canManage?true:{path:'/',query:{notice:'field-management-denied'}};}catch{return {path:'/',query:{notice:'field-management-denied'}};}}},
  {path:'/access',name:'access',component:()=>import('./views/AccessManagementView.vue'),beforeEnter:async()=>{try{return(await request<{canManageAccess:boolean}>('/access-management/capabilities')).canManageAccess?true:{path:'/',query:{notice:'access-management-denied'}};}catch{return{path:'/',query:{notice:'access-management-denied'}};}}},
  {path:'/account/tokens',name:'my-tokens',component:()=>import('./views/AccessManagementView.vue'),props:{ownOnly:true}},
  {path:'/activity',name:'activity',component:()=>import('./views/AuditLogView.vue'),beforeEnter:async()=>{try{return(await request<{canReadAudit:boolean}>('/access-management/capabilities')).canReadAudit?true:{path:'/',query:{notice:'audit-denied'}};}catch{return{path:'/',query:{notice:'audit-denied'}};}}},
  {path:'/operations',name:'operations',component:()=>import('./views/OperationsView.vue')},
  {path:'/repos/:namespace/:repo/:tab?', component:()=>import('./views/RepositoryView.vue')},
]});
createApp(App).use(createPinia()).use(router).use(VueQueryPlugin).mount('#app');
