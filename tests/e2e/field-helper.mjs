export async function selectFormChoice(page, label, name, scope = page) {
  const item = scope.locator(".el-form-item").filter({has:page.getByText(label,{exact:true})}).first();
  const wrapper = item.locator(".el-select__wrapper").first();
  await wrapper.click();
  const control = item.locator('input[role="combobox"], [role="combobox"]').first();
  const popupId = await control.getAttribute("aria-controls");
  if (!popupId) throw new Error("选择器缺少关联弹层 " + label);
  const popup = page.locator('[id="' + popupId + '"]');
  await popup.waitFor({ state: "visible" });
  if (await popup.locator(".el-tree").count()) {
    if (await control.isEditable()) await control.fill(name);
    await popup
      .locator(".el-tree-node__content")
      .filter({ has: page.getByText(name, { exact: true }) })
      .last()
      .click();
  } else {
    await popup.getByRole("option", { name, exact: true }).last().click();
  }
}

export async function addOperationAttribute(page, {label,type='文字',scope='位置级',options=[],pricing=false,requirement='可选',precision,min,max}) {
  const operation=page.getByRole('region',{name:/操作类型$/,exact:false});
  await operation.getByRole('tab',{name:'附加属性',exact:true}).click();
  await operation.getByRole('button',{name:'添加附加属性',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'附加属性',exact:true});
  await editor.getByLabel('属性名称',{exact:true}).fill(label);
  await selectFormChoice(page,'所属层级',scope,editor);
  await selectFormChoice(page,'字段类型',type,editor);
  for (const [index, option] of options.entries()) {
    await editor.getByRole('button', {name: '添加选项', exact: true}).click();
    await editor.getByLabel(`选项名称 ${index + 1}`, {exact: true}).fill(option);
  }
  if(precision!==undefined)await editor.getByLabel('数值精度',{exact:true}).fill(String(precision));
  if(min!==undefined)await editor.getByLabel('最小值',{exact:true}).fill(String(min));
  if(max!==undefined)await editor.getByLabel('最大值',{exact:true}).fill(String(max));
  if(pricing)await editor.locator('.el-form-item').filter({has:page.getByText('是否参与计价',{exact:true})}).locator('.el-switch').click();
  await selectFormChoice(page,'必填规则',requirement,editor);
  await editor.getByRole('button',{name:'保存属性配置',exact:true}).click();
  await editor.waitFor({state:'hidden'});
}

export async function chooseDemandLocations(page, labels) {
  await page.getByRole('button',{name:'添加作业位置',exact:true}).click();
  const picker=page.getByRole('dialog',{name:'添加作业位置',exact:true});
  for(const label of labels)await picker.getByRole('checkbox',{name:'选择'+label,exact:true}).locator('xpath=ancestor::label[1]').click();
  await picker.getByRole('button',{name:'添加已选位置',exact:true}).click();
  await picker.waitFor({state:'hidden'});
}
