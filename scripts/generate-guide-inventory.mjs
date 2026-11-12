import { writeFileSync } from "node:fs";
import { guideAnchorDeclarations } from "./lib/guide-anchor-audit.mjs";
import { guideModules } from "../web/src/guides/registry/modules.ts";
import { guideActions } from "../web/src/guides/registry/actions.ts";
import { guideCourses } from "../web/src/guides/registry/journeys.ts";
const safe=x=>String(x||"—").replace(/\|/g,"／").replace(/\n/g,"；");
const labels={admin:"管理员",editor:"编辑",verifier:"审核",viewer:"只读"};
const {direct,delegated,all}=guideAnchorDeclarations;
function anchored(id){ return all.has(id); }
const anchoredActions=guideActions.filter(a=>anchored(a.id));
const entries=[
 "# P10 业务操作帮助覆盖清单",
 "",
 "> 此清单由当前语义注册表生成。登记条目不等于已完成全部业务动作盘点或浏览器角色/状态验证；需继续对照实际按钮、动态弹窗和权限逐项复核。由 scripts/generate-guide-inventory.mjs 生成。",
 "",
 "- 12个主模块："+guideModules.length+"／12；Excel专题：单列。",
 "- 已登记语义动作类型："+guideActions.length+"；其中源码静态声明语义锚点："+anchoredActions.length+"；其余只具备说明，仍需检查无锚点动作、动态状态并经真实浏览器验收，不能宣称100%覆盖。",
 "- 静态声明：直接 "+direct.size+" 类、委托动态 "+delegated.size+" 类；只能表明源码标注，浏览器覆盖和真实按钮总数尚待独立核查。",
 "- 已声明L01～L12课程："+guideCourses.length+"；目前说明和阅读计划不代表独立训练实操通过。",
 "",
 "|模块|actionId|操作名称|用途|角色|典型状态|前置条件|正式操作结果|风险与历史|目前可定位|锚点|关联课程|",
 "|---|---|---|---|---|---|---|---|---|---|---|---|",
 ...guideActions.map(a=>"|"+[a.module,a.id,a.title,a.purpose,a.roles.map(r=>labels[r]).join("、"),
  a.states.join("、"),a.prerequisite,a.result,a.risk,anchored(a.id)?"静态声明有控件锚点（待实测）":"待补真实控件锚点/豁免",a.target||"需按当前活动弹窗和业务状态选择",a.courseIds.join("、")]
    .map(safe).join("|")+"|"),
 "",
 "## 仍需完成的真实覆盖审计",
 "",
 "- 以每个页面及其子分区、更多菜单、弹窗、行内和批量操作、四角色可见/禁用/隐藏状态为总分母，不能仅以当前DOM扫描为依据。",
 "- 对暂不可见的操作核实对应业务前置条件、后端版本和禁止状态；记录实际稳定data-guide-action锚点或批准豁免。",
 "- 本清单是语义帮助注册的起始基线，不得将已登记条目直接解释为100%覆盖。",
 "- 独立训练实例和L01～L12只读服务端检查已实现，完成取决于真实训练库中的业务事实；Windows实机仍须单独提供证据。",
 "",
 "## 页面及课程定位",
 ...guideModules.map(m=>"- "+m.title+"（"+m.id+"）："+m.steps.length+"步短导览；"+m.summary),
 ...guideCourses.map(c=>"- "+c.id+" "+c.title+"："+c.purpose+"；服务端检查点："+c.checkpoint),
 ""];
writeFileSync("docs/implementation/P10_业务操作帮助覆盖清单.md",entries.join("\n"));
console.log("P10_INVENTORY_GENERATED actions="+guideActions.length+" anchored="+anchoredActions.length);
