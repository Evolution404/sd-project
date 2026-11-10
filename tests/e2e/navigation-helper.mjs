const groups = {
  '专业需求': '业务办理', '子项目管理': '业务办理',
  '年度框架': '资金与结算', '执行协议': '资金与结算', '费用与结算': '资金与结算',
  '输电设备台账': '设备与物资', '物资管理': '设备与物资',
  '作业标准': '标准与计价', '参考价格': '标准与计价',
  '基础数据': '基础配置与系统', '系统管理': '基础配置与系统',
};
export async function selectNavigation(page, title) {
  const mobile = page.getByRole('button', { name: '打开导航', exact: true });
  if (await mobile.isVisible() && !await page.locator('.mobile-navigation-drawer:visible').count()) await mobile.click();
  const menu = await page.locator('.mobile-navigation-drawer:visible').count()
    ? page.locator('.mobile-navigation-drawer:visible') : page.locator('.navigation');
  const item = menu.getByRole('menuitem', { name: title, exact: true });
  if (!await item.isVisible()) await menu.locator('.el-sub-menu__title').filter({ hasText: groups[title] }).click();
  await item.click();
}
