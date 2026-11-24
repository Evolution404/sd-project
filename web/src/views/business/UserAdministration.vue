<template>
  <CrudPage
    ref="crudRef"
    :search-config="searchConfig"
    :table-config="tableConfig"
    :form-config="formConfig"
    :load-form-data="loadForm"
  >
    <template #table-cell-created_at="{row}">{{ formatBeijingDateTime(row.created_at) }}</template>
    <template #table-cell-status="{ row }">
      <el-tag :type="row.status === 'active' ? 'success' : 'info'">
        {{ row.status === "active" ? "启用" : "禁用" }}
      </el-tag>
    </template>
    <template #table-cell-primary_org_id="{ row }">
      {{ row.primary_org_id ? organizationNames[row.primary_org_id] || row.primary_org_id : "未分配" }}
    </template>
    <template #table-cell-role_codes="{ row }">
      <el-tag v-for="code in row.role_codes" :key="code" class="mr-1" effect="plain">
        {{ roleNames[code] || code }}
      </el-tag>
    </template>
  </CrudPage>
</template>

<script setup lang="ts">
import { formatBeijingDateTime } from "@/utils/business/datetime";
import { nativeListQuery, nativeColumnFilter } from "@/utils/business/native-list-query";
import { onMounted, ref, reactive } from "vue";
import CrudPage from "@/components/Crud/CrudPage.vue";
import type {
  CrudSearchConfig, CrudTableConfig, CrudFormConfig, CrudRecord
} from "@/components/Crud/types";
import type { OptionItem } from "@/api/common";
import RoleAPI from "@/api/system/role";
import {
  listUsers, loadUser, saveUser, disableUser,
  type UserFormData, type UserRow,
} from "@/api/business/users";

defineOptions({name:"UserAdministration"});
const roles=ref<OptionItem[]>([]);
const organizations=ref<OptionItem[]>([]);
const roleNames=reactive<Record<string,string>>({});
const organizationNames=reactive<Record<string,string>>({});
const searchConfig:CrudSearchConfig={
  fields:[
    {type:"input",prop:"keywords",label:"用户",attrs:{clearable:true,placeholder:"用户名/姓名/工号"}},
    {type:"select",prop:"status",label:"状态",attrs:{clearable:true},
      options:[{value:"active",label:"启用"},{value:"disabled",label:"禁用"}]},
  ],
};
const tableConfig:CrudTableConfig={
  stateKey:"users",
  table:{border:true},
  rowKey:"id",
  fetchData:async(query)=>{
    const params=query as {pageNum?:number;pageSize?:number;keywords?:string;status?:string};
    const data=await listUsers(params.pageNum||1,params.pageSize||20,params.keywords||"",{status:params.status,...nativeListQuery(query, ["status"])});
    return {list:data.items,total:data.total};
  },
  toolbarActions:[{key:"create",label:"新增用户",permission:"user.manage"}],
  tableTools:["refresh","columns","search"],
  columns:[
    {prop:"username",sortable:"custom",label:"登录账号",minWidth:160},
    {prop:"display_name",sortable:"custom",label:"姓名",minWidth:130},
    {prop:"employee_no",sortable:"custom",label:"工号",minWidth:125},
    {prop:"primary_org_id",label:"所属组织",cellType:"custom",minWidth:170},
    {prop:"role_codes",label:"角色",cellType:"custom",minWidth:210},
    {prop:"status",sortable:"custom",...nativeColumnFilter("status",[{text:"启用",value:"active"},{text:"禁用",value:"disabled"}]),label:"状态",cellType:"custom",width:105},
    {prop:"created_at",sortable:"custom",label:"创建时间",cellType:"custom",minWidth:175},
    {prop:"actions",label:"操作",cellType:"actions",width:210,fixed:"right",actions:[
      {key:"view",label:"查看",permission:"user.manage"},
      {key:"edit",label:"编辑",permission:"user.manage"},
      {key:"delete",label:"禁用",permission:"user.manage",
        disabled:({row})=>row?.status==="disabled"},
    ]},
  ],
  deleteByIds:async ids=>{
    const id=ids.split(",")[0];
    await disableUser(id);
  },
};
const formConfig:CrudFormConfig<UserFormData>={
  title:({mode})=>({create:"新增用户",edit:"编辑用户",view:"用户详情"})[mode],
  rowKey:"id",dialog:{width:660},
  fields:[
    {type:"input-number",prop:"version",label:"用户版本号",hidden:true},
    {type:"input",prop:"username",label:"登录账号",required:true,
      readonly:({mode})=>mode==="view",attrs:{maxlength:128}},
    {type:"input",prop:"display_name",label:"姓名",required:true},
    {type:"input",prop:"employee_no",label:"工号"},
    {type:"select",prop:"organization_ids",label:"关联组织",options:organizations,
      initialValue:[],attrs:{multiple:true,filterable:true,clearable:true}},
    {type:"select",prop:"primary_org_id",label:"主要组织",options:organizations,
      initialValue:null,attrs:{filterable:true,clearable:true}},
    {type:"input",prop:"password",label:"密码",attrs:{type:"password",showPassword:true},
      required:({mode})=>mode==="create",
      tips:"新增时必填，修改时留空表示保持原密码"},
    {type:"select",prop:"role_codes",label:"角色",required:true,
      options:roles,initialValue:["viewer"],attrs:{multiple:true,collapseTags:false},
      rules:[{type:"array",min:1,required:true,message:"请选择至少一个角色",trigger:"change"}]},
    {type:"radio",prop:"status",label:"状态",initialValue:"active",
      options:[{label:"启用",value:"active"},{label:"禁用",value:"disabled"}]},
  ],
  async submitForm(form,{mode,id}){
    if(mode==="view")return;
    if(mode==="create" && !form.password)throw Error("请设置密码");
    if(form.primary_org_id && !form.organization_ids?.includes(form.primary_org_id)){
      form.organization_ids=[...(form.organization_ids||[]),form.primary_org_id];
    }
    await saveUser(form,id===undefined?undefined:String(id));
  }
};
async function loadForm(row:CrudRecord):Promise<CrudRecord>{
  const user=await loadUser(String(row.id));
  return {id:user.id,username:user.username,display_name:user.display_name,
    employee_no:user.employee_no,role_codes:user.role_codes,status:user.status,
    primary_org_id:user.primary_org_id,organization_ids:user.organization_ids,
    password:"",version:user.version};
}
onMounted(async()=>{
  try{
    const options=await RoleAPI.getOptions();
    roles.value=options;
    for(const item of options)roleNames[String(item.value)]=item.label;
    const resp=await fetch("/api/organizations",{credentials:"same-origin"});
    if(!resp.ok)throw Error("组织目录读取失败");
    const org=await resp.json() as Array<{id:string;name:string;status:string;deleted?:boolean}>;
    organizations.value=org.filter(node=>node.status==="active"&&!node.deleted)
      .map(node=>({value:node.id,label:node.name}));
    for(const option of organizations.value)organizationNames[String(option.value)]=option.label;
  }catch(e){ElMessage.error((e as Error).message)}
});
</script>
