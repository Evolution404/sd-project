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


// Exercise real Element Plus typing/filtering, not just the source attribute.
// Leave the selection unchanged so the calling business scenario can continue.
export async function assertSearchableUiSelect(locator,query,expectedOption){
 const combo=(await locator.getAttribute('role'))==='combobox'
  ?locator:locator.locator('[role="combobox"]').first();
 const wrapper=locator.locator('xpath=ancestor-or-self::*[contains(concat(" ", normalize-space(@class), " "), " el-select__wrapper ")][1]');
 if(await wrapper.count())await wrapper.click();
 else await combo.click();
 await combo.fill(query);
 const root=locator.locator('xpath=ancestor::html[1]');
 const listId=await combo.getAttribute('aria-controls');
 const list=listId?root.locator('[id='+JSON.stringify(listId)+']'):root.locator('.el-select-dropdown:visible').last();
 await list.getByRole('option',{name:expectedOption,exact:true}).waitFor({state:'visible'});
 const actual=await list.getByRole('option').allTextContents();
 if(!actual.some(value=>value.includes(expectedOption)))throw Error('Searched line not found: '+expectedOption);
 await combo.press('Escape');
}
