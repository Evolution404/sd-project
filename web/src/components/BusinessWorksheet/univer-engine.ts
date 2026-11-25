import {
  BooleanNumber, BorderStyleTypes, CellValueType, HorizontalAlign, LifecycleStages, LocaleType,
  VerticalAlign, WrapStrategy, createUniver, defaultTheme, mergeLocales, IUndoRedoService,
  CommandType, ICommandService, IConfigService, IContextService, IUniverInstanceService, LocalUndoRedoService,
  type IMutation, type IMutationInfo, type IUndoRedoItem,
  type ICellData, type IRange, type IStyleData, type IWorkbookData,
} from "@univerjs/presets";
import { AutoFillUIController, IMenuManagerService, ContextMenuPosition, ContextMenuGroup, IAutoFillService, AUTO_FILL_APPLY_TYPE, IRenderManagerService, getViewportByCell, ILayoutService, ISheetClipboardService, SheetPasteShortKeyCommand, type ISheetPasteByShortKeyParams, SetRangeValuesMutation, type ISetRangeValuesMutationParams, SetRowHiddenMutation, SetRowVisibleMutation, SetRangeProtectionMutation, SetWorksheetRowCountMutation, RangeProtectionRuleModel, SheetsSelectionsService, UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import sheetsZhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import { UniverSheetsDataValidationPreset } from "@univerjs/preset-sheets-data-validation";
import { UniverSheetsFilterPreset, ReCalcSheetsFilterMutation, SetSheetsFilterRangeMutation } from "@univerjs/preset-sheets-filter";
import { UniverSheetsSortPreset, SortRangeCommand, type ISortRangeCommandParams } from "@univerjs/preset-sheets-sort";
import validationZhCN from "@univerjs/preset-sheets-data-validation/locales/zh-CN";
import filterZhCN from "@univerjs/preset-sheets-filter/locales/zh-CN";
import sortZhCN from "@univerjs/preset-sheets-sort/locales/zh-CN";
import "@univerjs/preset-sheets-data-validation/lib/index.css";
import "@univerjs/preset-sheets-filter/lib/index.css";
import "@univerjs/preset-sheets-sort/lib/index.css";

import "@univerjs/preset-sheets-core/lib/index.css";
import { literalClipboardTable } from "../business/spreadsheet-text";

export interface WorksheetColumn {
  key: string;
  title: string;
  width: number;
  editable?: boolean;
  numeric?: boolean;
  options?: readonly string[];
  multiple?: boolean;
  required?: boolean;
}
export interface WorksheetRow {
  readonly id: string;
  readonly label: string;
  readonly values: Readonly<Record<string, string>>;
  readonly locked?: boolean;
  readonly unremovable?: boolean;
  readonly readonlyFields?: readonly string[];
}
export type WorksheetValues = Readonly<Record<string, Readonly<Record<string, string>>>>;
export interface WorksheetIssue {
  row: number;
  column: number;
  cell: string;
  rowId: string;
  field: string;
  location: string;
  message: string;
}
interface WorksheetOptions {
  host: HTMLElement;
  rows: readonly WorksheetRow[];
  columns: readonly WorksheetColumn[];
  name: string;
  dark: boolean;
  primary: string;
  onChange: (entries: WorksheetValues) => void;
  onRowsChange?: (rows: readonly WorksheetRow[]) => void;
  removalLabel?: string;
  visibleRow?: (row: WorksheetRow) => boolean;
  onSelection: (text: string) => void;
  onNotice: (text: string) => void;
  onValidation: (issues: WorksheetIssue[]) => void;
  onHistory?: (status: { undos: number; redos: number }) => void;
  onVisibleCount?: (count:number) => void;
  validate: (values: WorksheetValues) => WorksheetIssue[];
  filled: (values: Readonly<Record<string, string>>) => boolean;
  describe?: (row: WorksheetRow, values: Readonly<Record<string, string>>) => string;
}
let workbookSequence = 0;
const font = 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif';
export function cellAddress(row: number, column: number) {
  let letters = "";
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26))
    letters = String.fromCharCode(65 + (n - 1) % 26) + letters;
  return letters + (row + 1);
}
function writable(row: WorksheetRow | undefined, column: WorksheetColumn | undefined) {
  return !!(row && column?.editable && !row.locked && !row.readonlyFields?.includes(column.key));
}
const rowRule = { s: BorderStyleTypes.THIN, cl: { rgb: "#e4eaf1" } };
const columnRule = { s: BorderStyleTypes.THIN, cl: { rgb: "#e0e6ed" } };
const textFormat = { n: { pattern: "@" }, bd: { b: rowRule, r: columnRule } };

function brandTheme(primary: string) {
  return { ...defaultTheme, primary: { ...defaultTheme.primary, 500: primary, 600: primary } };
}

function cellStyle(bg: string, fg: string, extra: IStyleData = {}): IStyleData {
  return {
    bg: { rgb: bg }, cl: { rgb: fg }, fs: 13, ff: font, vt: VerticalAlign.MIDDLE,
    ht: HorizontalAlign.LEFT, tb: WrapStrategy.CLIP, pd: { l: 10, r: 10, t: 2, b: 2 },
    bd: { b: rowRule }, ...extra,
  };
}

function workbookData(rows: readonly WorksheetRow[], columns: readonly WorksheetColumn[], name: string, workbookId: string, sheetId: string): IWorkbookData {
  const headers = columns.map(column => headerCell(column, column.title));
  const contents = rows.map(row => columns.map((column, index) => rowCell(row, column, index, row.values)));
  return {
    id: workbookId, appVersion: "1.6.1", locale: LocaleType.ZH_CN,
    name, sheetOrder: [sheetId],
    styles: {
      header: cellStyle("#eef2f7", "#303b4a", { bl: BooleanNumber.TRUE, bd: { b: rowRule, r: columnRule } }),
      editableHeader: cellStyle("#e8f2ff", "#174a98", { bl: BooleanNumber.TRUE, bd: { b: rowRule, r: columnRule } }),
      readonly: cellStyle("#f7f9fc", "#344054"),
      position: cellStyle("#f1f5fa", "#24334c", { bl: BooleanNumber.TRUE }),
      number: cellStyle("#f7f9fc", "#344054", { ht: HorizontalAlign.RIGHT }),
      quantity: cellStyle("#ffffff", "#14273e", { ...textFormat, ht: HorizontalAlign.RIGHT, bl: BooleanNumber.TRUE }),
      evidence: cellStyle("#ffffff", "#14273e", textFormat),
      locked: cellStyle("#eef2f7", "#505e72"),
    },
    sheets: {
      [sheetId]: {
        id: sheetId, name,
        rowCount: rows.length + 1, columnCount: columns.length,
        defaultRowHeight: 34, defaultColumnWidth: 110,
        rowHeader: { width: 36 }, columnHeader: { height: 25 },
        freeze: { ySplit: 1, xSplit: 1, startRow: 1, startColumn: 1 },
        showGridlines: BooleanNumber.TRUE, gridlinesColor: "#e0e6ed",
        rowData: { 0: { h: 38 } },
        columnData: Object.fromEntries(columns.map((column, index) => [index, { w: column.width }])),
        cellData: Object.fromEntries([headers, ...contents].map((row, index) =>
          [index, Object.fromEntries(row.map((cell, column) => [column, cell]))])),
      },
    },
  };
}

function draftCell(value: string): ICellData {
  return { v: value === "" ? null : value, t: CellValueType.STRING, p: null, f: null };
}

function headerCell(column: WorksheetColumn, title: string): ICellData {
  return { v: title, t: CellValueType.STRING, s: column.editable ? "editableHeader" : "header" };
}

function rowCell(row: WorksheetRow, column: WorksheetColumn, index: number, fields: WorksheetRow["values"]): ICellData {
  const style = writable(row, column) ? (column.numeric ? "quantity" : "evidence") :
    index === 0 ? "position" : column.numeric ? "number" : "readonly";
  return { ...draftCell(fields[column.key] ?? ""), s: style };
}

const structureCommand = /^sheet\.command\.(?:insert|remove|delete-(?:range|row|col)|move-|merge|sort|cut|reorder-|set-(?:row|col)-(?:hidden|visible))/;
type SortRule = {colIndex: number; type: "asc" | "desc"};
type StableCells = Array<{ id: string; values: Record<number, string> }>;
interface IndexedRow { index: number; row: WorksheetRow; values: WorksheetRow["values"]; }
interface RowChange { add?: IndexedRow[]; remove?: string[]; }

function compareDecimal(left: string, right: string) {
  const pattern = /^[+-]?\d+(?:\.\d+)?$/;
  if (!pattern.test(left) || !pattern.test(right)) return undefined;
  const [leftInteger, leftFraction = ""] = left.split(".");
  const [rightInteger, rightFraction = ""] = right.split(".");
  const precision = Math.max(leftFraction.length, rightFraction.length);
  const a = BigInt(leftInteger + leftFraction.padEnd(precision, "0"));
  const b = BigInt(rightInteger + rightFraction.padEnd(precision, "0"));
  return a < b ? -1 : a > b ? 1 : 0;
}

// Keep the SDK's stack, grouping, undo/redo commands and keyboard shortcuts.
// On these private workbooks, translate positional edit mutations at the point
// the native command records them. View and permission changes do not add steps.
export function createBusinessWorksheet({ host, rows: initialRows, columns, name, dark, primary, onChange, onRowsChange, removalLabel, visibleRow, onSelection, onNotice, onValidation, onHistory, onVisibleCount, validate, filled, describe }: WorksheetOptions) {
  let rows = initialRows.slice();
  let businessRows = rows;
  let rowNumbers = new Map(rows.map((row, index) => [row.id, index + 1]));
  let sort: SortRule[] = [];
  let projecting = false;
  let protectionRuleId: string | undefined;
  const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  const cellsMutationId = "business.worksheet.stable-cells";
  const rowsMutationId = "business.worksheet.rows";
  const workbookId = "business-workbook-"+(++workbookSequence);
  const sheetId = workbookId+"-sheet";
  const { univer, univerAPI } = createUniver({
    theme: brandTheme(primary), darkMode: dark, locale: LocaleType.ZH_CN,
    override: [[IUndoRedoService, {
      deps: [IUniverInstanceService, ICommandService, IContextService, IConfigService],
      useFactory: (instances: IUniverInstanceService, commands: ICommandService, contexts: IContextService, config: IConfigService) =>
        new class extends LocalUndoRedoService {
          override pushUndoRedo(item: IUndoRedoItem) {
            if (item.unitID !== workbookId) return super.pushUndoRedo(item);
            const undoMutations = stableMutations(item.undoMutations);
            const redoMutations = stableMutations(item.redoMutations);
            if (undoMutations.length && redoMutations.length) super.pushUndoRedo({ ...item, undoMutations, redoMutations });
          }
        }(instances, commands, contexts, config),
    }]],
    locales: { [LocaleType.ZH_CN]: mergeLocales(sheetsZhCN,validationZhCN,filterZhCN,sortZhCN) },
    presets: [UniverSheetsCorePreset({
      container: host, header: false, toolbar: false, formulaBar: false, footer: false,
      contextMenu: Boolean(onRowsChange), disableTextFormatAlert: true, disableTextFormatMark: true,
      sheets: {
        enableFillHandle: true, selectionAnimation: false, protectedRangeShadow: "none",
        clipboardConfig: { hidePasteOptions: true },
        disableForceStringMark: true, disableForceStringAlert: true,
      },
    }),UniverSheetsDataValidationPreset({showEditOnDropdown:false,showSearchOnDropdown:true}),UniverSheetsFilterPreset(),UniverSheetsSortPreset()],
  });
  const subscriptions: Array<{ dispose(): void }> = [];
  const rendered = new Promise<void>(resolve => {
    subscriptions.push(univerAPI.addEvent(univerAPI.Event.LifeCycleChanged, event => {
      // Rendered has registered the native editing, selection and clipboard controllers.
      // Steady is a deferred background phase (3 seconds in Univer 1.6.1), not a rendering gate.
      if (event.stage >= LifecycleStages.Rendered) requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
  });
  const book = univerAPI.createWorkbook(workbookData(rows, columns, name, workbookId, sheetId));
  const sheet = book.getActiveSheet();
  const identity = { unitId: workbookId, subUnitId: sheetId };
  function stableMutations(mutations: IMutationInfo[]): IMutationInfo[] {
    return mutations.flatMap(mutation => {
      if (mutation.id === rowsMutationId) return [mutation];
      if (mutation.id !== SetRangeValuesMutation.id) return [];
      const params = mutation.params as ISetRangeValuesMutationParams;
      if (params.subUnitId !== sheetId || !params.cellValue) return [];
      const cells: StableCells = [];
      for (const [index, values] of Object.entries(params.cellValue as Record<number, Record<number, ICellData | null>>)) {
        const row = rows[Number(index) - 1];
        if (!row || !values) continue;
        const editable: Record<number, string> = {};
        for (const [key, cell] of Object.entries(values)) {
          const column = Number(key);
          if (writable(row, columns[column]) && (cell === null || Object.hasOwn(cell, "v"))) {
            editable[column] = String(cell?.v ?? "");
          }
        }
        if (Object.keys(editable).length) cells.push({ id: row.id, values: editable });
      }
      return cells.length ? [{ id: cellsMutationId, params: cells }] : [];
    });
  }
  const cellsMutation: IMutation<StableCells, boolean> = {
    id: cellsMutationId, type: CommandType.MUTATION,
    handler(_, patch) {
      const cellValue: NonNullable<ISetRangeValuesMutationParams["cellValue"]> = {};
      for (const change of patch) {
        const row = rowNumbers.get(change.id);
        if (row === undefined) return false;
        cellValue[row] = Object.fromEntries(Object.entries(change.values).map(([column, value]) => [column, draftCell(value)]));
      }
      return univerAPI.syncExecuteCommand(SetRangeValuesMutation.id, { ...identity, cellValue });
    },
  };
  const rowsMutation: IMutation<RowChange, boolean> = {
    id: rowsMutationId, type: CommandType.MUTATION,
    handler(_, change) { return changeRows(change); },
  };
  const commands = univer.__getInjector().get(ICommandService);
  subscriptions.push(commands.registerCommand(cellsMutation), commands.registerCommand(rowsMutation));
  // Univer's single-list widget opens its dropdown on any pointer hit.
  // Reserve the native dropdown for the arrow; ordinary cell selection must
  // leave the sheet keyboard focus and the fill handle available.
  let pointer: {x:number;y:number}|undefined;
  const recordPointer=(event:PointerEvent)=>{pointer={x:event.clientX,y:event.clientY}};
  const clearPointer=()=>{pointer=undefined};
  host.addEventListener("pointerdown",recordPointer,true);
  host.addEventListener("pointerup",clearPointer,true);
  host.addEventListener("pointercancel",clearPointer,true);
  subscriptions.push({dispose(){
    host.removeEventListener("pointerdown",recordPointer,true);
    host.removeEventListener("pointerup",clearPointer,true);
    host.removeEventListener("pointercancel",clearPointer,true);
  }});

  // Univer renders only the configured sheet columns/rows, but its canvas
  // spans the host. Wheel over unused canvas must reach the surrounding form;
  // wheel over real cells remains local, including at a scroll boundary.
  function routeBlankWheel(event: WheelEvent) {
    if (event.ctrlKey || event.metaKey || !rows.length || !columns.length) return;
    const render=univer.__getInjector().get(IRenderManagerService).getRenderUnitById(book.getId());
    const canvas=render?.engine.getCanvasElement();
    const viewport=render&&getViewportByCell(1,columns.length-1,render.scene,sheet.getSheet());
    if(!render||!canvas||!viewport)return;
    const bounds=canvas.getBoundingClientRect();
    const zoom=render.scene.getAncestorScale();
    const scale=bounds.width/(parseFloat(canvas.style.width)||bounds.width);
    const last=sheet.getRange(1,columns.length-1).getCellRect();
    const right=bounds.left+(last.right-viewport.viewportScrollX)*scale*zoom.scaleX;
    // Do not intercept the native vertical scrollbar or column/row headers.
    if(event.clientX<=right+1 || event.clientX>=bounds.right-14 ||
       event.clientY<bounds.top+25*scale || event.clientY>=bounds.bottom-14)return;
    event.stopImmediatePropagation();
    event.preventDefault();
    for(let parent=host.parentElement;parent;parent=parent.parentElement){
      const style=getComputedStyle(parent);
      if(!/(auto|scroll)/.test(style.overflowY)||parent.scrollHeight<=parent.clientHeight+1)continue;
      const multiplier=event.deltaMode===1?16:event.deltaMode===2?parent.clientHeight:1;
      const before=parent.scrollTop;
      parent.scrollTop+=event.deltaY*multiplier;
      if(parent.scrollTop!==before)return;
    }
  }
  host.addEventListener("wheel",routeBlankWheel,{capture:true,passive:false});
  subscriptions.push({dispose(){host.removeEventListener("wheel",routeBlankWheel,true);}});

  const history = univer.__getInjector().get(IUndoRedoService);
  const historySubscription = history.undoRedoStatus$.subscribe(() => onHistory?.(history.getUndoRedoStatus(book.getId())));
  subscriptions.push({dispose: () => historySubscription.unsubscribe()});
  const selection = () => sheet.getSelection()?.getActiveRange()?.getRange();
  function selectedRowIds(forRemoval = false): string[] {
    const filtered = filteredRows();
    const ranges=sheet.getSelection()?.getActiveRangeList().map(range=>range.getRange())??[];
    const ids=new Set<string>();
    for(const range of ranges){
      // A column or whole-sheet selection includes the business header;
      // never treat that gesture as an implicit request to remove all rows.
      if(range.startRow===0)continue;
      for(let r=Math.max(1,range.startRow);r<=Math.min(rows.length,range.endRow);r++)
        if (!hiddenRows.has(r) && !filtered.has(r) && !rows[r - 1].locked && !(forRemoval && rows[r - 1].unremovable)) ids.add(rows[r - 1].id);
    }
    return [...ids];
  }
  async function removeSelectedRows(){
    if (!onRowsChange || disposed) return;
    const ids = selectedRowIds(true);
    if (!ids.length) { onNotice("请先选择明细行，再执行「" + (removalLabel ?? "移除选中行") + "」"); return; }
    await finishEditing();
    if (disposed) return;
    readEntries();
    const filtered = filteredRows();
    const remove = ids.filter(id => {
      const index = rowNumbers.get(id);
      return index !== undefined && !hiddenRows.has(index) && !filtered.has(index) && !rows[index - 1].locked && !rows[index - 1].unremovable;
    });
    if (!remove.length) return;
    const removed = new Set(remove);
    const add = businessRows.flatMap((row, index) => removed.has(row.id)
      ? [{ index, row, values: entries[row.id] }] : []);
    recordRows({ remove }, { add });
  }

  let entries: WorksheetValues = Object.fromEntries(rows.map(row => [row.id, { ...row.values }]));
  let disposed = false;
  let filledOnly = false;
  let hiddenRows = new Set<number>();
  let validated = false;
  let initialized=false;
  let flash = false;
  let flashTimers: number[] = [];
  const errorCells = new Set<string>();

  const filter=()=>sheet.getFilter();
  const filteredRows=()=>new Set(filter()?.getFilteredOutRows()??[]);
  const isHidden=(row:number)=>hiddenRows.has(row)||filteredRows().has(row);
  function reportVisible(){
    const allHidden=new Set([...hiddenRows,...filteredRows()]);
    onVisibleCount?.(rows.length-allHidden.size);
  }
  function restrict(row: number, column: number) {
    return writable(rows[row - 1], columns[column]) ? "" : "该单元格为只读信息";
  }

  subscriptions.push(univerAPI.registerCellCustomRender([{
    drawWith(ctx, { row, col, primaryWithCoord }) {
      if (!errorCells.has(row + ":" + col)) return;
      const { startX, startY, endX, endY } = primaryWithCoord;
      ctx.fillStyle = flash ? "rgba(240, 73, 90, .34)" : "rgba(240, 73, 90, .18)";
      ctx.fillRect(startX + 1, startY + 1, endX - startX - 2, endY - startY - 2);
      ctx.fillStyle = "#d44756";
      ctx.beginPath();
      ctx.moveTo(endX - 2, startY + 2);
      ctx.lineTo(endX - 10, startY + 2);
      ctx.lineTo(endX - 2, startY + 10);
      ctx.fill();
    },
  }]));

  function stopFlashing() {
    for (const timer of flashTimers) window.clearTimeout(timer);
    flashTimers = [];
    flash = false;
  }

  function showValidation(issues: WorksheetIssue[]) {
    if (!issues.length) stopFlashing();
    errorCells.clear();
    for (const item of issues) errorCells.add(item.row + ":" + item.column);
    onValidation(issues);
    sheet.refreshCanvas();
  }

  function focusCell(row: number, column: number, restoreKeyboard = false) {
    if (isHidden(row)) { filledOnly = false; filter()?.removeFilterCriteria(); updateVisibleRows(); }
    const cell = sheet.getRange(row, column);
    sheet.setActiveRange(cell);
    onNotice("");
    updateSelection(cell.getRange());
    void univerAPI.executeCommand("sheet.operation.scroll-to-range", { unitId: book.getId(), range: cell.getRange() });
    if (restoreKeyboard) {
      // A validation link lives outside Univer. Transfer keyboard input to the
      // SDK's own registered sheet editor after selecting the invalid cell.
      host.scrollIntoView({ block: "nearest" });
      univer.__getInjector().get(ILayoutService).focus(book.getId());
    }
  }

  function flashValidation() {
    stopFlashing();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    flash = true;
    sheet.refreshCanvas();
    for (const delay of [170, 340, 550]) {
      flashTimers.push(window.setTimeout(() => {
        flash = !flash;
        sheet.refreshCanvas();
      }, delay));
    }
  }

  function updateVisibleRows() {
    const next = new Set<number>();
    if (visibleRow || filledOnly) rows.forEach((row, index) => {
      if ((visibleRow && !visibleRow(row)) || (filledOnly && !filled(entries[row.id] ?? {}))) next.add(index + 1);
    });
    const scope = (indexes: number[]) => indexes.map(row =>
      ({ startRow: row, endRow: row, startColumn: 0, endColumn: columns.length - 1 }));
    const show = [...hiddenRows].filter(row => !next.has(row));
    const hide = [...next].filter(row => !hiddenRows.has(row));
    hiddenRows = next;
    const identity = { unitId: book.getId(), subUnitId: sheetId };
    if (show.length) univerAPI.syncExecuteCommand(SetRowVisibleMutation.id, { ...identity, ranges: scope(show) });
    if (hide.length) univerAPI.syncExecuteCommand(SetRowHiddenMutation.id, { ...identity, ranges: scope(hide) });
    reportVisible();
  }

  function updateSelection(range = selection()) {
    const position = range && rows[range.startRow - 1];
    if (!range || !position) return onSelection("选中单元格开始录入");
    const size = rowIndexes(range.startRow, range.endRow).length * (range.endColumn - range.startColumn + 1);
    if (size > 1) return onSelection("已选 " + size + " 个单元格");
    if (restrict(range.startRow, range.startColumn)) return onSelection("所选单元格为只读信息");
    onSelection(describe?.(position, entries[position.id] ?? {}) ?? position.label);
  }

  const editableColumns = columns.flatMap((column, index) => column.editable ? [{ column, index }] : []);

  function readEntries() {
    const changed = new Map<string, Record<string, string>>();
    for (const { column, index } of rows.length ? editableColumns : []) {
      const values = sheet.getRange(1, index, rows.length, 1).getValues();
      for (const [rowIndex, row] of rows.entries()) {
        if (!writable(row, column)) continue;
        const value = String(values[rowIndex][0] ?? "");
        if (value === (entries[row.id][column.key] ?? "")) continue;
        const fields = changed.get(row.id) ?? { ...entries[row.id] };
        fields[column.key] = value;
        changed.set(row.id, fields);
      }
    }
    if (changed.size) {
      entries = { ...entries, ...Object.fromEntries(changed) };
    }
    return publishEntries();
  }

  function publishEntries() {
    const errors = validate(entries).flatMap(issue => {
      const row = rowNumbers.get(issue.rowId);
      return row === undefined ? [] : [{ ...issue, row, cell: cellAddress(row, issue.column) }];
    });
    if (validated) showValidation(errors);
    else {
      errorCells.clear();
      for (const issue of errors) errorCells.add(issue.row + ":" + issue.column);
      sheet.refreshCanvas();
    }
    onChange(entries);
    updateVisibleRows();
    updateSelection();
    return errors;
  }

  function rowIndexes(first: number, last: number) {
    const indexes: number[] = [];
    const filtered=filteredRows();
    for (let index = first; index <= Math.min(last, rows.length); index++) {
      if (!hiddenRows.has(index)&&!filtered.has(index)) indexes.push(index);
    }
    return indexes;
  }

  // Native clipboard owns selection, permission checks, writes and history.
  // Business sheets have a fixed identity/shape; never allow automatic expansion.
  subscriptions.push(univer.__getInjector().get(ISheetClipboardService).addClipboardHook({
    id: "business-fixed-range",
    priority: 1000,
    onBeforePaste({range}) {
      const filtered=filteredRows();
      if(range.rows.some(row=>hiddenRows.has(row)||filtered.has(row))||(range.rows.length>1&&(hiddenRows.size||filtered.size))){
        onNotice("筛选后仅允许单行粘贴，请先清除筛选再批量粘贴");
        return false;
      }
      if (range.rows.some(row => row < 1 || row > rows.length) ||
          range.cols.some(col => col < 0 || col >= columns.length)) {
        onNotice("粘贴超出工作表范围，本次未修改任何单元格");
        return false;
      }
      return true; // Native protection rejects any read-only target atomically.
    },
  }));

  subscriptions.push(
    book.onSelectionChange(ranges => updateSelection(ranges.at(-1))),
    univerAPI.addEvent(univerAPI.Event.CellPointerDown, () => onNotice("")),
    univerAPI.addEvent(univerAPI.Event.SelectionChanged, event => updateSelection(event.selections.at(-1))),
    univerAPI.addEvent(univerAPI.Event.SheetValueChanged, () => { if (initialized && !projecting) readEntries(); }),
    univerAPI.addEvent(univerAPI.Event.SheetRangeFiltered, reportVisible),
    univerAPI.addEvent(univerAPI.Event.SheetRangeFilterCleared, reportVisible),
    univerAPI.addEvent(univerAPI.Event.BeforeSheetEditStart, event => {
      const message = restrict(event.row, event.column);
      if (message) {
        event.cancel = true;
        onNotice(message);
      } else onNotice("");
    }),
    univerAPI.addEvent(univerAPI.Event.BeforeCommandExecute, event => {
      if(initialized&&!projecting&&/^(?:sheets?\.command\..*data-validation|sheet\.operation\.open-validation-panel)/.test(event.id)){
        event.cancel=true;return;
      }
      if(event.id==="sheet.operation.show-data-validation-dropdown"&&pointer){
        const target=event.params as {row:number;column:number};
        const rect=sheet.getRange(target.row,target.column).getCellRect();
        const render=univer.__getInjector().get(IRenderManagerService).getRenderUnitById(book.getId());
        const viewport=render&&getViewportByCell(target.row,target.column,render.scene,sheet.getSheet());
        const canvas=render?.engine.getCanvasElement();
        if(!render||!viewport||!canvas){event.cancel=true;return;}
        const bounds=canvas.getBoundingClientRect();
        const zoom=render.scene.getAncestorScale();
        const scale=bounds.width/(parseFloat(canvas.style.width)||bounds.width);
        const right=bounds.left+(rect.right-viewport.viewportScrollX)*scale*zoom.scaleX;
        const bottom=bounds.top+(rect.bottom-viewport.viewportScrollY)*scale*zoom.scaleY;
        // Convert the sheet coordinates to client coordinates, including freeze and scroll.
        // Reserve the corner for the fill handle, not the dropdown.
        if(pointer.x<right-29*scale||pointer.x>right-5*scale||pointer.y>bottom-5*scale){
          event.cancel=true;return;
        }
      }
      // The native row-delete menu dispatches this command. Cancel the
      // sheet mutation; business identity removal is the only permitted effect.
      if(event.id==="sheet.command.remove-row-confirm"||event.id==="sheet.command.remove-row"){
        event.cancel=true;
        if (onRowsChange) queueMicrotask(() => void removeSelectedRows());
        return;
      }
      if(event.id===SortRangeCommand.id){
        event.cancel=true;
        const { orderRules } = event.params as ISortRangeCommandParams;
        if (orderRules?.length && orderRules.every(rule => columns[rule.colIndex])) {
          queueMicrotask(() => void sortRows(orderRules));
        }
        return;
      }
      if((hiddenRows.size||filteredRows().size)&&/sheet\.command\.(?:auto-fill|refill|clear-selection-content|clear-selection-all)/.test(event.id)){
        const range=selection();
        if(/auto-fill|refill/.test(event.id)||range&&range.startRow!==range.endRow){
          event.cancel=true;onNotice("请先清除筛选再进行跨行填充或清除");return;
        }
      }
      if (structureCommand.test(event.id)) {
        event.cancel = true;
        return;
      }
      if (event.id === SheetPasteShortKeyCommand.id) {
        const params = event.params as ISheetPasteByShortKeyParams;
        if (typeof params.textContent !== "string" || (!params.textContent && !params.htmlContent)) return;
        const html = literalClipboardTable(params.textContent);
        if (!html) {
          event.cancel = true;
          onNotice("剪贴板内容不是完整的表格区域");
          return;
        }
        // Feed literal values to the native paste command, not a second writer.
        // In particular, its single-text path otherwise evaluates "=" and parses numbers.
        params.htmlContent = html;
        params.formulaClipboardPayload = undefined;
        params.files = undefined;
      }
      if (event.id === SetRangeValuesMutation.id) {
        const params = event.params as ISetRangeValuesMutationParams;
        if (params.unitId !== book.getId() || params.subUnitId !== sheetId) return;
        const valueOnlyPaste = params.trigger === SheetPasteShortKeyCommand.id && params.isOverrideStyle;
        if (valueOnlyPaste) params.isOverrideStyle = false;
        // The native formula clipboard hook independently emits formula mutations
        // even for cells formatted as text. Normalize those values before execution.
        for (const row of Object.values((params.cellValue ?? {}) as Record<string, Record<string, ICellData | null>>)) {
          for (const cell of Object.values(row)) {
            if (!cell) continue;
            if (valueOnlyPaste) delete cell.s;
            if (typeof cell.f === "string" && cell.f) {
              Object.assign(cell, draftCell(cell.f), {si:null,ft:null,fd:null});
            }
          }
        }
      }
    }),
  );

  function columnRanges(column: WorksheetColumn, index: number, editable: boolean): IRange[] {
    const ranges: IRange[] = [];
    let start = -1;
    for (let i = 0; i <= rows.length; i++) {
      const matches = i < rows.length && writable(rows[i], column) === editable;
      if (matches && start < 0) start = i;
      if (!matches && start >= 0) {
        ranges.push({ startRow: start + 1, endRow: i, startColumn: index, endColumn: index });
        start = -1;
      }
    }
    return ranges;
  }

  const lockedRanges = () => [
    { startRow: 0, endRow: 0, startColumn: 0, endColumn: columns.length - 1 },
    ...columns.flatMap((column, index) => columnRanges(column, index, false)),
  ];
  const toSheetRange = (range: IRange) => sheet.getRange(range.startRow, range.startColumn,
    range.endRow - range.startRow + 1, range.endColumn - range.startColumn + 1);
  const protectedRanges = sheet.getWorksheetPermission().protectRanges([{
    ranges: lockedRanges().map(toSheetRange),
    options: { name: "业务只读信息", allowViewByOthers: true },
  }]).then(async ([rule]) => {
    if (disposed) return;
    await rule.setPoint(univerAPI.Enum.RangePermissionPoint.Edit, false);
    protectionRuleId = rule.id;
  });

  function refreshDropdowns() {
    for (const rule of sheet.getDataValidations()) rule.delete();
    for (const [index, column] of columns.entries()) {
      if (!column.options?.length || !column.editable) continue;
      const ranges = columnRanges(column, index, true).map(toSheetRange);
      if (!ranges.length) continue;
      const rule = univerAPI.newDataValidation().requireValueInList([...column.options], column.multiple ?? false, true)
        .setAllowBlank(!column.required).setAllowInvalid(true).build();
      ranges[0].setDataValidation(rule);
      if (ranges.length > 1) ranges[0].getDataValidation()?.setRanges(ranges);
    }
  }

  function projectRows() {
    const oldRows = rows;
    const selections = univer.__getInjector().get(SheetsSelectionsService);
    const previous = selections.getCurrentSelections();
    const input = businessRows.slice();
    if (sort.length) input.sort((a, b) => {
      for (const { colIndex, type } of sort) {
        const column = columns[colIndex];
        const av = entries[a.id][column.key] ?? "", bv = entries[b.id][column.key] ?? "";
        if (!av || !bv) { if (av !== bv) return av ? -1 : 1; continue; }
        const result = (column.numeric ? compareDecimal(av, bv) : undefined) ?? collator.compare(av, bv);
        if (result) return type === "asc" ? result : -result;
      }
      return 0;
    });

    projecting = true;
    try {
      const allColumns = { startColumn: 0, endColumn: columns.length - 1 };
      if (hiddenRows.size) {
        univerAPI.syncExecuteCommand(SetRowVisibleMutation.id, { ...identity, ranges: [...hiddenRows].map(row =>
          ({ ...allColumns, startRow: row, endRow: row })) });
        hiddenRows = new Set();
      }
      rows = input;
      rowNumbers = new Map(rows.map((row, index) => [row.id, index + 1]));
      refreshSheetData(oldRows.length);
      const model = univer.__getInjector().get(RangeProtectionRuleModel);
      const rule = protectionRuleId && model.getRule(workbookId, sheetId, protectionRuleId);
      if (rule) univerAPI.syncExecuteCommand(SetRangeProtectionMutation.id, {
        ...identity, ruleId: rule.id, rule: { ...rule, ranges: lockedRanges() },
      });
      refreshDropdowns();
      univerAPI.syncExecuteCommand(SetSheetsFilterRangeMutation.id, { ...identity, range: {
        ...allColumns, startRow: 0, endRow: rows.length,
      } });
      univerAPI.syncExecuteCommand(ReCalcSheetsFilterMutation.id, identity);
      updateVisibleRows();
      const filtered = filteredRows();
      const next = previous.flatMap(({ range, primary, style }) => {
        if (range.startRow === 0) return [];
        const selected = oldRows.slice(range.startRow - 1, range.endRow)
          .map(row => rowNumbers.get(row.id)).filter((row): row is number => row !== undefined && !hiddenRows.has(row) && !filtered.has(row))
          .sort((a, b) => a - b);
        const segments: IRange[] = [];
        for (const row of selected) {
          const last = segments.at(-1);
          if (last?.endRow === row - 1) last.endRow = row;
          else segments.push({ ...range, startRow: row, endRow: row });
        }
        return segments.map(segment => ({
          range: segment, style, primary: primary && {
            ...segment, endRow: segment.startRow, endColumn: segment.startColumn,
            actualRow: segment.startRow, actualColumn: segment.startColumn, isMerged: false, isMergedMainCell: false,
          },
        }));
      });
      if (next.length) selections.setSelections(workbookId, sheetId, next);
      else {
        const first = rows.findIndex((_, index) => !hiddenRows.has(index + 1) && !filtered.has(index + 1));
        sheet.setActiveRange(sheet.getRange(first + 1, 0));
      }
      sheet.refreshCanvas();
    } finally {
      projecting = false;
    }
  }

  function refreshSheetData(previousLength: number) {
    if (rows.length > previousLength) {
      univerAPI.syncExecuteCommand(SetWorksheetRowCountMutation.id, { ...identity, rowCount: rows.length + 1 });
    }
    const cellValue: NonNullable<ISetRangeValuesMutationParams["cellValue"]> = {};
    cellValue[0] = Object.fromEntries(columns.map((column, index) => {
      const order = sort.find(rule => rule.colIndex === index)?.type;
      return [index, headerCell(column, column.title + (order ? (order === "asc" ? " ↑" : " ↓") : ""))];
    }));
    for (const [index, row] of rows.entries()) {
      cellValue[index + 1] = Object.fromEntries(columns.map((column, col) => [col, rowCell(row, column, col, entries[row.id])]));
    }
    for (let index = rows.length + 1; index <= previousLength; index++) {
      cellValue[index] = Object.fromEntries(columns.map((_, col) => [col, null]));
    }
    univerAPI.syncExecuteCommand(SetRangeValuesMutation.id, { ...identity, cellValue });
    if (rows.length < previousLength) {
      univerAPI.syncExecuteCommand(SetWorksheetRowCountMutation.id, { ...identity, rowCount: rows.length + 1 });
    }
  }

  async function sortRows(rules: SortRule[]) {
    await finishEditing();
    if (disposed) return;
    readEntries();
    sort = rules;
    projectRows();
    publishEntries();
    onNotice("已按 " + rules.map(rule => columns[rule.colIndex].title + (rule.type === "asc" ? " 升序" : " 降序")).join("、") + " 排列");
  }

  function changeRows({ add = [], remove = [] }: RowChange) {
    if (!onRowsChange || disposed) return false;
    const removed = new Set(remove);
    const next = businessRows.filter(row => !removed.has(row.id));
    const draft = { ...entries };
    for (const id of remove) delete draft[id];
    for (const { row, index, values } of add) {
      next.splice(index, 0, row);
      draft[row.id] = values;
    }
    businessRows = next;
    entries = draft;
    projectRows();
    onRowsChange(next);
    publishEntries();
    return true;
  }

  function recordRows(redo: RowChange, undo: RowChange) {
    if (!univerAPI.syncExecuteCommand(rowsMutationId, redo)) return false;
    history.pushUndoRedo({
      unitID: workbookId, undoMutations: [{ id: rowsMutationId, params: undo }],
      redoMutations: [{ id: rowsMutationId, params: redo }],
    });
    return true;
  }

  async function addRows(newRows: readonly WorksheetRow[]) {
    if (!onRowsChange) return false;
    await finishEditing();
    if (disposed) return false;
    const known = new Set(businessRows.map(row => row.id));
    const additions = newRows.filter(row => {
      if (known.has(row.id)) return false;
      known.add(row.id);
      return true;
    });
    if (!additions.length) return false;
    readEntries();
    return recordRows({ add: additions.map((row, index) => ({ row, index: businessRows.length + index, values: { ...row.values } })) },
      { remove: additions.map(row => row.id) });
  }

  async function replaceRowReferences(replacements: readonly WorksheetRow[]) {
    if (!onRowsChange || disposed) return false;
    await finishEditing();
    if (disposed) return false;
    readEntries();
    const byId = new Map(replacements.map(row => [row.id, row]));
    const undo: IndexedRow[] = [], redo: IndexedRow[] = [];
    businessRows.forEach((row, index) => {
      const replacement = byId.get(row.id);
      if (!replacement || isHidden(rowNumbers.get(row.id)!) || row.locked) return;
      const current = entries[row.id];
      const values = { ...replacement.values };
      for (const column of columns) if (writable(row, column) && writable(replacement, column))
        values[column.key] = current[column.key] ?? "";
      undo.push({ index, row, values: current });
      redo.push({ index, row: replacement, values });
    });
    if (!redo.length) return false;
    const remove = redo.map(({ row }) => row.id);
    return recordRows({ remove, add: redo }, { remove, add: undo });
  }

  async function finishEditing() {
    if (book.isCellEditing()) await book.endEditingAsync(true);
  }

  return {
    ready: Promise.all([rendered, protectedRanges]).then(() => {
      if (disposed) return;
      // Univer defers this native controller to Steady. Resolve the registered singleton
      // now so drag-to-fill is available from the first editable frame. The later
      // onSteady hook resolves the same singleton, without installing duplicate hooks.
      univer.__getInjector().get(AutoFillUIController);
      // Dictionary text such as 35kV is a category, never a numeric series.
      // Keep native autofill transaction/history; apply the native copy mode.
      const autoFill=univer.__getInjector().get(IAutoFillService);
      // The SDK exposes registered hooks. Disable only the metadata-copy callbacks
      // on this private instance, not the dropdown renderer or business validator.
      const clipboard=univer.__getInjector().get(ISheetClipboardService);
      const metadataPaste=clipboard.getClipboardHooks().find(hook=>hook.id==="SHEET_DATA_VALIDATION_PLUGIN");
      if(metadataPaste)metadataPaste.onPasteCells=()=>({redos:[],undos:[]});
      const metadataFill=()=> {
        const hook=autoFill.getAllHooks().find(item=>item.id==="SHEET_DATA_VALIDATION_PLUGIN");
        if(hook)hook.disable=()=>true;
      };
      metadataFill();
      subscriptions.push(univerAPI.addEvent(univerAPI.Event.LifeCycleChanged,event=>{
        if(event.stage>=LifecycleStages.Steady)metadataFill();
      }));

      subscriptions.push(autoFill.addHook({
        id:"business-dictionary-fill",
        onBeforeFillData(location){
          if([...location.source.cols,...location.target.cols].some(col=>columns[col]?.options?.length)){
            autoFill.setDisableApplyType(AUTO_FILL_APPLY_TYPE.SERIES,true);
            autoFill.setDisableApplyType(AUTO_FILL_APPLY_TYPE.ONLY_FORMAT,true);
            return AUTO_FILL_APPLY_TYPE.COPY;
          }
          autoFill.setDisableApplyType(AUTO_FILL_APPLY_TYPE.ONLY_FORMAT,true);
        },
      }));

      refreshDropdowns();
      if (onRowsChange) {
        // Retain the SDK's own context menu and delete-row item. Other context
        // commands can change the protected workbook schema, so hide them.
        const manager=univer.__getInjector().get(IMenuManagerService);
        const removeRowId="sheet.command.remove-row-confirm";
        const nativeRowItem=()=> {
          const item=manager.getFlatMenuByPositionKey(ContextMenuPosition.ROW_HEADER).find(node=>node.item?.id===removeRowId)?.item;
          if(!item)throw Error("Univer 原生删除行菜单未注册");
          return item;
        };
        // Reuse the row-header command, icon, locale and native menu renderer;
        // replace the cell menu's layout group rather than add a nested submenu.
        manager.mergeMenu({
          [ContextMenuPosition.MAIN_AREA]:{
            [ContextMenuGroup.LAYOUT]:{replace:true,order:1,[removeRowId]:{order:0,menuItemFactory:nativeRowItem}},
          },
        });
        const allowed=new Set([removeRowId]);
        const config:Record<string,{hidden:boolean;disabled?:boolean}>={};
        for(const position of [ContextMenuPosition.MAIN_AREA,ContextMenuPosition.ROW_HEADER,ContextMenuPosition.COL_HEADER])
          for(const node of manager.getFlatMenuByPositionKey(position))
            if(node.item)config[node.item.id]=allowed.has(node.item.id)?{hidden:false,disabled:false}:{hidden:true};
        manager.updateMenuConfig(config);
      }
      // Header-only sheets also need a native filter model so the first add
      // can extend its range without creating a new workbook or history.
      const filterCreated = univerAPI.syncExecuteCommand(SetSheetsFilterRangeMutation.id, {
        ...identity, range: { startRow: 0, endRow: rows.length, startColumn: 0, endColumn: columns.length - 1 },
      });
      if (!filterCreated) throw Error("工作表原生筛选初始化失败");
      const index = rows.findIndex(row => columns.some(column => writable(row, column)));
      if (index >= 0) sheet.setActiveRange(sheet.getRange(index + 1, columns.findIndex(column => writable(rows[index], column))));
      initialized = true;
      publishEntries();
    }),
    finishEditing,
    selectedRowIds, removeSelectedRows, addRows, replaceRowReferences,
    isEditing: () => book.isCellEditing(),
    async prepareSave() {
      await finishEditing();
      validated = true;
      onNotice("");
      const errors = readEntries();
      if (errors.length) {
        focusCell(errors[0].row, errors[0].column);
        flashValidation();
        return null;
      }
      return entries;
    },
    focusCell,
    focusField(id: string, field: string) {
      const row = rowNumbers.get(id);
      if (row === undefined) return false;
      const column = columns.findIndex(item => item.key === field);
      const target = column < 0 ? columns.findIndex(item => item.editable) : column;
      focusCell(row, Math.max(0, target), true);
      return true;
    },
    filterFilled(value: boolean) { filledOnly = value; updateVisibleRows(); },
    setRowVisibility(predicate?: WorksheetOptions["visibleRow"]) {
      visibleRow = predicate;
      updateVisibleRows();
    },
    clearFilters(){filledOnly=false;filter()?.removeFilterCriteria();updateVisibleRows();},
    fillColumn(field: string, value: (row: WorksheetRow) => string, label: string) {
      const range = selection();
      const column = columns.findIndex(item => item.key === field);
      if (!range || column < 0 || range.startColumn !== column || range.endColumn !== column) {
        onNotice("请先选择「" + label + "」列中的位置");
        return;
      }
      if (range.startRow < 1 || range.endRow > rows.length ||
          rowIndexes(range.startRow, range.endRow).length !== range.endRow - range.startRow + 1 ||
          Array.from({length:range.endRow-range.startRow+1},(_,i)=>range.startRow+i).some(row=>restrict(row,column))) {
        onNotice("选区包含只读或隐藏位置，请选择连续可填写单元格");
        return;
      }
      const values = rows.slice(range.startRow-1,range.endRow).map(row => [draftCell(value(row))]);
      sheet.getRange(range.startRow,column,values.length,1).setValues(values);
      onNotice("");
    },
    async undo() {
      await finishEditing();
      onNotice("");
      univer.__getInjector().get(ILayoutService).focus(book.getId());
      await univerAPI.undo();
    },
    async redo() {
      await finishEditing();
      onNotice("");
      univer.__getInjector().get(ILayoutService).focus(book.getId());
      await univerAPI.redo();
    },
    theme(darkMode: boolean, color: string) {
      univerAPI.setTheme(brandTheme(color));
      univerAPI.toggleDarkMode(darkMode);
      sheet.refreshCanvas();
    },
    dispose() {
      disposed = true;
      stopFlashing();
      for (const listener of subscriptions) listener.dispose();
      univer.dispose();
    },
  };
}
