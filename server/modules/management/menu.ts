import type { Actor } from "../../shared/types/contracts.js";

/**
 * The server, not a client-side role name, decides which UI modules are exposed.
 * Component paths are allowlisted constants and can never be supplied by a client.
 * No menu permission grants a business API action: service authorization remains independent.
 */
interface MenuRoute {
  path:string;
  name:string;
  component:string;
  meta:{title:string;icon:string;keepAlive?:boolean;hidden?:boolean};
  children:MenuRoute[];
}
const leaf=(path:string,name:string,title:string,icon:string,component:string):MenuRoute=>({
  path,name,component,meta:{title,icon,keepAlive:false},children:[]
});
const group=(path:string,title:string,icon:string,children:MenuRoute[]):MenuRoute=>({
  path,name:path,component:"Layout",meta:{title,icon},children
});
export function authorizedMenuRoutes(actor: Actor):MenuRoute[] {
  const grants=new Set(actor.permissions);
  const readable=grants.has("read");
  const groups:MenuRoute[]=[];
  if(readable){
    groups.push(
      group("/business","业务办理","document",[
        leaf("demands","Demands","专业需求","document","business/DemandAdministration"),
        ...(grants.has("write") ? [{
          ...leaf("demands/edit/:demandId?", "DemandEditor", "编制专业需求", "document", "business/DemandEditor"),
          meta: { title: "编制专业需求", icon: "document", hidden: true },
        }] : []),
        leaf("projects","Projects","子项目管理","file","business/ProjectsAdministration"),
        ...(["write", "project.approve", "change.approve"].some(permission => grants.has(permission))
          ? [{
              ...leaf("projects/:projectId/approval/:task", "ProjectApproval",
                "项目立项与变更", "document", "business/ProjectApprovalAdministration"),
              meta: { title: "项目立项与变更", icon: "document", hidden: true },
            }]
          : []),
      ]),
      group("/funding","资金与结算","table",[
        { ...leaf("frameworks","Frameworks","年度框架","dict","business/FundingAdministration"),
          meta: { title: "年度框架", icon: "dict", keepAlive: true } },
        { ...leaf("agreements","Agreements","执行协议","document","business/FundingAdministration"),
          meta: { title: "执行协议", icon: "document", keepAlive: true } },
        {
          ...leaf("finance", "Finance", "费用与结算", "table", "business/FinanceAdministration"),
          meta: { title: "费用与结算", icon: "table", keepAlive: true },
        },
        ...(grants.has("write") ? [
          ["projects/:projectId/settlements/new", "SettlementCreate", "编制结算草稿"],
          ["settlements/:settlementId/edit", "SettlementEdit", "编制结算"],
          ["settlements/:settlementId/void", "SettlementVoid", "编制作废草稿"],
        ].map(([path, name, title]) => ({
          ...leaf(path, name, title, "document", "business/SettlementCompose"),
          meta: { title, icon: "document", hidden: true },
        })) : []),
        ...(grants.has("write") || grants.has("settlement.approve") ? [{
          ...leaf("settlements/:settlementId/review", "SettlementReview", "结算审核办理", "document", "business/SettlementReview"),
          meta: { title: "结算审核办理", icon: "document", hidden: true },
        }] : []),
      ]),
      group("/assets","设备与物资","monitor",[
        leaf("ledger","Ledger","输电设备台账","monitor","business/EquipmentAdministration"),
        leaf("materials","Materials","物资管理","group","business/MaterialsAdministration"),
      ]),
      group("/standards","标准与计价","document",[
        leaf("operations","Operations","作业标准","document","business/StandardsAdministration"),
        leaf("pricing","Pricing","参考价格","table","business/PricingAdministration"),
      ]),
    );
  }
  const configuration:MenuRoute[]=[];
  if(readable) configuration.push(leaf("dictionaries","Dictionaries","基础数据","setting","business/DictionariesAdministration"));
  if(grants.has("role.manage")) configuration.push(leaf("system","System","系统管理","setting","system/role/index"));
  if(grants.has("user.manage")) configuration.push(leaf("users","Users","用户管理","role","business/UserAdministration"));
  if(grants.has("audit.read")) configuration.push(leaf("audit","Audit","审计记录","document","business/AuditAdministration"));
  if(grants.has("admin")) configuration.push(leaf("access","Access","访问控制","security","business/AccessAdministration"));
  if(configuration.length)groups.push(group("/configuration","基础配置与系统","setting",configuration));
  return groups;
}
