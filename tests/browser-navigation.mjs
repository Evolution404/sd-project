export async function navigate(page,title){
 const destination=title==='需求中心'?'需求台账':title==='子项目储备'?'项目中心':title;
 const parents={'数据字典':'系统管理','IP访问管理':'系统管理','线路台账':'基础台账','杆塔查询':'基础台账','档距查询':'基础台账','项目框架':'框架与协议','执行协议':'框架与协议','新建需求':'需求中心','需求台账':'需求中心'};
 const target=page.locator('.sidebar').getByRole('menuitem',{name:destination,exact:true});
 if(parents[destination]&&!await target.isVisible())await page.locator('.sidebar .el-sub-menu > .el-sub-menu__title').filter({hasText:parents[destination]}).click();
 await target.click();
}
