// Real API fixture shared by financial business tests.
export async function financeFixture(api,tag){
 const vl=await api('/voltage-levels','POST',{code:tag+'110',name:'110kV'},201);
 const l=await api('/lines','POST',{line_code:tag+'-L',name:'检修试验线路',voltage_level_id:vl.id},201);
 const t=await api('/physical-towers','POST',{tower_code:tag+'-T'},201);
 const tower=await api('/logical-towers','POST',{logical_code:tag+'-LT',line_id:l.id,physical_tower_id:t.id,tower_no:'#1',sort_rank:1},201);
 const unit=await api('/dictionary-items','POST',{type_id:'unit',code:tag+'-UNIT',name:'套'},201);
 const op=await api('/dictionary-items','POST',{type_id:'operation',code:tag+'-OP',name:'更换防鸟装置',work_target_type:'line'},201);
 const src=await api('/dictionary-items','POST',{type_id:'source',code:tag+'-SRC',name:'巡视'},201);
 const cat=await api('/dictionary-items','POST',{type_id:'project_category',code:tag+'-CAT',name:'检修'},201);
 const batch=await api('/demand-batches/submit','POST',{
  idempotency_key:tag+'batch',work_target_type:'line',operation_id:op.id,unit_id:unit.id,
  target_object:'防鸟装置',quantity:'10',completion_standard:'验收合格',problem_description:'更换10套',
  source:{type_id:src.id,proposed_by:'检修班',discovered_on:'2026-10-29'},rows:[{logical_tower_id:tower.id}]
 },201);
 let d=await api('/demands/'+batch.ids[0]);
 d=await api('/demands/'+d.id+'/verify','POST',{version:d.version,status:'active',reason:'核实'});
 const fw=await api('/frameworks','POST',{code:tag+'-FW',name:'年度框架',fiscal_year:2026,limit_yuan:'2000'},201);
 const ag=await api('/agreements','POST',{code:tag+'-AG',name:'执行协议',framework_id:fw.id,limit_yuan:'1500'},201);
 let project=await api('/projects','POST',{code:tag+'-PROJ',name:'同一需求分两个检修计划',framework_id:fw.id},201);
 project=await api('/projects/'+project.id+'/scopes','POST',{version:project.version,demand_id:d.id,quantity:'10'},201);
 project=await api('/projects/'+project.id+'/preliminary-estimate','POST',{
  version:project.version,category_id:cat.id,amount_yuan:'1000',basis:'十套测算'},200);
 project=await api('/projects/'+project.id+'/stock','POST',{version:project.version,reason:'正式储备'});
 project=await api('/projects/'+project.id+'/agreement','POST',{version:project.version,agreement_id:ag.id});
 project=await api('/projects/'+project.id+'/scopes/'+project.scopes[0].id,'PATCH',{
  version:project.version,unit_price_yuan:'100',price_source:'核准价',price_date:'2026-10-30',tax_mode:'inclusive'});
 project=await api('/projects/'+project.id+'/approve','POST',{version:project.version,reason:'批准'});
 const scope=project.scopes[0];
 let a=await api('/projects/'+project.id+'/executions','POST',{number:tag+'A',plan_type:'outage'},201);
 let b=await api('/projects/'+project.id+'/executions','POST',{number:tag+'B',plan_type:'non_outage'},201);
 a=await api('/executions/'+a.id+'/items','POST',{version:a.version,scope_id:scope.id,quantity:'5'},201);
 b=await api('/executions/'+b.id+'/items','POST',{version:b.version,scope_id:scope.id,quantity:'5'},201);
 const ai=a.items[0].id,bi=b.items[0].id;
 return {project,scope,a,b,ai,bi,fw,ag,tag};
}
