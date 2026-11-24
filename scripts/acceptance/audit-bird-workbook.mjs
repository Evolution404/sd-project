import ExcelJS from "exceljs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const source = process.argv[2];
if (!source) throw Error("请显式指定本地原始工作簿");
const output = resolve(process.argv[3] || "test-results/dux/bird");
await mkdir(output, { recursive: true });
const bytes = await readFile(source),
  book = new ExcelJS.Workbook();
await book.xlsx.load(bytes);
function plain(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value && typeof value === "object") {
    if ("richText" in value)
      return value.richText.map((item) => item.text).join("");
    if ("formula" in value)
      return { formula: value.formula, result: value.result };
    if ("text" in value) return value.text;
  }
  return value;
}
const sheets = book.worksheets.map((sheet) => {
  const rows = [];
  sheet.eachRow((row, index) => {
    const cells = {};
    row.eachCell((cell, column) => {
      cells[column] = plain(cell.value);
    });
    rows.push({ row: index, cells });
  });
  return {
    name: sheet.name,
    row_count: sheet.rowCount,
    column_count: sheet.columnCount,
    merges: sheet.model.merges,
    rows,
  };
});
await writeFile(
  resolve(output, "原始读取.json"),
  JSON.stringify(
    {
      source,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sheets,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    sheets.map(({ rows, ...sheet }) => ({
      ...sheet,
      nonempty_rows: rows.length,
    })),
    null,
    2,
  ),
);
