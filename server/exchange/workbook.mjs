import ExcelJS from 'exceljs';
import { scaledDecimal,decimalText } from '../domain/decimal.mjs';
import { requireValue } from '../domain/errors.mjs';
export const MAX_BYTES=12*1024*1024,MAX_ROWS=25000,MAX_DOCUMENTS=5000;
export const KEEP='__KEEP__',CLEAR='__CLEAR__',DELETE='delete';
const externalScale={quantity_scaled:['quantity',4],resolved_quantity_scaled:['resolved_quantity',4],amount_fen:['amount',2],unit_price_fen:['unit_price',2]};
const internalScale=Object.fromEntries(Object.entries(externalScale).map(([key,[external,places]])=>[external,[key,places]]));
export const layouts={
 demands:[
  {name:'需求清单',key:'documents',columns:['demand_no','id','expected_version','operation_id','problem_description','target_object','completion_standard','priority_id','expected_on']},
  {name:'作业位置',key:'work_locations',columns:['demand_no','action','location_kind','logical_tower_id','physical_tower_id','span_id','quantity_scaled','work_mode','site_features_json']},
  {name:'预计物资',key:'materials',columns:['demand_no','action','material_id','quantity_scaled','note']},
  {name:'来源依据',key:'sources',columns:['demand_no','id','source_system','external_record_id','description','discovered_on']}
 ],
 settlements:[
  {name:'结算单',key:'documents',columns:['number','id','project_id','expected_version','expected_edit_version','approval_version_id','funding_version_id','settlement_on','basis','change_type']},
  {name:'费用明细',key:'items',columns:['number','action','cost_node_id','project_scope_id','quantity_scaled','amount_fen','unit_price_fen','evidence']},
  {name:'需求解决明细',key:'resolutions',columns:['number','action','project_scope_id','resolved_quantity_scaled','evidence']}
 ]
};
const labels={demand_no:'需求编号',number:'结算编号',id:'系统标识',expected_version:'原正式版本',expected_edit_version:'原草稿版本',operation_id:'操作标识',problem_description:'问题描述',target_object:'处理部位',completion_standard:'验收标准',priority_id:'优先级标识',expected_on:'期望日期',action:'明细动作',location_kind:'位置类型',logical_tower_id:'逻辑塔标识',physical_tower_id:'物理塔标识',span_id:'档距标识',quantity_scaled:'数量（万分之一单位）',work_mode:'作业方式',site_features_json:'现场特征JSON',material_id:'物资标识',note:'备注',source_system:'来源系统',external_record_id:'原始记录编号',description:'来源说明',discovered_on:'提出日期',project_id:'子项目标识',approval_version_id:'批准版本标识',funding_version_id:'资金版本标识',settlement_on:'结算日期',basis:'结算依据',change_type:'版本动作',cost_node_id:'费用科目标识',project_scope_id:'项目需求范围标识',amount_fen:'本次金额（分）',unit_price_fen:'单价（分）',evidence:'事实依据',resolved_quantity_scaled:'本次新增解决量（万分之一单位）'};
export function issue(sheet,row,field,value,reason,suggestion='修正后重新上传') {return {sheet,row,field,raw_value:value,reason,suggestion};}
function cellValue(cell){
 const value=cell.value;
 requireValue(!(value&&typeof value==='object'&&('formula'in value||'sharedFormula'in value)),'导入不接受公式，请粘贴为值');
 if(value instanceof Date)return value.toISOString().slice(0,10);
 requireValue(value===null||['string','number','boolean'].includes(typeof value),'不支持富文本、超链接或错误单元格');
 return value;
}
export async function parseWorkbook(buffer,kind){
 requireValue(buffer.length>0&&buffer.length<=MAX_BYTES,'Excel文件须在12MB以内');
 requireValue(buffer[0]===0x50&&buffer[1]===0x4b,'只接受.xlsx工作簿');
 let centralEntries=0,totalUncompressed=0;
 for(let position=0;position+46<=buffer.length;position++){
  if(buffer.readUInt32LE(position)!==0x02014b50)continue;
  centralEntries++;const size=buffer.readUInt32LE(position+24);totalUncompressed+=size;
  requireValue(size!==0xffffffff&&totalUncompressed<=80*1024*1024&&centralEntries<=2000,'Excel解压规模超出限制');
  position+=45+buffer.readUInt16LE(position+28)+buffer.readUInt16LE(position+30)+buffer.readUInt16LE(position+32);
 }
 requireValue(centralEntries>0,'Excel ZIP目录无效');
 const workbook=new ExcelJS.Workbook();
 try {await workbook.xlsx.load(buffer);}catch{requireValue(false,'Excel文件损坏或格式无效');}
 requireValue(!workbook.getWorksheet('报表标记'),'业务报表不能回导，请使用数据维护导出');
 const layout=layouts[kind];requireValue(layout,'未知交换类型');
 const rows={},issues=[];let count=0;
 for(const definition of layout){
  const sheet=workbook.getWorksheet(definition.name);rows[definition.key]=[];
  if(!sheet){requireValue(definition.key!=='documents',`缺少${definition.name}工作表`);continue;}
  requireValue(sheet.columnCount<=80,'工作表列数超出限制');
  const headers=new Map();sheet.getRow(1).eachCell((cell,column)=>{const header=String(cell.value||'').split('|').at(-1).trim();requireValue(definition.columns.includes(internalScale[header]?.[0]||header),`未知列 ${definition.name}.${header}`);requireValue(![...headers.values()].includes(header),`重复列 ${header}`);headers.set(column,header);});
  sheet.eachRow((row,rowNumber)=>{
   if(rowNumber===1)return;count++;requireValue(count<=MAX_ROWS,'工作簿业务行数超过25000');
   const data={_sheet:definition.name,_row:rowNumber};
   for(const [column,key] of headers){try {const value=cellValue(row.getCell(column));if(value!==KEEP&&value!==null){const mapping=internalScale[key];data[mapping?.[0]||key]=value===CLEAR?null:mapping?scaledDecimal(value,mapping[1],key):value;}}catch(error){issues.push(issue(definition.name,rowNumber,key,String(row.getCell(column).value),error.message));}}
   if(Object.keys(data).length>2)rows[definition.key].push(data);
  });
 }
 requireValue(rows.documents.length<=MAX_DOCUMENTS,'单批最多5000张业务单据');
 return {rows,issues};
}
export async function makeWorkbook(kind,rows={},options={}) {
 const workbook=new ExcelJS.Workbook();workbook.creator='输电项目管理';
 const info=workbook.addWorksheet('使用说明');info.columns=[{width:110}];
 for(const text of [options.report?'业务报表，仅供阅读，不可回导':'数据维护工作簿，可离线修改并回导','金额填写人民币元（最多2位小数），工作量填写实际单位数量（最多4位小数）。','系统标识及原版本用于并发校验，新增行留空。关联标识从“可选基础数据”精确选取。',`${KEEP} 保持原值，${CLEAR} 明确清除，空单元格/缺少列保持原值。文本空串请使用 __EMPTY__。`,'明细action填upsert或delete。未出现的工作表或明细行保持原值。','导入结算只保存草稿。正式提交和审核须在系统内分别操作。','请勿填写公式。系统不按线路名称、杆号或显示名称模糊匹配。'])info.addRow([text]);
 for(const definition of layouts[kind]){
  const sheet=workbook.addWorksheet(definition.name);sheet.columns=definition.columns.map(key=>({header:`${externalScale[key]?key==='amount_fen'?'本次金额（元）':key==='unit_price_fen'?'单价（元）':key==='resolved_quantity_scaled'?'本次新增解决数量':'工作数量':labels[key]||key}|${externalScale[key]?.[0]||key}`,key,width:['id','operation_id','project_id','approval_version_id'].includes(key)?40:26}));sheet.views=[{state:'frozen',ySplit:1}];
  sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF23434E'}};
  for(const data of rows[definition.key]||[]){const row={};for(const key of definition.columns){const value=data[key];row[key]=value==null?null:externalScale[key]?decimalText(value,externalScale[key][1]):typeof value==='object'?JSON.stringify(value):value;}sheet.addRow(row);}
  if(!options.report)sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(2,sheet.rowCount),column:definition.columns.length}};
 }
 if(options.lookups){const sheet=workbook.addWorksheet('可选基础数据');sheet.columns=[{header:'类别',key:'kind',width:22},{header:'稳定标识',key:'id',width:42},{header:'编码',key:'code',width:24},{header:'名称',key:'name',width:38}];for(const row of options.lookups)sheet.addRow(row);}
 if(options.report){const properties=workbook.addWorksheet('报表标记');properties.addRow(['READ_ONLY_REPORT']);}
 return Buffer.from(await workbook.xlsx.writeBuffer());
}
export async function errorsWorkbook(issues){const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('问题清单');sheet.columns=[['sheet','工作表'],['row','行号'],['field','字段'],['raw_value','原始值'],['reason','原因'],['suggestion','建议']].map(([key,header])=>({key,header,width:key==='reason'?55:28}));for(const item of issues)sheet.addRow({...item,raw_value:typeof item.raw_value==='object'?JSON.stringify(item.raw_value):item.raw_value});return Buffer.from(await workbook.xlsx.writeBuffer());}
