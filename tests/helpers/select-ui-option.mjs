export async function selectUiOption(locator,selection){
 if(await locator.evaluate(el=>el.tagName.toLowerCase())==='select')
  return locator.selectOption(selection);
 const root=locator.locator('xpath=ancestor::html[1]');
 // Playwright getByLabel can resolve the outer ElSelect wrapper; aria-controls
 // belongs to its inner combobox, and may only appear after opening.
 const combo=(await locator.getAttribute('role'))==='combobox'
  ?locator:locator.locator('[role="combobox"]').first();
 const clickable=locator.locator('xpath=ancestor-or-self::*[contains(concat(" ", normalize-space(@class), " "), " el-select__wrapper ")][1]');
 if(await clickable.count())await clickable.click();
 else await locator.click();

 const listId=await combo.getAttribute('aria-controls').catch(()=>null);
 const list=listId?root.locator('[id='+JSON.stringify(listId)+']'):root.locator('.el-select-dropdown:visible').last();
 let option;
 if(typeof selection==='object'&&selection!==null&&'label' in selection)
  option=list.getByRole('option',{name:selection.label,exact:true}).first();
 else if(typeof selection==='object'&&selection!==null&&'index' in selection)
  option=list.getByRole('option').nth(selection.index);
 else{
  const value=typeof selection==='object'&&selection!==null?selection.value:selection;
  option=list.locator('[data-option-value='+JSON.stringify(String(value))+']').first();
 }
 if(await option.getAttribute('aria-selected')==='true'){
  await combo.press('Escape');
  return [];
 }
 await option.click();
 return [];
}
