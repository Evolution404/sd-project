export async function navigate(page,title){
 const destination=title==='需求中心'?'需求台账':title==='子项目储备'?'项目中心':title;
 const parents={'操作记录':'系统管理','数据字典':'系统管理','IP访问管理':'系统管理','线路台账':'基础台账','杆塔查询':'基础台账','档距查询':'基础台账','项目框架':'框架与协议','执行协议':'框架与协议','新建需求':'需求中心','需求台账':'需求中心'};
 const target=page.locator('.sidebar').getByRole('menuitem',{name:destination,exact:true});
 if(parents[destination]){
  const parent=page.locator('.sidebar').getByRole('menuitem',{name:parents[destination],exact:true});
  // During a closing transition the child is still "visible" although its
  // parent is collapsed. Inspect the menu state before clicking the child.
  if(await parent.getAttribute('aria-expanded')!=='true')await parent.locator(':scope > .el-sub-menu__title').click();
 }
 await target.click();
}
