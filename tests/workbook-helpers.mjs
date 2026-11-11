import { layouts } from '../dist/server/modules/exchange/workbook.js';

export function columnIndex(sheet, key) {
  const definition = Object.values(layouts).flat().find(item => item.name === sheet.name);
  const binding = `sd113_${definition.key}_${key}`;
  let column = -1;
  sheet.getRow(1).eachCell((cell, index) => {
    if (sheet.workbook.definedNames.getNames(`${sheet.name}!${cell.address}`).includes(binding)) column = index;
  });
  return column;
}
