from pathlib import Path
import sqlite3,collections,re,shutil
root=Path('docs/architecture')
db=sqlite3.connect(':memory:')
db.executescript((root/'数据库V3_结算驱动_候选表结构.sql').read_text())
q=chr(96)
tbl={}
for line in (root/'Schema113_业务对象完整性矩阵.md').read_text().splitlines():
 if not line.startswith('| '):continue
 cells=[a.strip() for a in line.strip('|').split('|')]
 if len(cells)<5 or not cells[1].startswith(q):continue
 name=cells[1].strip(q);tbl[name]=(cells[0],cells[4])
notes_text='''
action|当前业务记录操作类型
actor_id|执行业务事件的用户
actual_quantity_scaled|按统一缩放因子保存的实际数量
addition_reason|超出需求原材料清单的新增理由
after_json|操作后的结构化审计事实
agreement_id|业务归属执行协议
allow_span|操作类型是否允许选择档距
allow_tower|操作类型是否允许选择杆塔
additional_conditions_json|参考价扩展条件的不可变字典：键是正式价格因素编码，值锁定因素定义版本与枚举/整数范围；实际价格匹配由应用层执行
amount_fen|本条财务事实的金额（人民币分）；结算明细只对应本次结算费用，不保存累计金额
approval_scope_version_id|本条结算明细对应的正式批准范围版本
approval_version_id|项目正式批准版本身份
approved_amount_fen|本次批准的范围金额，NULL表示未核定
approved_at|项目正式批准的UTC时间点
approved_budget_fen|项目本次批准的整体软预算，人民币分
approved_by|正式批准人用户身份
approved_quantity_scaled|项目正式批准的物资数量
asset_no|一次性清洗后的设备资产编号
base_approval_version_id|变更单所依据的前一项目正式批准版本
based_on_version_id|草稿所依据的上一正式结算版本
basis|价格、结算或估算的依据说明
batch_id|需求导入批次身份
before_json|操作前的结构化审计事实
bytes|证据文件字节数
catalog_id|标准参考价格的目录稳定身份
category_id|业务类别字典项
category_version|项目类别采用的正式字典版本号，不随字典更名重算
change_order_id|引起正式批准版本变化的变更单
change_reason|台账设备属性变化原因
change_type|本次正式版本属于新增、修订还是作废
changed_at|业务定义变更登记UTC时间
changed_by|执行正式变更的用户
circuit_position|同塔多回时的回路物理/逻辑位置
close_snapshot_json|正式结项时冻结的完整依据
closed_at|正式关闭批准UTC时间
closed_by|执行正式关闭的审核人员
code|唯一业务编码
commissioned_on|设备投运业务日期
completion_standard|需求内容的质量或结果验收判据，不是施工完成记录
confirmed_at|实际费用或现场事实的确认UTC时间
confirmed_by|实际费用确认人员
context_line_id|共享物理杆塔所在的具体线路背景
contract_number|执行协议合同编号
cost_entry_id|实际费用稳定身份
cost_node_id|子项目费用树的稳定节点；只有末级能登记实际费用或结算
cost_node_version_id|本次实际费用确认或结算明细采用的费用名称定义历史版本
cost_version_id|实际费用正式确认或修订版本
counterparty_name|执行协议合同相对方名称
created_at|对象首次登记UTC时间
created_by|登记业务对象的用户
custom_fields_json|分类扩展业务字段的结构化数据
decided_at|正式业务决定UTC时间
decided_by|作出批准或拒绝决定的人
decision|重复需求审查结果
decision_reason|批准或拒绝的书面理由
default_location_kind|操作类型默认选用位置种类
default_quantity_scaled|新增需求时建议的数量缩放整数
default_target_object|操作类型默认作业对象位置说明
default_unit_id|操作类型默认计量单位字典身份
default_unit_version|默认单位名称所在的正式字典版本
demand_id|专业需求稳定身份
demand_lifecycle_event_id|需求状态确认/退回历史事件
demand_material_demand_id|物资版本证据所归属的需求身份
demand_material_master_id|版本物资所引用的统一物资身份
demand_material_version_no|版本化物资的需求版本号
demand_no|专业需求业务编号
demand_revision_id|专业需求修订历史记录
demand_snapshot_json|承接时冻结的专业需求定义
demand_version|项目所引用的专业需求正式版本号
demand_version_demand_id|证据所关联的专业需求版本复合身份
demand_version_no|证据所关联的专业需求正式版本号
description|来源线索或原始记录描述
discovered_on|问题被发现的业务日期
display_name|杆塔或线路面向业务的显示名称
disposition|结项剩余工作量的处置分类
draft_json|尚未提交的业务草稿正文
edit_version|草稿编辑并发版本序号
effective_from|合同或版本生效起始业务日期
effective_on|正式业务批准的生效日期
effective_to|合同或版本生效结束日期
end_tower_id|档距终止逻辑杆塔
entity|审计事件对应的业务实体类型
entity_id|审计事件对应实体的稳定身份字符串
entry_hint|操作类型的录入指引文字
entry_id|实际费用稳定身份
erection_type|线路/杆塔架设类型
event_seq|同一业务对象状态事件的连续序号
evidence|现场实际或成本确认的书面依据
expected_on|专业需求期望办理日期
expires_at|登录会话或授权到期UTC时间
external_record_id|一次性数据导入原始来源编号，不作为持续外部系统映射
field_definitions_json|来源分类扩展字段定义
fields_json|标准业务字典/操作类型扩展字段
file_id|不可变证据文件身份
filename|证据文件原始名称
fiscal_year|所属年度
framework_id|所属年度框架稳定身份
from_status|状态事件的原状态
funding_version_id|真实费用或结算确认时所采用的资金归属版本
height_scaled|设备高度整数缩放值
id|不可复用的对象稳定主键
idempotency_key|同一导入请求的幂等标识
invoice_number|实际费用关联的发票单号（不是完整发票台账）
ip|允许访问的IPv4/IPv6地址
is_final|费用核对是否为最终核对
item_id|字典项或物资条目稳定身份
item_no|条目在所属正式清单内的顺序
junction_tower_id|线路分支接入点的逻辑杆塔
latitude|设备地理纬度
limit_fen|框架或协议当前正式额度，人民币分
line_code|线路稳定业务编码
line_id|所属线路身份
line_kind|主线、支线或其他线路类型
location_kind|根据档距关联自动推导的虚拟位置类型，不单独存储
line_name_snapshot|需求首次登记时看到的线路名称
line_span_history_id|档距历史版本的证据关联
linked_at|证据与业务对象建立关联的UTC时间
linked_by|提交证据关联的用户
logical_code|逻辑杆塔稳定编码
logical_tower_id|逻辑杆塔身份
longitude|设备地理经度
operations_team|对应逻辑杆塔所属线路的运维班组，独立于子项目归口单位
management_department|设备主管部门
manager_id|子项目管理人员
matched_demand_id|去重审查中已存在的需求
material_code_snapshot|批准时冻结的物资主数据编码
material_id|统一物资主数据身份
material_version_id|正式物资主数据历史版本身份，锁定需求清单或批准物资当时引用的定义
material_model|批准时冻结的物资型号
material_name|批准时冻结的物资名称
mime|证据文件的MIME媒体类型
model|设备或物资型号
name|业务名称
new_demand_id|去重审查关联的新建需求
note|与业务对象关联的备注
number|项目内结算单编号
observed_physical_tower_id|录入时实际观察到的物理杆塔
occurred_on|本次真实费用等独立业务事实的发生日期
operation_id|正式操作类型身份
operation_snapshot|历史需求关联的操作类型文字
operation_version|操作类型正式版本号
owner_id|子项目责任人
parent_id|组织单位或业务对象的父级身份
parent_unit_id|组织单位当次正式定义采用的上级单位稳定身份
parent_line_id|所属上级线路
password_hash|账户密码的单向散列（不存明文）
payload_sha256|来源/请求原始内容SHA-256摘要
permission_code|应用层权限点编码
physical_code_snapshot|需求首次登记时的物理杆塔编码
physical_tower_id|实际物理杆塔身份
planned_end_on|子项目预计结束业务日期
planned_start_on|子项目预计开始业务日期
preliminary_estimate_basis|子项目初步估算金额的依据
preliminary_estimate_fen|子项目初步估算金额（非正式批准）
previous_version_id|当前结算版本的上一历史版本
price_date|参考单价所依据的业务日期
price_source|单价引用的原始来源
priority_id|优先级字典项
priority_snapshot|需求确认时的优先级名称
problem_description|需处理的隐患或工作问题
project_approval_material_id|具体已批准物资快照的证据归属
project_approval_version_id|项目正式批准版本的证据归属
project_closure_id|正式关闭审批身份
project_funding_version_id|子项目资金归属版本
project_id|子项目稳定身份
project_management_version_id|子项目责任与计划版本
project_material_id|子项目范围内的统一物资稳定身份
project_scope_id|子项目承接的需求范围身份
project_stage_event_id|子项目储备入库立项结项事件
project_version|项目阶段变更的连续序号
proposal_json|项目范围和预算变更提案内容
proposal_status|未正式批准前的项目拟承接状态
proposed_amount_fen|项目拟承接金额（尚非正式批准值）
proposed_by|线索提出人员
proposed_quantity_scaled|项目拟承接工作量缩放整数
proposed_unit_price_fen|拟承接单价，人民币分
purpose|设备用途或访问授权用途
quantity_scaled|工程、需求或真实执行数量的缩放整数
reason|登记、修订、审批或撤销的正式理由
reconciled_cost_fen|该核对记录确认的真实成本金额
reconciled_settlement_fen|该核对记录确认的正式结算金额
reconciliation_version_id|费用与结算历史核对版本
record_id|历史修订归属的原始业务事实
recorded_at|历史业务事件录入数据库的UTC时间点
recorded_by|登记正式业务事实的用户
reference_price_version_id|本次采用的参考单价正式版本
remaining_quantity_scaled|正式结项时未完成数量
request_hash|幂等请求的原始内容摘要
request_key|重复请求去重的稳定幂等标识
managing_unit_id|本子项目归口管理的组织单位身份，不表示实际作业单位、施工单位或结算单位
managing_unit_version_id|子项目归口单位当次采用的组织定义正式版本，历史归口关系不随组织更名变化
result_json|幂等请求已完成的结果快照
role|应用层角色名称
row_number|Excel/PMS来源所在数据行号
scope_snapshot_json|结算或审批时冻结的业务范围快照
settlement_id|结算单稳定身份（对实际工作可空）
settlement_item_id|结算明细身份（实际实施登记时可空）
settlement_item_version_id|正式结算明细的完整历史版本
settlement_on|结算业务确认日期
settlement_review_event_id|具体结算审核事件
settlement_version_id|正式结算版本身份
setup_status|设备建档状态
sha256|证据附件文件内容SHA-256摘要
signed_on|协议合同签订日期
snapshot_json|正式业务版本整体快照
sort_order|数据字典或操作定义展示顺序
sort_rank|设备在线路中的拓扑顺序
source_file_id|原始输入证据文件身份
source_id|来源记录稳定身份
source_kind|来源渠道类别
source_name|来源系统的对外名称
source_payload_sha256|原始来源记录SHA-256内容摘要
source_system|外部业务系统或Excel来源名称
span_id|线路档距稳定身份
span_snapshot_json|需求关联档距时的冻结历史信息
span_version|需求关联档距的正式版本号
specification|物资或参考单价的规格
stage|项目储备入库立项结项阶段
start_tower_id|档距起始逻辑杆塔
status|当前状态或历史版本审核状态
storage_key|附件内容寻址存储路径
target_object|本次具体作业对象或位置
tax_mode|含税、不含税或无税业务口径
tax_rate_basis_points|税率，万分比整数
title|字典、费用或操作定义标题
to_status|状态事件的目标状态
token_hash|登录会话令牌单向哈希
tower_code|物理杆塔业务编码
tower_no|线路内的逻辑杆塔编号
tower_no_snapshot|需求首次登记时的杆塔编号
tower_type|杆塔类型
transmission_center_length_mm|输电中心管辖的该档距长度，毫米整数，NULL表示尚未核定，0表示明确无管辖长度
type_id|数据字典分类身份
type_snapshot|业务确认时的来源类别文字
unit_id|计量单位字典项
unit_price_fen|单位数量价格，以人民币分存储
unit_snapshot|正式批准或发生时的单位名称快照
unit_version|计量单位字典正式版本号
updated_at|允许更新的草稿或主数据最后修改UTC时间
updated_by|修改主数据或可编辑业务草稿的用户
uploaded_by|证据文件上传用户
user_id|登录会话对应的用户
username|登录用户名
version|正式定义或设备当前连续版本
version_no|历史记录版本序号
voltage_level_id|线路设备所在电压等级
work_mode|作业方式，停电或不停电等
work_object_id|操作类型对应的作业对象身份
work_object_snapshot|正式需求确认时的作业对象名称
work_target_type|作业对象定位方式，线路逻辑对象或物理设备
worksheet_name|来源Excel工作表名称
'''
notes={}
for line in notes_text.strip().splitlines():
 k,v=line.split('|',1)
 assert k not in notes
 notes[k]=v
def retention(table,col,hidden):
 if hidden:return '派生（不另存）'
 if col=='id' or col in ('demand_no','code','line_code','logical_code','tower_code','number','request_key'):
  return '保留：稳定身份或唯一编码'
 if col.startswith('proposed_') or col.startswith('preliminary_'):
  return '保留：尚未批准的独立预计事实'
 if 'snapshot' in col or col in ('before_json','after_json'):
  return '保留：不可追溯重算的历史快照'
 if table.endswith(('_history','_versions','_revisions','_events')) or table in ('audit_events','project_closures','project_closure_dispositions'):
  return '保留：历史/审核事实'
 if col in ('created_at','recorded_at','occurred_on','confirmed_at','approved_at','closed_at'):
  return '保留：登记/发生时间'
 if table=='projects' and col in ('status','version'):
  return '投影：阶段事件同步维护，禁止独立修改'
 if table in ('materials','dictionary_items') and col in ('name','model','specification','status'):
  return '保留：统一主数据'
 return '保留：独立属性或真实关联'
out=['# Schema 113｜逐表逐字段正式数据字典','',
'依据：§数据库V3_结算驱动_候选表结构.sql§。本文件列出当前全部基础表、含虚拟生成列的字段、主外键、必填性、默认值和保留理由；准确定义的全部 CHECK/触发器以源 SQL 为准。','',
'金额采用人民币分的 INTEGER；数量采用统一缩放整数；日期采用 YYYY-MM-DD，UTC登记时间采用毫秒 ISO8601；全表 STRICT，不允许混合文本和数值。','',
'**本字典描述数据库业务数据，不包含应用层统计、权限判定或预警功能。**','']
unmapped=collections.defaultdict(list)
total=0
for name in sorted(tbl):
 group,description=tbl[name]
 cols=list(db.execute('PRAGMA table_xinfo('+name+')'))
 total+=len(cols)
 fks=list(db.execute('PRAGMA foreign_key_list('+name+')'))
 fkmap=collections.defaultdict(list)
 for fk in fks:
  fkmap[fk[3]].append((fk[2],fk[4],fk[0]))
 idxmap=collections.defaultdict(list)
 for idx in db.execute('PRAGMA index_list('+name+')'):
  if not idx[2]:continue
  components=[r[2] for r in db.execute('PRAGMA index_xinfo('+idx[1]+')') if r[5] and r[2] is not None]
  for cn in components:
   if len(components)==1:idxmap[cn].append('唯一')
   else:idxmap[cn].append('组合唯一')
 out+=['','## §'+name+'§ — '+description,'',
 '业务领域：'+group+'。字段数：'+str(len(cols))+'；外键分量：'+str(len(fks))+'。',
 '',
 '| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |',
 '| --- | --- | --- | --- | --- | --- | --- |']
 for col in cols:
  colname,typ,notnull,default,pk,hidden=col[1],col[2],col[3],col[4],col[5],col[6]
  meaning=notes.get(colname)
  if not meaning:
   if colname.endswith('_id'):
    meaning='关联'+colname[:-3].replace('_','/')+'实体的真实身份'
   elif colname.endswith('_at'):meaning='该业务动作的UTC记录时间点'
   elif colname.endswith('_on'):meaning='该业务事实的发生日期'
   elif colname.endswith('_fen'):meaning='人民币分计量的业务金额'
   elif colname.endswith('_scaled'):meaning='统一整数倍率保存的业务数量'
   elif colname.endswith('_json'):meaning='按业务版本冻结或编辑的结构化JSON内容'
   else:
    meaning='对象属性：'+colname
    unmapped[colname].append(name)
  constraint=[]
  if pk:constraint.append('主键')
  if hidden:constraint.append('生成列')
  constraint+=idxmap[colname]
  for table,to,fkid in fkmap[colname]:constraint.append('外键→'+table+'.'+to+'（组'+str(fkid)+'）')
  con='<escape>|</escape>'.join(constraint) if constraint else '见原生CHECK'
  out.append('| §'+colname+'§ | '+(typ or '计算列')+' | '+('是' if notnull or pk else '否')+' | '+
             (str(default).replace('|','/') if default is not None else '—')+' | '+
             con+' | '+meaning+' | '+retention(name,colname,hidden)+' |')
out=[''.join(line).replace('§',q) for line in out]
out.extend(['','## 数据字典核验摘要','',
'基础数据表数：'+str(len(tbl))+'；字段总数（含生成列）：'+str(total)+'；需要人工补写独立描述的字段名：'+str(len(unmapped))+'。',
'','业务字段是否需要新增必须结合真实台账和业务需求验证，**不能凭字段数量推断功能已经完全覆盖**。详情见业务对象完整性矩阵。',''])
if unmapped:
 out.extend(['','### 自动解释仍需业务补充的字段','','| 字段 | 涉及对象 |','| --- | --- |'])
 for key in sorted(unmapped):out.append('| '+q+key+q+' | '+', '.join(q+n+q for n in unmapped[key])+' |')
destination=root/'Schema113_逐字段数据字典.md'
destination.write_text('\n'.join(out).rstrip('\n')+'\n')
print('DATA_DICTIONARY',len(tbl),'TABLES',total,'FIELDS','unmapped_unique',len(unmapped),'output',destination.stat().st_size,'bytes')
if unmapped:print('FIELDS NEED FOLLOW-UP',sorted(unmapped))
# Preserve the generator for deterministic regeneration from the SQL.
own=Path(__file__)
persist=root/'schema113_export_dictionary.py'
if own.resolve()!=persist.resolve():shutil.copyfile(own,persist)
