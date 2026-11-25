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
      group("/business","业务办理","el-icon-Tickets",[
        leaf("demands","Demands","专业需求","el-icon-List","business/DemandAdministration"),
        ...(grants.has("write") ? [{
          ...leaf("demands/edit/:demandId?", "DemandEditor", "编制专业需求", "el-icon-List", "business/DemandEditor"),
          meta: { title: "编制专业需求", icon: "el-icon-List", hidden: true },
        }] : []),
        leaf("projects","Projects","子项目管理","el-icon-FolderOpened","business/ProjectsAdministration"),
        ...(["write", "project.approve", "change.approve"].some(permission => grants.has(permission))
          ? [{
              ...leaf("projects/:projectId/approval/:task", "ProjectApproval",
                "项目立项与变更", "el-icon-DocumentChecked", "business/ProjectApprovalAdministration"),
              meta: { title: "项目立项与变更", icon: "el-icon-DocumentChecked", hidden: true },
            }]
          : []),
      ]),
      group("/funding","资金与结算","el-icon-Wallet",[
        { ...leaf("frameworks","Frameworks","年度框架","el-icon-Calendar","business/FundingAdministration"),
          meta: { title: "年度框架", icon: "el-icon-Calendar", keepAlive: true } },
        { ...leaf("agreements","Agreements","执行协议","el-icon-DocumentChecked","business/FundingAdministration"),
          meta: { title: "执行协议", icon: "el-icon-DocumentChecked", keepAlive: true } },
        {
          ...leaf("finance", "Finance", "费用与结算", "el-icon-Coin", "business/FinanceAdministration"),
          meta: { title: "费用与结算", icon: "el-icon-Coin", keepAlive: true },
        },
        ...(grants.has("write") ? [
          ["projects/:projectId/settlements/new", "SettlementCreate", "编制结算草稿"],
          ["settlements/:settlementId/edit", "SettlementEdit", "编制结算"],
          ["settlements/:settlementId/void", "SettlementVoid", "编制作废草稿"],
        ].map(([path, name, title]) => ({
          ...leaf(path, name, title, "el-icon-Document", "business/SettlementCompose"),
          meta: { title, icon: "el-icon-Document", hidden: true },
        })) : []),
        ...(grants.has("write") || grants.has("settlement.approve") ? [{
          ...leaf("settlements/:settlementId/review", "SettlementReview", "结算审核办理", "el-icon-DocumentChecked", "business/SettlementReview"),
          meta: { title: "结算审核办理", icon: "el-icon-DocumentChecked", hidden: true },
        }] : []),
      ]),
      group("/assets","设备与物资","el-icon-Connection",[
        leaf("ledger","Ledger","输电设备台账","el-icon-Monitor","business/EquipmentAdministration"),
        leaf("materials","Materials","物资管理","el-icon-Box","business/MaterialsAdministration"),
      ]),
      group("/standards","标准与计价","el-icon-Collection",[
        leaf("operations","Operations","作业标准","el-icon-Notebook","business/StandardsAdministration"),
        leaf("pricing","Pricing","参考价格","el-icon-PriceTag","business/PricingAdministration"),
      ]),
    );
  }
  const configuration:MenuRoute[]=[];
  if(readable) configuration.push(leaf("dictionaries","Dictionaries","基础数据","el-icon-Grid","business/DictionariesAdministration"));
  if(grants.has("role.manage")) configuration.push(leaf("system","System","系统管理","el-icon-Setting","system/role/index"));
  if(grants.has("user.manage")) configuration.push(leaf("users","Users","用户管理","el-icon-User","business/UserAdministration"));
  if(grants.has("audit.read")) configuration.push(leaf("audit","Audit","审计记录","el-icon-Document","business/AuditAdministration"));
  if(grants.has("admin")) configuration.push(leaf("access","Access","访问控制","el-icon-Lock","business/AccessAdministration"));
  if(configuration.length)groups.push(group("/configuration","基础配置与系统","el-icon-Operation",configuration));
  return groups;
}
