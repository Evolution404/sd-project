export async function selectUiOption(locator,selection){
 if(await locator.evaluate(el=>el.tagName.toLowerCase())==='select')
  return locator.selectOption(selection);
 // Interact with the real Element Plus component, never mutate Vue internals.
 const control=locator.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " el-select ")][1]');
 const root=locator.locator('xpath=ancestor::html[1]');
 const listId=await locator.getAttribute('aria-controls');
 if(!listId)throw Error('Element Plus combobox missing aria-controls');
 await locator.press('Escape');
 await control.click();
 const list=root.locator('[id='+JSON.stringify(listId)+']');
 let option;
 if(typeof selection==='object'&&selection!==null&&'label' in selection)
  option=list.getByRole('option',{name:selection.label,exact:true}).first();
 else if(typeof selection==='object'&&selection!==null&&'index' in selection)
  option=list.getByRole('option').nth(selection.index);
 else{
  const value=typeof selection==='object'?selection.value:selection;
  option=list.locator('[data-option-value='+JSON.stringify(String(value))+']');
 }
 if(await option.first().getAttribute('aria-selected')==='true'){
  await locator.press('Escape');
  return [];
 }
 await option.first().click();
 return [];
}
