import type { Component } from "vue";
import { House, Document, FolderOpened, Wallet, Coin, Connection, Collection, Setting, Box, PriceTag, Grid } from "@element-plus/icons-vue";

export interface NavigationItem {
  key: string;
  title: string;
  icon: Component;
  adminOnly?: boolean;
}
export interface NavigationGroup {
  key: string;
  title: string;
  items: NavigationItem[];
}

export const navigation: NavigationGroup[] = [
  { key: "home", title: "工作台", items: [{ key: "dashboard", title: "工作台", icon: House }] },
  { key: "business", title: "业务办理", items: [
    { key: "demands", title: "专业需求", icon: Document },
    { key: "projects", title: "子项目管理", icon: FolderOpened },
  ] },
  { key: "funds", title: "资金与结算", items: [
    { key: "frameworks", title: "年度框架", icon: Wallet },
    { key: "agreements", title: "执行协议", icon: Wallet },
    { key: "finance", title: "费用与结算", icon: Coin },
  ] },
  { key: "assets", title: "设备与物资", items: [
    { key: "ledger", title: "输电设备台账", icon: Connection },
    { key: "materials", title: "物资管理", icon: Box },
  ] },
  { key: "standards", title: "标准与计价", items: [
    { key: "standards", title: "作业标准", icon: Collection },
    { key: "pricing", title: "参考价格", icon: PriceTag },
  ] },
  { key: "configuration", title: "基础配置与系统", items: [
    { key: "dictionaries", title: "基础数据", icon: Grid },
    { key: "system", title: "系统管理", icon: Setting, adminOnly: true },
  ] },
];

export const navigationItems = navigation.flatMap(group => group.items);
export function navigationGroup(key: string): string {
  return navigation.find(group => group.items.some(item => item.key === key))?.key || "home";
}
