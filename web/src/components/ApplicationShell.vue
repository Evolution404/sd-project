<script setup lang="ts">
import {computed,nextTick,ref,watch} from 'vue';
import {ElAside,ElAvatar,ElBreadcrumb,ElBreadcrumbItem,ElButton,ElConfigProvider,ElContainer,ElHeader,ElIcon,ElMain,ElMenu,ElMenuItem,ElSubMenu,type MenuInstance} from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import {Collection,Connection,Document,FolderOpened,HomeFilled,Lightning,List,Location,Setting,Tools} from '@element-plus/icons-vue';
import '../styles/element-plus';
import '../styles/dictionary.css';
import '../styles/application-shell.css';
type User=Record<string,any>;
const props=defineProps<{user:User;nav:string;section:string;title:string}>();
const emit=defineEmits<{navigate:[value:string];logout:[]}>();
const menu=ref<MenuInstance>();
const roleName=computed(()=>({admin:'系统管理员',editor:'业务编制',verifier:'需求核实',viewer:'只读用户'} as Record<string,string>)[props.user.role]||'业务用户');
const groupOf=(nav:string)=>['entry','demands'].includes(nav)?'demands-group':['lines','towers','spans'].includes(nav)?'masters':['frameworks','agreements'].includes(nav)?'frameworks-group':['dictionary','access','audit'].includes(nav)?'system':'';
watch(()=>props.nav,async value=>{await nextTick();const group=groupOf(value);if(group)menu.value?.open(group)},{immediate:true});
</script>
<template>
 <ElConfigProvider :locale="zhCn">
  <ElContainer class="application-shell dictionary-ui">
   <ElHeader class="application-header" height="64px">
    <div class="application-brand"><span class="application-brand-icon"><ElIcon><Lightning/></ElIcon></span><strong>输电项目管理系统</strong></div>
    <ElBreadcrumb class="application-breadcrumb" separator="/"><ElBreadcrumbItem>{{section}}</ElBreadcrumbItem><ElBreadcrumbItem>{{title}}</ElBreadcrumbItem></ElBreadcrumb>
    <div class="application-header-actions"><ElButton v-if="user.role==='admin'" text :icon="Setting" @click="emit('navigate','access')">系统设置</ElButton><span class="application-header-divider"/><ElAvatar :size="30">{{user.username.substring(0,1).toUpperCase()}}</ElAvatar><span class="application-user-name">{{user.username}}</span></div>
   </ElHeader>
   <ElContainer class="application-body">
    <ElAside class="sidebar application-sidebar" width="208px">
     <div class="application-navigation-heading">业务工作空间</div>
     <ElMenu ref="menu" :default-active="nav" :default-openeds="[groupOf(nav)].filter(Boolean)" unique-opened aria-label="主导航" @select="emit('navigate',$event)">
      <ElMenuItem index="overview" aria-label="工作台"><ElIcon><HomeFilled/></ElIcon><span>工作台</span></ElMenuItem>
      <ElSubMenu index="demands-group" aria-label="需求中心"><template #title><ElIcon><Document/></ElIcon><span>需求中心</span></template><ElMenuItem index="demands" aria-label="需求台账">需求台账</ElMenuItem><ElMenuItem index="entry" aria-label="新建需求">新建需求</ElMenuItem></ElSubMenu>
      <ElMenuItem index="projects" aria-label="项目中心"><ElIcon><FolderOpened/></ElIcon><span>项目中心</span></ElMenuItem>
      <ElMenuItem index="prices" aria-label="检修参考单价"><ElIcon><Tools/></ElIcon><span>检修参考单价</span></ElMenuItem>
      <ElSubMenu index="frameworks-group" aria-label="框架与协议"><template #title><ElIcon><Connection/></ElIcon><span>框架与协议</span></template><ElMenuItem index="frameworks" aria-label="项目框架">项目框架</ElMenuItem><ElMenuItem index="agreements" aria-label="执行协议">执行协议</ElMenuItem></ElSubMenu>
      <ElSubMenu v-if="user.role==='admin'" index="masters" aria-label="基础台账"><template #title><ElIcon><Location/></ElIcon><span>基础台账</span></template><ElMenuItem index="lines" aria-label="线路台账">线路台账</ElMenuItem><ElMenuItem index="towers" aria-label="杆塔查询">杆塔查询</ElMenuItem><ElMenuItem index="spans" aria-label="档距查询">档距查询</ElMenuItem></ElSubMenu>
      <ElSubMenu v-if="user.role==='admin'" index="system" aria-label="系统管理"><template #title><ElIcon><Setting/></ElIcon><span>系统管理</span></template><ElMenuItem index="dictionary" aria-label="数据字典"><ElIcon><Collection/></ElIcon>数据字典</ElMenuItem><ElMenuItem index="audit" aria-label="操作记录"><ElIcon><Document/></ElIcon>操作记录</ElMenuItem><ElMenuItem index="access" aria-label="IP访问管理"><ElIcon><List/></ElIcon>IP访问管理</ElMenuItem></ElSubMenu>
     </ElMenu>
     <footer class="application-sidebar-footer"><div><strong>{{user.username}}</strong><small>{{roleName}}</small></div><ElButton text size="small" @click="emit('logout')">退出</ElButton></footer>
    </ElAside>
    <ElMain class="application-scroll"><div class="main"><slot/></div></ElMain>
   </ElContainer>
  </ElContainer>
 </ElConfigProvider>
</template>
