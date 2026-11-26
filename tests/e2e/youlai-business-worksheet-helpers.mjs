export async function worksheetCanvas(region) {
  const host=region.locator('.worksheet-canvas[data-ready="true"]');
  await host.waitFor({timeout:20000});
  return host.locator('canvas[id^="univer-sheet-main-canvas"]');
}
export async function waitForWorksheetFullscreen(page) {
  await page.waitForFunction(() => {
    const viewport = document.querySelector("[data-worksheet-fullscreen]");
    const canvas = viewport?.querySelector('canvas[id^="univer-sheet-main-canvas"]');
    if (!viewport || !canvas) return false;
    const bounds = viewport.getBoundingClientRect();
    const grid = canvas.getBoundingClientRect();
    return bounds.x === 0 && bounds.y === 0 && bounds.width === innerWidth && bounds.height === innerHeight
      && grid.height > innerHeight * 0.8 && viewport.contains(document.elementFromPoint(4, 4));
  });
}
export async function selectWorksheetCell(canvas,row,column,widths) {
  await canvas.click({position:{x:36+widths.slice(0,column).reduce((a,b)=>a+b,0)+25,y:63+(row-0.5)*34}});
}
export async function typeWorksheetCell(page,canvas,row,column,widths,value) {
  await selectWorksheetCell(canvas,row,column,widths);
  if(value==="") await page.keyboard.press("Delete");
  else {
    if(/^[\x20-\x7e]/.test(value)){await page.keyboard.press(value[0]);if(value.length>1)await page.keyboard.insertText(value.slice(1));}
    else {await canvas.dblclick({position:{x:36+widths.slice(0,column).reduce((a,b)=>a+b,0)+25,y:63+(row-0.5)*34}});await page.keyboard.press("ControlOrMeta+A");await page.keyboard.insertText(value);}
    await page.keyboard.press("Enter");
  }
}
export const materialWidths=[155,200,175,175,200,125,100,120];

export async function pickNativeRows(page,{title,placeholder,queries,confirm}){
  await page.getByRole("button",{name:title,exact:true}).click();
  const dialog=page.getByRole("dialog",{name:title,exact:true});
  for(const [query,match] of queries){
    await dialog.getByPlaceholder(placeholder).fill(query);
    await dialog.getByRole("button",{name:"查询",exact:true}).click();
    const row=dialog.getByRole("row").filter({hasText:match}).first();
    await row.locator("label.el-checkbox").click();
  }
  await dialog.getByRole("button",{name:new RegExp(confirm+"（"+queries.length+"）")}).click();
  await dialog.waitFor({state:"hidden"});
}
export async function pickDemandPositions(page,queries){
  return pickNativeRows(page,{title:"选择作业设备",placeholder:"搜索杆塔、线路或档距",queries,confirm:"添加所选位置"});
}
