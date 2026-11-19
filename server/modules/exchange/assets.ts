import { authorize, id, now, digest } from "../../platform/auth/service.js";
import { requireValue, expectedVersion } from "../../shared/errors/business-error.js";
import { createReferences } from "./references.js";
import type { System } from "../../bootstrap.js";
import type { Actor } from "../../shared/types/contracts.js";
import type { EquipmentRecord } from "../../shared/types/equipment.js";
import type { EquipmentCatalogKind } from "../../shared/types/equipment.js";
import { BusinessError } from "../../shared/errors/business-error.js";
import type { ParsedWorkbook, WorkbookRow, AssetPreviewDocument, AssetPrepareResult, AssetExchangeKind, ExchangeMode, ExchangePreviewOptions, ExchangeExportOptions, AssetPreviewChange } from "../../shared/types/exchange.js";
import {
  parseWorkbook,
  makeWorkbook,
  makeBusinessReport,
  issue,
  MAX_DOCUMENTS,
} from "./workbook.js";

export function createAssetExchange(system: System) {
  const { catalog, exchangePersistence, equipment } = system;
  const physicalKeys = catalog.definitions.physical.fields
    .map((field) => field.key as keyof EquipmentRecord)
    .filter((key) => key !== "status");
  function towerDictionaryId(field:"tower_material"|"tower_nature",fact:unknown):string|null {
    if(fact===undefined || fact===null || fact==="")return null;
    requireValue(typeof fact==="string",field==="tower_material"?"杆塔材质必须选择基础数据":"杆塔性质必须选择基础数据");
    const kind=field==="tower_material"?"tower_materials":"tower_natures";
    const matching=catalog.list(kind,true).filter(row=>
      row.id===fact || row.code===fact || row.name===fact);
    requireValue(matching.length===1,field==="tower_material"?"杆塔材质在基础数据中不存在或不唯一":"杆塔性质在基础数据中不存在或不唯一");
    const selected=matching[0];
    requireValue(selected.status==="active",field==="tower_material"?"杆塔材质已停用":"杆塔性质已停用");
    return selected.id;
  }
  function normalizedTowerFields(row:WorkbookRow):WorkbookRow {
    const result={...row};
    for(const key of ["tower_material","tower_nature"] as const)
      if(result[key]!==undefined) result[key]=towerDictionaryId(key,result[key]);
    return result;
  }
  function resolveEquipment(kind:EquipmentCatalogKind, key:string|null|undefined, includeDeleted=false):EquipmentRecord {
    requireValue(typeof key==="string" && key.length>0,"设备正式身份不存在",404);
    return equipment.get(kind,key,includeDeleted);
  }
  // Resolve human business labels only at execution time. Earlier rows in
  // the same workbook may create the referenced line or tower transactionally.
  function input(document:Pick<AssetPreviewDocument,"kind"|"payload">):WorkbookRow {
    const row = document.payload,
      refs = createReferences(system);
    const values:WorkbookRow = { ...row, expected_version: row.expected_version };
    if (document.kind === "physical") {
      // A physical entity has no parent line; identity remains server-owned.
      return values;
    }
    if (document.kind === "lines") {
      values.voltage_level_id = refs.named(
        "voltages", row.voltage_name, row.voltage_level_id,
      ).id;
      if (row.parent_line_name) {
        const parent = refs.line(
          row.parent_line_name, row.parent_voltage_name, row.parent_line_id,
        );
        requireValue(parent.line_kind === "main", "支线只能归属于主线");
        values.parent_line_id = parent.id;
      }
      if (row.junction_tower_no) {
        requireValue(values.parent_line_id, "请先填写支线所属主线");
        const junction = refs.unique(
          equipment.list("towers").filter(
            (tower) => tower.line_id === values.parent_line_id &&
              tower.tower_no === String(row.junction_tower_no) &&
              tower.status === "active",
          ),
          "主线接入杆塔",
          row.junction_tower_id,
        );
        values.junction_tower_id = junction.id;
      }
    } else if (document.kind === "spans") {
      const line = refs.line(row.line_name, row.voltage_name, row.line_id);
      values.line_id = line.id;
      requireValue(row.start_tower_no && row.end_tower_no, "请填写档距两端杆塔号");
      const endpoint = (number:string, name?:string|null, voltage?:string|null, prior?:string|null) => {
        const selectedLine = name
          ? refs.line(name, voltage)
          : line;
        return refs.unique(
          equipment.list("towers").filter(
            (tower) => tower.line_id === selectedLine.id &&
              tower.tower_no === String(number) &&
              tower.status !== "retired",
          ),
          "档距端点杆塔“" + selectedLine.name + " " + number + "”",
          prior,
        ).id;
      };
      values.start_tower_id = endpoint(
        row.start_tower_no, row.start_line_name,
        row.start_voltage_name, row.start_tower_id,
      );
      values.end_tower_id = endpoint(
        row.end_tower_no, row.end_line_name,
        row.end_voltage_name, row.end_tower_id,
      );
      requireValue(values.start_tower_id !== values.end_tower_id, "档距两端杆塔不能相同");
    } else {
      values.line_id = refs.line(
        row.line_name, row.voltage_name, row.line_id,
      ).id;
      if (row.sharing_line_name || row.sharing_tower_no) {
        requireValue(
          row.sharing_line_name && row.sharing_tower_no,
          "共塔须填写已有回路的线路及杆塔号",
        );
        const sharedLine = refs.line(
          row.sharing_line_name, row.sharing_voltage_name,
        );
        const shared = refs.unique(
          equipment.list("towers").filter(
            (tower) => tower.line_id === sharedLine.id &&
              tower.tower_no === String(row.sharing_tower_no),
          ),
          "已有共塔回路",
        );
        requireValue(shared.physical_tower_id, "选定回路尚无实物关联");
        values.physical_tower_id = shared.physical_tower_id;
      }
      values.physical_properties = Object.fromEntries(
        physicalKeys.filter(
          (key) => row[key] !== undefined,
        ).map((key) => [key, row[key]]),
      );
    }
    return values;
  }
  function prepare(parsed:ParsedWorkbook, mode:ExchangeMode = "mixed"):AssetPrepareResult {
    requireValue(["create", "update", "mixed"].includes(mode), "导入模式无效");
    const lines = parsed.rows.documents || [],
      physical = parsed.rows.physical || [],
      towers = parsed.rows.towers || [],
      spans = parsed.rows.spans || [],
      source = [
        ...lines.map((row) => ({ kind: "lines" as const, row })),
        ...physical.map((row) => ({ kind: "physical" as const, row })),
        ...towers.map((row) => ({ kind: "towers" as const, row })),
        ...spans.map((row) => ({ kind: "spans" as const, row })),
      ],
      issues = [...parsed.issues],
      documents:AssetPreviewDocument[] = [];
    requireValue(source.length <= MAX_DOCUMENTS, "单批最多5000条完整台账记录");

    const savedLines = equipment.list("lines"),
      savedTowers = equipment.list("towers"),
      savedSpans = equipment.list("spans");
    const savedVoltage = (line:EquipmentRecord) => (
      resolveEquipment("voltages", line.voltage_level_id, true).name
    );
    const candidateLines = (name:string, voltage?:string|null) => {
      const proposed = lines.filter((row) => row.name === name &&
        (!voltage || row.voltage_name === voltage));
      const stored = savedLines.filter((row) => row.name === name &&
        (!voltage || savedVoltage(row) === voltage) &&
        row.status !== "retired");
      return { proposed, stored };
    };
    const lineExists = (name:string, voltage:string|null|undefined, field:string) => {
      requireValue(name, "请填写" + field);
      const { proposed, stored } = candidateLines(name, voltage);
      const ids = new Set([...proposed.filter((row) => row.id).map((row) => row.id),
        ...stored.map((row) => row.id)]);
      // A proposed new row is not the same business identity as a saved row.
      const creates = proposed.filter((row) => !row.id);
      requireValue(
        ids.size + creates.length === 1,
        ids.size + creates.length > 1
          ? field + "有重名歧义，请填写电压等级并核对原始台账"
          : field + "不存在，须在本文件线路表中先定义",
      );
      return proposed[0] || stored[0];
    };
    const towerExists = (lineName:string, voltage:string|null|undefined, towerNo:string, field:string) => {
      const line = lineExists(lineName, voltage, field + "所属线路");
      requireValue(towerNo, "请填写" + field + "杆塔号");
      const lineId = line.id;
      const matchingProposed = towers.filter((row) =>
        row.line_name === lineName &&
        (!voltage || !row.voltage_name || row.voltage_name === voltage) &&
        String(row.tower_no) === String(towerNo));
      const matchingSaved = lineId ? savedTowers.filter((tower) =>
        tower.line_id === lineId && tower.tower_no === String(towerNo) &&
        tower.status !== "retired") : [];
      const ids = new Set([
        ...matchingProposed.filter((row) => row.id).map((row) => row.id),
        ...matchingSaved.map((row) => row.id),
      ]);
      const creates = matchingProposed.filter((row) => !row.id);
      requireValue(ids.size + creates.length === 1,
        ids.size + creates.length > 1
          ? field + "对应多个杆塔，需核对具体线路和杆塔号"
          : field + "未找到杆塔，请先在本文件杆塔表创建");
      return matchingProposed[0] || matchingSaved[0];
    };
    for (const { kind, row } of source) {
      try {
        const existing = row.id ? resolveEquipment(kind, row.id) : null;
        const status = catalog.definitions[kind].fields.find(
          (field) => field.key === "status",
        );
        requireValue(
          row.status === undefined || (typeof row.status === "string" && Boolean(status?.options?.includes(row.status))),
          "状态未匹配可选业务值",
          422,
          { status: "请选择在用、停用、退役或适用的草稿状态" },
        );
        if (existing) expectedVersion(existing.version, row.expected_version);
        requireValue(mode !== "update" || existing,
          "仅更新模式需要维护导出的隐藏身份");
        requireValue(mode !== "create" || !existing,
          "仅新增模式不能修改已有对象");

        if (kind === "physical") {
          if (!existing) requireValue(
            physicalKeys.some((key) => row[key] !== undefined && row[key] !== null && row[key] !== ""),
            "请填写至少一项真实实物属性；普通杆塔请在逻辑杆塔表新建",
          );
        } else if (kind === "lines") {
          requireValue(String(row.name || "").trim(), "请填写线路名称");
          requireValue(
            row.voltage_name || row.voltage_level_id || existing?.voltage_level_id,
            "请选择电压等级",
          );
          const refs = createReferences(system);
          refs.named("voltages", row.voltage_name, row.voltage_level_id);
          if (!existing) {
            const other = savedLines.filter((item) =>
              item.name === row.name &&
              savedVoltage(item) === row.voltage_name &&
              item.status !== "retired");
            requireValue(!other.length,
              "已有同名同电压线路，请使用维护导出更新");
          }
          const kindOfLine = row.line_kind || existing?.line_kind || "main";
          requireValue(["main", "branch"].includes(kindOfLine),
            "请选择主线或支线");
          if (kindOfLine === "branch") {
            requireValue(
              row.parent_line_name || row.parent_line_id || existing?.parent_line_id,
              "支线必须指定所属主线",
            );
            requireValue(
              row.junction_tower_no || row.junction_tower_id ||
                existing?.junction_tower_id,
              "支线必须指定主线接入杆塔",
            );
            if (row.parent_line_name) {
              const parent = lineExists(
                row.parent_line_name, row.parent_voltage_name,
                "支线所属主线",
              );
              requireValue((parent.line_kind || "main") === "main",
                "支线只能关联真实主线，不允许挂接到另一条支线");
              if (row.junction_tower_no)
                towerExists(
                  row.parent_line_name, row.parent_voltage_name,
                  row.junction_tower_no, "支线接入",
                );
            }
          } else {
            requireValue(
              !row.parent_line_name && !row.junction_tower_no,
              "主线不能填写所属主线或接入杆塔",
            );
          }
        } else if (kind === "towers") {
          requireValue(row.line_name && row.tower_no,
            "请选择所属线路并填写杆塔号");
          const line = lineExists(row.line_name, row.voltage_name, "杆塔");
          const other = savedTowers.filter((tower) =>
            tower.line_id === line.id &&
            tower.tower_no === String(row.tower_no) &&
            tower.status !== "retired" && tower.id !== row.id);
          requireValue(!other.length,
            "本线路已有该杆塔号，请使用维护导出更新");
          if (row.sharing_line_name || row.sharing_tower_no) {
            requireValue(row.sharing_line_name && row.sharing_tower_no,
              "共塔须填写已有回路的线路及杆塔号");
            towerExists(
              row.sharing_line_name, row.sharing_voltage_name,
              row.sharing_tower_no, "共塔",
            );
          }
        } else {
          requireValue(row.line_name && row.start_tower_no &&
            row.end_tower_no, "档距须填写所属线路、起点和终点杆塔号");
          const line = lineExists(row.line_name, row.voltage_name, "档距");
          const startLine = row.start_line_name || row.line_name,
            endLine = row.end_line_name || row.line_name;
          const start = towerExists(startLine,
            row.start_line_name ? row.start_voltage_name : row.voltage_name,
            row.start_tower_no, "起点");
          const end = towerExists(endLine,
            row.end_line_name ? row.end_voltage_name : row.voltage_name,
            row.end_tower_no, "终点");
          requireValue(start !== end && (
            start.id !== end.id || !start.id
          ), "档距起点和终点不能相同");
          // A span must connect two towers of its own circuit, except for
          // the single documented main-line junction of a branch circuit.
          // Never infer topology from tower numbering or row order.
          const belongs = (name:string|null|undefined, voltage:string|null|undefined) =>
            name === row.line_name &&
            (!voltage || !row.voltage_name || voltage === row.voltage_name);
          const startOwn = belongs(startLine, row.start_voltage_name),
            endOwn = belongs(endLine, row.end_voltage_name);
          requireValue(startOwn || endOwn,
            "档距至少一端必须位于所属线路，不能连接两个外部线路的杆塔");
          if (!startOwn || !endOwn) {
            requireValue(line.line_kind === "branch",
              "主线档距不能连接其他线路的杆塔");
            const parent = line.parent_line_name
              ? line.parent_line_name
              : line.parent_line_id
                ? resolveEquipment("lines", line.parent_line_id).name : null;
            const junction = line.junction_tower_no
              ? String(line.junction_tower_no)
              : line.junction_tower_id
                ? String(resolveEquipment("towers", line.junction_tower_id).tower_no)
                : null;
            requireValue(parent && junction &&
              (startOwn
                ? endLine === parent && String(row.end_tower_no) === junction
                : startLine === parent && String(row.start_tower_no) === junction),
              "支线档距只能通过已指定的主线接入杆塔连接主线");
          }
          if (!existing && line.id && start.id && end.id)
            requireValue(
              !savedSpans.some((span) => span.line_id === line.id &&
                span.status !== "retired" &&
                ((span.start_tower_id === start.id &&
                  span.end_tower_id === end.id) ||
                 (span.start_tower_id === end.id &&
                  span.end_tower_id === start.id))),
              "两杆塔间已有档距，请使用维护导出更新",
            );
        }
        const payload:WorkbookRow = kind==="physical" || kind==="towers"
          ? normalizedTowerFields(row) : { ...row };
        delete payload._sheet;
        delete payload._row;
        let changes:AssetPreviewChange[] = [];
        if (existing) {
          let resolved, deferred = false;
          try {
            resolved = input({ kind, payload });
          } catch {
            // A reference can be created by an earlier row of this workbook.
            // The second, transactional preparation and save will resolve it.
            resolved = { ...payload };
            deferred = true;
          }
          changes = catalog.definitions[kind].fields
            .filter((field) => {
              const key=field.key as keyof EquipmentRecord;
              return resolved[field.key] !== undefined &&
                (field.type === "text"
                  ? String(resolved[field.key] ?? "") !== String(existing[key] ?? "")
                  : resolved[field.key] !== existing[key]);
            })
            .map((field) => ({
              field: field.key,
              before: existing[field.key as keyof EquipmentRecord],
              after: resolved[field.key],
            }));
          if (!changes.length && deferred && (
            row.parent_line_name || row.junction_tower_no ||
            row.start_tower_no || row.end_tower_no
          )) {
            // Revalidate explicit business relationships at commit time even
            // when the stored technical IDs have not changed.
            changes = [{ field: "relationship", before: null,
              after: "校验关联" }];
          }
        }
        documents.push({
          kind, payload, id: row.id || null,
          number: kind === "lines"
            ? String(row.name || "")
            : kind === "physical"
              ? (row.asset_no || row.tower_material || row.model || "独立物理杆塔")
            : kind === "towers"
              ? row.line_name + " · " + row.tower_no
              : row.line_name + " · " + row.start_tower_no +
                "—" + row.end_tower_no,
          action: existing
            ? changes.length ? "update" : "unchanged"
            : "create",
          sheet: row._sheet, row: row._row, changes,
        });
      } catch (error) {
        issues.push(issue(
          row._sheet, row._row,
          Object.keys(error instanceof BusinessError ? error.fields : {})[0] ||
            (kind === "lines" ? "name" :
              kind === "physical" ? "tower_material" :
              kind === "towers" ? "tower_no" : "start_tower_no"),
          row, error instanceof Error ? error.message : "台账预检失败",
        ));
      }
    }
    // A maintenance logical-tower row may modify physical properties. Record
    // that mutation against the stable physical entity, never on the logical
    // entity or a second physical record. All edits share one formal history.
    const physicalUpdates = new Map<string,AssetPreviewDocument>(
      documents.filter((doc) => doc.kind === "physical" && Boolean(doc.id))
        .map((doc) => [doc.id as string, doc]),
    );
    for (const logicalDocument of documents.filter((doc) =>
      doc.kind === "towers" && doc.id)) {
      const physicalId = savedTowers.find((row) =>
        row.id === logicalDocument.id)?.physical_tower_id;
      const existingPhysical = physicalId
        ? resolveEquipment("physical", physicalId, true) : null;
      if (!existingPhysical) continue;
      requireValue(physicalId, "关联物理杆塔身份缺失",404);
      const physicalChanges = physicalKeys.filter((key) =>
        logicalDocument.payload[key] !== undefined &&
        logicalDocument.payload[key] !== existingPhysical[key]);
      if (!physicalChanges.length) continue;
      let physicalDoc = physicalUpdates.get(physicalId);
      if (!physicalDoc) {
        const updatedIdentity:AssetPreviewDocument = {
          kind: "physical", id: physicalId,
          payload: { id: physicalId, expected_version: existingPhysical.version },
          sheet: logicalDocument.sheet, row: logicalDocument.row,
          number: existingPhysical.asset_no || existingPhysical.tower_material || "物理杆塔",
          action: "update", changes: [],
        };
        documents.splice(documents.indexOf(logicalDocument), 0, updatedIdentity);
        physicalUpdates.set(physicalId, updatedIdentity);
        physicalDoc = updatedIdentity;
      }
      requireValue(physicalDoc, "未能建立物理杆塔正式变更",409);
      for (const key of physicalChanges) {
        const value = logicalDocument.payload[key];
        const priorChange = physicalDoc.changes.find((change) => change.field === key);
        if (priorChange && priorChange.after !== value) {
          issues.push(issue(logicalDocument.sheet, logicalDocument.row, key, value,
            "同一物理杆塔存在互相矛盾的实物属性修改，请统一填写"));
          continue;
        }
        const changedValues:Record<string,unknown> = physicalDoc.payload;
        changedValues[key] = value;
        if (!priorChange) physicalDoc.changes.push({
          field: key, before: existingPhysical[key], after: value,
        });
        physicalDoc.action = "update";
      }
    }
    // Reject all rows of a duplicated business object, rather than silently
    // choosing one of the duplicated lines, towers or span endpoints.
    const duplicates = new Map<string,AssetPreviewDocument[]>();
    for (const doc of documents) {
      const row = doc.payload;
      const key = doc.kind === "lines"
        ? JSON.stringify(["line", row.name, row.voltage_name || ""])
        : doc.kind === "physical"
          ? JSON.stringify(["physical", row.id || row._row])
        : doc.kind === "towers"
          ? JSON.stringify(["tower", row.line_name, row.voltage_name || "",
            row.tower_no])
          : JSON.stringify(["span", row.line_name, row.voltage_name || "",
            [
              (row.start_line_name || row.line_name) + "/" + row.start_tower_no,
              (row.end_line_name || row.line_name) + "/" + row.end_tower_no,
            ].sort()]);
      const group = duplicates.get(key) ?? [];
      group.push(doc);
      duplicates.set(key,group);
    }
    for (const group of duplicates.values())
      if (group.length > 1)
        for (const doc of group)
          issues.push(issue(doc.sheet, doc.row, "relationship",
            doc.number, "当前文件同一业务对象重复，请合并或删除重复行"));
    // Respect dependencies even when the rows appear in arbitrary worksheet
    // order: main line -> junction tower -> branch -> branch tower -> spans.
    const matchLineDocs = (name:string, voltage?:string|null) =>
      documents.filter((doc) => doc.kind === "lines" &&
        doc.payload.name === name &&
        (!voltage || doc.payload.voltage_name === voltage));
    const matchTowerDocs = (line:string, voltage:string|null|undefined, towerNo:string) =>
      documents.filter((doc) => doc.kind === "towers" &&
        doc.payload.line_name === line &&
        (!voltage || !doc.payload.voltage_name ||
          doc.payload.voltage_name === voltage) &&
        String(doc.payload.tower_no) === String(towerNo));
    const dependencyMap = new Map<AssetPreviewDocument,Set<AssetPreviewDocument>>();
    const dependencyFailures = new Set<AssetPreviewDocument>();
    for (const doc of documents) {
      try {
        const deps = new Set<AssetPreviewDocument>(),
          row = doc.payload;
        const lineDependency = (name:string|null|undefined, voltage:string|null|undefined, description:string) => {
          if (!name) return;
          const candidates = matchLineDocs(name, voltage);
          requireValue(candidates.length <= 1,
            description + "在当前文件中有重名歧义");
          if (candidates.length) {
            requireValue(candidates[0] !== doc, "对象不能关联自身");
            deps.add(candidates[0]);
          }
        };
        const towerDependency = (line:string|null|undefined, voltage:string|null|undefined, no:string|null|undefined, description:string) => {
          if (!no) return;
          requireValue(line, description+"必须指定线路");
          const candidates = matchTowerDocs(line, voltage, no);
          requireValue(candidates.length <= 1,
            description + "在当前文件中重复");
          if (candidates.length) {
            requireValue(candidates[0] !== doc,
              "对象不能关联自身");
            deps.add(candidates[0]);
          }
          lineDependency(line, voltage, description);
        };
        if (doc.kind === "lines" && row.parent_line_name) {
          lineDependency(row.parent_line_name, row.parent_voltage_name,
            "所属主线");
          towerDependency(row.parent_line_name, row.parent_voltage_name,
            row.junction_tower_no, "主线接入杆塔");
        }
        if (doc.kind === "towers") {
          lineDependency(row.line_name, row.voltage_name, "杆塔所属线路");
          towerDependency(row.sharing_line_name, row.sharing_voltage_name,
            row.sharing_tower_no, "共用实物");
        }
        if (doc.kind === "spans") {
          lineDependency(row.line_name, row.voltage_name, "档距所属线路");
          towerDependency(row.start_line_name || row.line_name,
            row.start_line_name ? row.start_voltage_name : row.voltage_name,
            row.start_tower_no, "档距起点");
          towerDependency(row.end_line_name || row.line_name,
            row.end_line_name ? row.end_voltage_name : row.voltage_name,
            row.end_tower_no, "档距终点");
        }
        dependencyMap.set(doc, deps);
      } catch (error) {
        issues.push(issue(doc.sheet, doc.row, "relationship",
          doc.number, error instanceof Error ? error.message : "设备关联校验失败"));
        dependencyFailures.add(doc);
      }
    }
    const visiting = new Set<AssetPreviewDocument>(), visited = new Set<AssetPreviewDocument>(), ordered:AssetPreviewDocument[] = [];
    function visit(doc:AssetPreviewDocument):void {
      if (visited.has(doc) || dependencyFailures.has(doc)) return;
      if (visiting.has(doc)) {
        dependencyFailures.add(doc);
        issues.push(issue(doc.sheet, doc.row, "relationship",
          doc.number, "同一工作簿存在循环依赖，无法确定创建顺序"));
        return;
      }
      visiting.add(doc);
      for (const dependency of dependencyMap.get(doc) || []) visit(dependency);
      visiting.delete(doc);
      if (![...dependencyMap.get(doc) || []].some(
        (dependency) => dependencyFailures.has(dependency)
      ) && !dependencyFailures.has(doc)) ordered.push(doc);
      else dependencyFailures.add(doc);
      visited.add(doc);
    }
    // Deterministic order keeps independently named root records first.
    for (const doc of documents) visit(doc);
    for (const doc of dependencyFailures)
      if (!issues.some((problem) =>
        problem.sheet === doc.sheet && problem.row === doc.row))
        issues.push(issue(doc.sheet, doc.row, "relationship", doc.number,
          "关联对象无效或存在循环依赖，当前行无法提交"));
    const invalidRows = new Set(
      issues.map((problem) => problem.sheet + "/" + problem.row),
    );
    return {
      documents: ordered.filter((doc) =>
        !invalidRows.has(doc.sheet + "/" + doc.row)),
      issues,
      document_count: documents.length,
      invalid_document_count: invalidRows.size,
    };
  }
  async function preview(actor:Actor, buffer:Buffer, options:ExchangePreviewOptions = {}) {
    authorize(actor, "admin");
    const started = performance.now(),
      parsed = await parseWorkbook(buffer, "assets"),
      parsedAt = performance.now(),
      prepared = prepare(parsed, options.mode),
      token = id();
    const body = {
      kind: "assets",
      mode: options.mode || "mixed",
      sha256: digest(buffer),
      parsed,
      ...prepared,
    };
    exchangePersistence.createBatch({
      id: token,
      draft_json: JSON.stringify(body),
      created_by: actor.id,
      created_at: now(),
      updated_at: now(),
    });
    return {
      token,
      ...prepared,
      timings_ms: {
        parse: parsedAt - started,
        total: performance.now() - started,
      },
      summary: {
        documents: prepared.document_count,
        created: prepared.documents.filter((row) => row.action === "create")
          .length,
        updated: prepared.documents.filter((row) => row.action === "update")
          .length,
        unchanged: prepared.documents.filter(
          (row) => row.action === "unchanged",
        ).length,
        invalid_documents: prepared.invalid_document_count,
        conflicts: prepared.issues.filter((issue) =>
          issue.reason.includes("版本"),
        ).length,
        duplicate_issues: prepared.issues.filter(
          (issue) =>
            issue.reason.includes("重复") || issue.reason.includes("已有"),
        ).length,
      },
    };
  }
  async function exportData(actor:Actor, options:ExchangeExportOptions = {}):Promise<Buffer> {
    authorize(actor, "read");
    const rows:Record<"documents"|"physical"|"towers"|"spans",WorkbookRow[]> = { documents: [], physical: [], towers: [], spans: [] },
      selected = new Set(options.ids || []);
    const kinds = ["lines", "towers", "spans", "physical"] as const;
    const records = new Map<AssetExchangeKind, EquipmentRecord[]>();
    const query = options.listQuery;
    for (const kind of kinds) {
      if (options.assetKind && options.assetKind !== kind) continue;
      if (selected.size) {
        records.set(kind, options.assetKind
          ? [...selected].map(id => equipment.get(kind, id, true))
          : equipment.list(kind, true).filter(row => selected.has(row.id)));
        continue;
      }
      const first = equipment.search(kind, { ...query, page: 1, page_size: 200 });
      requireValue(first.total <= MAX_DOCUMENTS, "设备导出超过5000条，请收窄筛选条件");
      const found = first.items;
      for (let page = 2; (page - 1) * first.page_size < first.total; page++) {
        found.push(...equipment.search(kind, { ...query, page, page_size: first.page_size }).items);
      }
      records.set(kind, found);
    }
    const rootCount = [...records.values()].reduce((sum, entries) => sum + entries.length, 0);
    requireValue(rootCount <= MAX_DOCUMENTS, "设备导出超过5000条，请收窄筛选条件");
    requireValue(!selected.size || rootCount === selected.size, "所选设备已变更，请刷新后重选", 409);
    for (const kind of ["lines", "towers", "spans"] as const)
      for (const record of records.get(kind) || []) {
        const value:WorkbookRow = { ...record, expected_version: record.version };
        if (kind === "lines") {
          value.voltage_name = resolveEquipment(
            "voltages", record.voltage_level_id, true,
          ).name;
          if (record.parent_line_id) {
            const parent = resolveEquipment("lines", record.parent_line_id, true);
            value.parent_line_name = parent.name;
            value.parent_voltage_name = resolveEquipment(
              "voltages", parent.voltage_level_id, true,
            ).name;
          }
          if (record.junction_tower_id)
            value.junction_tower_no = resolveEquipment(
              "towers", record.junction_tower_id, true,
            ).tower_no;
        } else {
          const line = resolveEquipment("lines", record.line_id, true);
          value.line_name = line.name;
          if (kind === "towers" && record.physical_tower_id) {
            const physical = resolveEquipment("physical", record.physical_tower_id, true);
            const actualProperties:Record<string,unknown> = value;
            for (const key of physicalKeys) actualProperties[key] = physical[key];
            if(physical.tower_material) value.tower_material=
              catalog.get("tower_materials",physical.tower_material,true).name;
            if(physical.tower_nature) value.tower_nature=
              catalog.get("tower_natures",physical.tower_nature,true).name;
          }
          value.voltage_name = resolveEquipment(
            "voltages", line.voltage_level_id, true,
          ).name;
          if (kind === "spans") {
            const start = resolveEquipment("towers", record.start_tower_id, true),
              end = resolveEquipment("towers", record.end_tower_id, true);
            value.start_tower_no = start.tower_no;
            value.end_tower_no = end.tower_no;
            if (start.line_id !== line.id) {
              const startLine = resolveEquipment("lines", start.line_id, true);
              value.start_line_name = startLine.name;
              value.start_voltage_name = resolveEquipment(
                "voltages", startLine.voltage_level_id, true,
              ).name;
            }
            if (end.line_id !== line.id) {
              const endLine = resolveEquipment("lines", end.line_id, true);
              value.end_line_name = endLine.name;
              value.end_voltage_name = resolveEquipment(
                "voltages", endLine.voltage_level_id, true,
              ).name;
            }
          }
        }
        rows[kind === "lines" ? "documents" : kind].push(value);
      }
    for (const physicalTower of records.get("physical") || []) {
      rows.physical.push({
        ...physicalTower, expected_version: physicalTower.version,
        tower_material:physicalTower.tower_material
          ? catalog.get("tower_materials",physicalTower.tower_material,true).name : null,
        tower_nature:physicalTower.tower_nature
          ? catalog.get("tower_natures",physicalTower.tower_nature,true).name : null,
      });
    }
    if (options.report)
      return makeBusinessReport("assets", [
        ...rows.documents.map((row) => ({
          对象: "线路",
          名称: row.name,
          电压等级: row.voltage_name,
          类型: row.line_kind === "branch" ? "支线" : "主线",
          所属主线: row.parent_line_name || "",
          接入杆塔: row.junction_tower_no || "",
        })),
        ...rows.physical.map((row) => ({
          对象: "物理杆塔", 名称: row.label || row.asset_no || "物理杆塔", 杆塔材质: row.tower_material, 杆塔性质: row.tower_nature, 型号: row.model,
          关联线路: row.related_lines, 关联杆塔号: row.related_towers,
        })),
        ...rows.towers.map((row) => ({
          对象: "逻辑杆塔",
          线路: row.line_name,
          杆塔号: row.tower_no,
        })),
        ...rows.spans.map((row) => ({
          对象: "档距",
          线路: row.line_name,
          起点: row.start_tower_no,
          终点: row.end_tower_no,
          管辖长度米: row.transmission_center_length_mm == null
            ? "" : row.transmission_center_length_mm / 1000,
        })),
      ]);
    return makeWorkbook("assets", rows);
  }
  return {
    preview,
    prepare,
    execute(actor:Actor, document:AssetPreviewDocument) {
      authorize(actor, "admin");
      return catalog.save(actor, document.kind, input(document), document.id || undefined);
    },
    exportData,
  };
}
