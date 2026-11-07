import ExcelJS from 'exceljs';
import {createHash} from 'node:crypto';
import {demandCatalog,previewDemandBatch,DEMAND_BATCH_LIMIT} from '../../application/demand-batches.mjs';
import {quantityToScaled} from '../../domain/quantity.mjs';
import {operationDefinition} from '../../domain/operation-definition.mjs';

const fail=(message,status=422)=>{throw Object.assign(new Error(message),{status})};
export const DEMAND_COLUMNS=[
 ['row_key','明细编号',18,true],['line_name','线路名称',26,true],['voltage_name','电压等级',15,false],
 ['location_kind','作业位置',16,false],['tower_no','杆塔／档距起点编号',25,true],['end_tower_no','档距终点编号',22,false],
 ['work_target_type','作业对象',20,false],['operation_name','操作类型',25,true],['target_object','处理部位／对象',28,true],
 ['quantity','工作量',16,true],['unit_name','单位',13,false],['problem_description','问题描述／实施必要性',45,true],
 ['completion_standard','完成标准',40,true],['source_refs','来源编号',23,true],['priority_name','优先级',15,false],['expected_on','期望完成日期',19,false]
];
export const SOURCE_COLUMNS=[['source_key','来源编号',18,true],['type_name','来源类型',22,true],['discovered_on','发现／提出日期',22,true],['proposed_by','提出单位／人员',28,true],['external_ref','依据编号',25,false],['description','来源说明',45,false]];
const title=v=>String(v??'').replace(/\s*[*＊]\s*$/,'').replaceAll('/','／').trim();
const aliases={位置类型:'location_kind',线名:'line_name',线路:'line_name',杆塔号:'tower_no',杆塔编号:'tower_no',起点杆塔:'tower_no',终点杆塔:'end_tower_no',数量:'quantity',计量单位:'unit_name',问题说明:'problem_description',问题描述:'problem_description',处理部位:'target_object',发现日期:'discovered_on',提出日期:'discovered_on',提出人:'proposed_by'};
const digest=b=>createHash('sha256').update(b).digest('hex');
const fieldsFor=(catalog,ids)=>catalog.items.filter(i=>i.type_id==='operation'&&(!ids?.length||ids.includes(i.id))).flatMap(op=>JSON.parse(op.fields_json).map(field=>({op,field,key:'custom:'+op.id+':'+field.key,header:'扩展：'+op.name+'／'+field.label})));
function style(sheet,columns){
 sheet.columns=columns.map(([key,header,width,required])=>({key,header:header+(required?' *':''),width,style:{numFmt:'@',alignment:{vertical:'top',wrapText:true}}}));
 sheet.views=[{state:'frozen',xSplit:2,ySplit:1}];sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:columns.length}};
 const head=sheet.getRow(1);head.height=34;head.eachCell((cell,i)=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEDF4FF'}};cell.font={bold:true,color:{argb:columns[i-1]?.[3]?'FFB4403A':'FF304561'}};cell.alignment={vertical:'middle',wrapText:true};cell.note=(columns[i-1]?.[3]?'提交核实时必填。':'按需填写。')+'编号按原文填写；不要合并单元格。'});
}
function baseWorkbook(){const w=new ExcelJS.Workbook();w.creator='输电项目管理系统';w.created=new Date();return w}
function instructions(w){
 const s=w.addWorksheet('填写说明');s.columns=[{width:25},{width:110}];
 const lines=[['需求 Excel 导入','每批最多5000条需求；上传和预检不创建正式需求，正式提交后为待核实。'],
  ['填写顺序','先填“来源依据”，再填“需求明细”。一行需求对应一个位置、一种作业和本行工作量。'],
  ['共同来源','来源编号只在本文件内唯一，例如 LY001。多条需求可以引用同一编号；多个来源用半角分号分隔：LY001;LY002。'],
  ['编号与位置','杆塔编号保留完整原文及前导零；不要填写编号区间。档距填写两个端点，必须是系统已有档距，不自动连档。'],
  ['操作定义','先选择操作类型。作业位置、作业对象和单位由操作定义；可留空由系统带出，填写时必须在允许范围内。填写档距两个端点时按档距检查。详见“操作定义”表。'],
  ['数量与单位','工作量为本行数量，正数、最多四位小数。数量列填2，不要填写2套。单位由操作类型确定。'],
  ['日期','填写真实日期 YYYY-MM-DD。提出单位／人员是实际提出者。'],
  ['扩展字段','仅填写本行操作适用的扩展字段。系统在导入时检查必填、类型及选项。'],
  ['下拉与预填','下拉和蓝色表头帮助填写，粘贴仍可能绕过限制；系统预检和提交会重新校验。预填默认值需逐条核对。'],
  ['错误修正','可以在线编辑、批量补空或下载问题文件。当前草稿中重传按明细编号核对更新，不自动删除缺失行。'],
  ['提交范围','问题文件的“纳入提交”填否表示排除，原始内容保留；改为是可重新纳入。'],
  ['公式','导入不执行公式；有公式的业务单元格请复制并粘贴为值后再上传。'],
  ['附件','照片、缺陷单在需求或来源附件入口上传。Excel中的本地路径不代表已上传。'],
  ['示例（不要复制为实际事实）','MX001：甲线，杆塔，#001，线路侧设备，安装防鸟装置，横担上部，2，套，现场存在鸟害风险，安装并验收合格，LY001。']];
 for(const row of lines)s.addRow(row);s.getColumn(2).alignment={wrapText:true,vertical:'top'};for(let i=1;i<=lines.length;i++)s.getRow(i).height=i===1?38:44;s.getRow(1).font={bold:true,color:{argb:'FF3478F6'},size:15};
}
function optionsSheet(w,catalog){
 const s=w.addWorksheet('可选项');
 const groups=[['线路名称',catalog.lines.map(x=>x.name),'DemandLines'],['操作类型',catalog.items.filter(x=>x.type_id==='operation').map(x=>x.name),'DemandOperations'],['单位',catalog.items.filter(x=>x.type_id==='unit').map(x=>x.name),'DemandUnits'],['来源类型',catalog.items.filter(x=>x.type_id==='source').map(x=>x.name),'DemandSources'],['优先级',catalog.items.filter(x=>x.type_id==='priority').map(x=>x.name),'DemandPriorities'],['位置类型',['杆塔','档距'],'DemandLocations'],['作业对象',['线路侧设备','共用物理杆塔'],'DemandTargets']];
 groups.forEach(([name,values,range],i)=>{const col=s.getColumn(i+1);col.width=28;col.values=[name,...new Set(values)];if(col.values.length>2)w.definedNames.add("'可选项'!$"+col.letter+'$2:$'+col.letter+'$'+(col.values.length-1),range)});
 s.getRow(1).font={bold:true,color:{argb:'FF3478F6'}};s.views=[{state:'frozen',ySplit:1}];
}
function listValidation(sheet,column,range){sheet.dataValidations.add(column+'2:'+column+'5001',{type:'list',allowBlank:true,formulae:[range],showErrorMessage:true,errorStyle:'stop',errorTitle:'请选择有效选项',error:'请使用下拉候选；最终以系统校验为准。'})}
function addValidations(w,detail,source,extras){
 for(const [col,range]of [['B','DemandLines'],['D','DemandLocations'],['G','DemandTargets'],['H','DemandOperations'],['K','DemandUnits'],['O','DemandPriorities']])if(w.definedNames.getRanges(range).ranges.length)listValidation(detail,col,range);
 if(w.definedNames.getRanges('DemandSources').ranges.length)listValidation(source,'B','DemandSources');
 detail.getColumn('J').numFmt='0.####';
 detail.dataValidations.add('J2:J5001',{type:'custom',allowBlank:true,formulae:['AND(ISNUMBER(J2),J2>0,J2<1000000000,ROUND(J2,4)=J2)'],showErrorMessage:true,errorStyle:'stop',error:'工作量为正数且最多四位小数'});
 detail.addConditionalFormatting({ref:'A2:P5001',rules:[{type:'expression',formulae:['AND(COUNTA($B2:$P2)>0,OR($B2="",$E2="",$H2="",$I2="",$J2="",$L2="",$M2="",$N2="",AND($D2="档距",$F2="")))'],style:{fill:{type:'pattern',pattern:'solid',bgColor:{argb:'FFFFEEEE'}}}}]});
 for(const [i,{field}]of extras.entries()){const col=detail.getColumn(17+i).letter;if(field.type==='select'&&field.options.join(',').length<=250)detail.dataValidations.add(col+'2:'+col+'5001',{type:'list',allowBlank:true,formulae:['"'+field.options.join(',').replaceAll('"','')+'"']});if(field.type==='boolean')detail.dataValidations.add(col+'2:'+col+'5001',{type:'list',allowBlank:true,formulae:['"是,否"']})}
}
export async function demandTemplate(options={}){
 if(options.quantity!==undefined&&options.quantity!=='')quantityToScaled(options.quantity);
 if(!options.include_positions&&(!Number.isInteger(Number(options.blank_rows??1))||Number(options.blank_rows??1)<1||Number(options.blank_rows??1)>DEMAND_BATCH_LIMIT))fail('空白明细行数必须为1至5000的整数');
 if(options.include_positions&&!options.line_ids?.length)fail('请先选择需要带入位置的线路');
 const catalog=demandCatalog(),w=baseWorkbook();instructions(w);
 const opIds=Array.isArray(options.operation_ids)?options.operation_ids:options.operation_id?[options.operation_id]:[];
 for(const id of opIds){const op=catalog.byItem.get(id);if(!op||op.type_id!=='operation')fail('模板操作类型不存在或不可用');operationDefinition(op,catalog.byItem.get(op.default_unit_id))}
 const extras=fieldsFor(catalog,opIds),detail=w.addWorksheet('需求明细'),source=w.addWorksheet('来源依据');
 if(extras.length+DEMAND_COLUMNS.length>200)fail('所选操作扩展字段超过200列，请缩小操作范围后分模板录入');
 style(detail,[...DEMAND_COLUMNS,...extras.map(f=>[f.key,f.header,25,false])]);style(source,SOURCE_COLUMNS);optionsSheet(w,catalog);addValidations(w,detail,source,extras);
 const op=opIds.length===1?catalog.byItem.get(opIds[0]):null,unit=catalog.byItem.get(options.unit_id||op?.default_unit_id);
 let definition;if(op){definition=operationDefinition(op,catalog.byItem.get(op.default_unit_id));if(options.unit_id&&options.unit_id!==definition.unit_id)fail('模板单位必须与操作类型定义一致');if(options.location_kind&&!definition.location_kinds.includes(options.location_kind))fail('模板作业位置必须属于操作定义允许的范围')}
 const locationKind=options.location_kind||definition?.default_location_kind;
 if(locationKind&&!['tower','span'].includes(locationKind))fail('模板作业位置无效');
 if(options.include_positions&&!locationKind)fail('带入位置时，请先选择操作类型及其允许的作业位置');
 if(locationKind)for(const id of opIds){const op=catalog.byItem.get(id);if(!operationDefinition(op,catalog.byItem.get(op.default_unit_id)).location_kinds.includes(locationKind))fail('所选操作没有共同的作业位置，请按操作范围分开生成位置模板')}
 const sourceRows=options.sources?.length?options.sources:[{source_key:'LY001'}];
 for(const [i,s]of sourceRows.entries())source.addRow({...s,source_key:s.source_key||'LY'+String(i+1).padStart(3,'0'),type_name:catalog.byItem.get(s.type_id)?.name||s.type_name||''});
 let locations=[];
 if(options.include_positions){
  const selectedLines=new Set(options.line_ids||[]);
  if(locationKind==='span')locations=catalog.spans.filter(s=>selectedLines.has(s.line_id)&&catalog.byTower.has(s.start_tower_id)&&catalog.byTower.has(s.end_tower_id)).map(s=>({span:s,tower:catalog.byTower.get(s.start_tower_id)}));
  else locations=catalog.towers.filter(t=>selectedLines.has(t.line_id)).map(t=>({tower:t}));
  if(locations.length>DEMAND_BATCH_LIMIT)fail('所选位置超过5000个，请缩小线路范围；不会截断位置');
 }
 const count=locations.length||Math.max(1,Math.min(DEMAND_BATCH_LIMIT,Number(options.blank_rows)||20));
 for(let i=0;i<count;i++){
  const position=locations[i],tower=position?.tower,line=catalog.byLine.get(tower?.line_id||options.line_ids?.[0]);
  const row={row_key:'MX'+String(i+1).padStart(4,'0'),line_name:line?.name||'',voltage_name:line?.voltage_name||'',location_kind:position?.span||locationKind==='span'?'档距':locationKind==='tower'?'杆塔':'',tower_no:tower?.tower_no||'',end_tower_no:position?.span?catalog.byTower.get(position.span.end_tower_id).tower_no:'',
   work_target_type:op?(op.work_target_type==='physical'?'共用物理杆塔':'线路侧设备'):'',operation_name:op?.name||'',target_object:options.target_object||definition?.default_target_object||'',quantity:options.quantity?Number(options.quantity):op?.default_quantity_scaled?op.default_quantity_scaled/10000:'',unit_name:unit?.name||'',completion_standard:options.completion_standard||op?.completion_standard||'',problem_description:options.problem_description||'',source_refs:sourceRows.map((s,i)=>s.source_key||'LY'+String(i+1).padStart(3,'0')).join(';')};
  if(op)for(const f of extras)if(f.op.id===op.id&&f.field.default!==undefined)row[f.key]=typeof f.field.default==='boolean'?(f.field.default?'是':'否'):f.field.default;
  detail.addRow(row);
 }
 const definitions=w.addWorksheet('操作定义');style(definitions,[['name','操作类型',28],['unit','计量单位',14],['target','作业对象',22],['locations','允许作业位置',22],['default_location','默认作业位置',20],['part','默认处理部位',28],['quantity','建议每项数量',18],['standard','完成标准模板',45],['hint','录入提示',55]]);
 for(const op of catalog.items.filter(i=>i.type_id==='operation'&&(!opIds.length||opIds.includes(i.id)))){let d;try{d=operationDefinition(op,catalog.byItem.get(op.default_unit_id))}catch{continue}definitions.addRow({name:op.name,unit:d.unit.name,target:d.work_target_type==='physical'?'共用物理杆塔':'线路侧设备',locations:d.location_kinds.map(k=>k==='tower'?'杆塔':'档距').join('／'),default_location:d.default_location_kind==='tower'?'杆塔':'档距',part:d.default_target_object,quantity:op.default_quantity_scaled==null?'':op.default_quantity_scaled/10000,standard:op.completion_standard||'',hint:d.entry_hint});definitions.getCell('J'+definitions.rowCount).value=d.location_kinds.length===2?'DemandLocations':d.location_kinds[0]==='span'?'DemandSpanLocations':'DemandTowerLocations'}
 if(definitions.rowCount>1){
  definitions.getColumn('J').hidden=true;
  w.definedNames.add("'操作定义'!$A$2:$J$"+definitions.rowCount,'DemandOperationProfiles');
  w.definedNames.add("'可选项'!$F$2",'DemandTowerLocations');w.definedNames.add("'可选项'!$F$3",'DemandSpanLocations');
  listValidation(detail,'D','INDIRECT(IFERROR(VLOOKUP($H2,DemandOperationProfiles,10,FALSE),"DemandLocations"))');
  for(const [column,index]of [['G',3],['K',2]])detail.dataValidations.add(column+'2:'+column+'5001',{type:'custom',allowBlank:true,formulae:['OR('+column+'2="",'+column+'2=IFERROR(VLOOKUP($H2,DemandOperationProfiles,'+index+',FALSE),""))'],showErrorMessage:true,errorStyle:'stop',error:'请按本行操作定义填写；可留空由系统自动确定。'});
 }
 const towers=w.addWorksheet('杆塔参考');style(towers,[['line_name','线路名称',28],['voltage_name','电压等级',16],['tower_no','杆塔编号',40]]);
 for(const tower of catalog.towers.filter(t=>(options.line_ids||[]).includes(t.line_id)))towers.addRow({line_name:tower.line_name,voltage_name:catalog.byLine.get(tower.line_id)?.voltage_name,tower_no:tower.tower_no});
 const meta=w.addWorksheet('_模板信息',{state:'veryHidden'});meta.addRow(['format','demand-entry-v1']);meta.addRow(['generated_at',new Date().toISOString()]);
 for(const operation of catalog.items.filter(i=>i.type_id==='operation'&&(!opIds.length||opIds.includes(i.id))))meta.addRow(['operation',operation.id,operation.version,operation.default_unit_id,operation.work_target_type]);
 for(const f of extras)meta.addRow(['field',f.header,f.op.id,f.field.key,f.op.version,JSON.stringify(f.field)]);
 return Buffer.from(await w.xlsx.writeBuffer());
}

function cellValue(cell,errors,field){
 const v=cell.value;if(v==null)return '';
 if(v instanceof Date)return v.toISOString().slice(0,10);
 if(typeof v==='object'){
  if('formula'in v||'sharedFormula'in v){errors.push({field,message:'公式单元格请粘贴为值后再导入'});return cell.text||''}
  if(v.richText)return v.richText.map(x=>x.text).join('').trim();
  if(v.error){errors.push({field,message:'Excel 单元格错误：'+v.error});return String(v.error)}
  if(v.hyperlink)return String(v.text||v.hyperlink).trim();
 }
 return String(v).trim();
}
export async function readDemandWorkbook(buffer){
 let w;try{w=new ExcelJS.Workbook();await w.xlsx.load(buffer)}catch{fail('无法读取 .xlsx 文件，请确认文件格式和内容')}
 if(w.worksheets.length>30)fail('工作表过多，请仅保留需要导入的工作表');
 return w;
}
export async function inspectWorkbookLayout(buffer,options={}){
 const w=await readDemandWorkbook(buffer);
 const header=Number(options.header_row)||1;if(!Number.isInteger(header)||header<1||header>1000)fail('标题行必须为1至1000的整数');
 return {sheets:w.worksheets.filter(s=>s.state!=='veryHidden').map(s=>({name:s.name,rows:s.actualRowCount,headers:Array.from({length:Math.min(s.columnCount,200)},(_,i)=>({column:i+1,title:s.getRow(header).getCell(i+1).text}))})),fields:DEMAND_COLUMNS.map(([key,label])=>({key,label})),source_fields:SOURCE_COLUMNS.map(([key,label])=>({key,label}))};
}
function columns(sheet,definitions,options={}){
 const row=sheet.getRow(Number(options.header_row)||1),out=new Map();
 row.eachCell((cell,n)=>{
  const header=title(cell.text);const explicit=options.mapping?.[n];const field=explicit||definitions.find(([,name])=>title(name)===header)?.[0]||aliases[header];
  if(explicit&&!definitions.some(([key])=>key===explicit))fail('列映射包含未知字段：'+explicit);
  if(field){if([...out.values()].includes(field))fail('存在重复映射列：'+header);out.set(n,field)}
 });return out;
}
export async function parseDemandWorkbook(buffer,options={}){
 const w=await readDemandWorkbook(buffer),sheet=w.getWorksheet(options.sheet||'需求明细')||(!options.sheet?w.worksheets.find(s=>!['填写说明','来源依据','可选项','杆塔参考','_模板信息'].includes(s.name)):null);
 if(!sheet)fail('未找到需求明细工作表，请选择要导入的工作表');
 if(sheet.columnCount>200)fail('需求明细最多200列');
 const catalog=demandCatalog(),extra=fieldsFor(catalog),cols=columns(sheet,DEMAND_COLUMNS,options);
 const metadata=w.getWorksheet('_模板信息'),templateVersions=new Map();
 metadata?.eachRow(r=>{if(r.getCell(1).value==='field')templateVersions.set(String(r.getCell(3).value),Number(r.getCell(5).value));if(r.getCell(1).value==='operation')templateVersions.set(String(r.getCell(2).value),Number(r.getCell(3).value))});
 // Metadata is a hint only: always resolve field keys against current server definitions.
 const headerRow=Number(options.header_row)||1;
 if(!Number.isInteger(headerRow)||headerRow<1||headerRow>1000)fail('标题行必须为1至1000的整数');
 sheet.getRow(headerRow).eachCell((cell,n)=>{const label=title(cell.text),f=extra.find(f=>title(f.header)===label);if(f)cols.set(n,f.key)});
 const sourceSheet=w.getWorksheet('来源依据'),sources=[];
 if(sourceSheet){
  const sc=columns(sourceSheet,SOURCE_COLUMNS);if(sourceSheet.actualRowCount>DEMAND_BATCH_LIMIT+1)fail('来源依据超过5000条');
  sourceSheet.eachRow((r,n)=>{if(n<=1)return;const s={sheet:'来源依据',sheet_row:n,parse_errors:[]};for(const [c,k]of sc)s[k]=cellValue(r.getCell(c),s.parse_errors,SOURCE_COLUMNS.find(x=>x[0]===k)?.[1]||k);
   if(Object.entries(s).some(([k,v])=>!['sheet','sheet_row','parse_errors'].includes(k)&&v!==''))sources.push(s);
  });
 }
 if(!sources.length&&options.sources?.length)sources.push(...options.sources);
 const rows=[];
 sheet.eachRow((r,n)=>{
  if(n<=headerRow)return;
  const data={parse_errors:[],custom_fields:{},sheet:sheet.name,sheet_row:n,raw_cells:{}};
  r.eachCell((cell,c)=>{const label=sheet.getRow(headerRow).getCell(c).text||'列'+c;data.raw_cells[label]=cellValue(cell,[],label)});
  for(const [c,k]of cols){const label=sheet.getRow(headerRow).getCell(c).text;const cell=r.getCell(c);if(cell.isMerged)data.parse_errors.push({field:label,message:'数据区域不支持合并单元格，请取消合并并逐行补齐'});const value=cellValue(cell,data.parse_errors,label);data[k]=value}
  // Ignore untouched template placeholders, never silently skip a populated business row.
  const business=[...cols.values()].filter(k=>k!=='row_key');
  if(!business.some(k=>data[k]!==''&&data[k]!==undefined))return;
  if(rows.length>=DEMAND_BATCH_LIMIT)fail('需求明细超过5000条，请拆分文件；不会截断');
  data.row_key=data.row_key||'MX'+String(n-headerRow).padStart(4,'0');
  const shared=options.common||{},nameForId={operation_id:'operation_name',unit_id:'unit_name',priority_id:'priority_name',line_id:'line_name'};
  for(const [key,value]of Object.entries(shared)){
   // A filled Excel name is already a user choice even before its stable ID is
   // resolved. Common defaults must not replace that choice with another ID.
   if(nameForId[key]&&data[nameForId[key]])continue;
   if(data[key]===undefined||data[key]==='')data[key]=value;
  }
  if(data.location_kind==='杆塔')data.location_kind='tower';else if(data.location_kind==='档距')data.location_kind='span';
  if(data.work_target_type==='线路侧设备')data.work_target_type='line';else if(data.work_target_type==='共用物理杆塔')data.work_target_type='physical';
  data.source_keys=String(data.source_refs||'').split(/[;；]/).map(v=>v.trim()).filter(Boolean);
  const op=(!data.operation_id?catalog.itemNames.get('operation|'+data.operation_name):[catalog.byItem.get(data.operation_id)])?.[0];
  if(op&&templateVersions.has(op.id)&&templateVersions.get(op.id)!==op.version)data.parse_errors.push({field:'操作模板',message:'下载后的操作模板版本已变化，请在线按当前字段重新核对，或重新下载模板'});
  for(const f of extra){const value=data[f.key];if(op?.id===f.op.id&&value!==undefined&&value!==''){
    data.custom_fields[f.field.key]=f.field.type==='number'?(Number.isFinite(Number(value))?Number(value):value):f.field.type==='boolean'?['是','true','TRUE','1'].includes(value)?true:['否','false','FALSE','0'].includes(value)?false:value:value;
   }delete data[f.key]}
  const excludedCell=[...r.worksheet.getRow(headerRow).values].findIndex(v=>title(v)==='纳入提交');
  data.excluded=excludedCell>0&&r.getCell(excludedCell).text==='否';
  rows.push(data);
 });
 if(!rows.length)fail('没有可导入的需求行；请填写需求明细');
 const body={rows,sources,import_file:{filename:options.filename||'需求.xlsx',sha256:digest(buffer),sheet:sheet.name},idempotency_key:options.idempotency_key};
 return {...body,...previewDemandBatch(body)};
}
export async function demandProblemWorkbook(body){
 const checked=previewDemandBatch(body),w=baseWorkbook();instructions(w);const catalog=demandCatalog(),extras=fieldsFor(catalog,[...new Set(checked.rows.map(r=>r.operation_id).filter(Boolean))]);
 const d=w.addWorksheet('需求明细'),s=w.addWorksheet('来源依据');
 style(d,[...DEMAND_COLUMNS,...extras.map(f=>[f.key,f.header,25]),['included','纳入提交',15],['sheet_row','原始行号',15],['errors','错误说明',60]]);style(s,[...SOURCE_COLUMNS,['errors','错误说明',60]]);
 for(const row of checked.rows){
  const record={...row,location_kind:row.location_kind==='span'?'档距':row.location_kind==='tower'?'杆塔':row.location_kind,work_target_type:row.work_target_type==='physical'?'共用物理杆塔':row.work_target_type==='line'?'线路侧设备':row.work_target_type,source_refs:row.source_keys.join(';'),included:row.excluded?'否':'是',errors:[...row.issues.map(i=>i.field+'：'+i.message),...(row.candidates.length?['疑似已有需求：'+row.candidates.map(c=>c.demand_no).join('、')]:[])].join('\n')};
  for(const f of extras)if(row.operation_id===f.op.id)record[f.key]=row.custom_fields?.[f.field.key];
  d.addRow(record);
 }
 for(const row of checked.sources)s.addRow({...row,errors:row.issues.map(i=>i.field+'：'+i.message).join('\n')});optionsSheet(w,catalog);
 return Buffer.from(await w.xlsx.writeBuffer());
}
export async function demandResultWorkbook(result){
 const w=baseWorkbook(),sheet=w.addWorksheet('提交结果');
 style(sheet,[['row_key','明细编号',28],['demand_no','系统需求编号',24],['action','处理结果',22],['batch_id','提交批次',40]]);
 for(const row of result.row_results||[])sheet.addRow({...row,action:row.action==='link'?'关联已有需求来源':'新建待核实需求',batch_id:result.batch_id});
 return Buffer.from(await w.xlsx.writeBuffer());
}
