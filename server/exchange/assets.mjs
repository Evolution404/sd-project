import { authorize, id, now, digest } from "../application/auth.mjs";
import { requireValue, expectedVersion } from "../domain/errors.mjs";
import { createReferences } from "./references.mjs";
import {
  parseWorkbook,
  makeWorkbook,
  makeBusinessReport,
  issue,
  MAX_DOCUMENTS,
} from "./workbook.mjs";

export function createAssetExchange(system) {
  const { catalog, repo } = system;
  const physicalKeys = catalog.definitions.physical.fields
    .map((field) => field.key)
    .filter((key) => key !== "status");
  function input(document) {
    const row = document.payload,
      refs = createReferences(system);
    const values = { ...row, expected_version: row.expected_version };
    if (document.kind === "lines")
      values.voltage_level_id = refs.named(
        "voltages",
        row.voltage_name,
        row.voltage_level_id,
      ).id;
    else {
      values.line_id = refs.line(
        row.line_name,
        row.voltage_name,
        row.line_id,
      ).id;
      if (row.sharing_line_name || row.sharing_tower_no) {
        requireValue(
          row.sharing_line_name && row.sharing_tower_no,
          "共塔须填写已有回路的线路及杆塔号",
        );
        const sharedLine = refs.line(
          row.sharing_line_name,
          row.sharing_voltage_name,
        );
        const shared = refs.unique(
          catalog
            .list("towers")
            .filter(
              (tower) =>
                tower.line_id === sharedLine.id &&
                tower.tower_no === String(row.sharing_tower_no),
            ),
          "已有共塔回路",
        );
        requireValue(shared.physical_tower_id, "选定回路尚无实物关联");
        values.physical_tower_id = shared.physical_tower_id;
      }
      values.confirm_distinct =
        row.distinct_physical === true || row.distinct_physical === "是";
      values.physical_properties = Object.fromEntries(
        physicalKeys
          .filter((key) => row[key] !== undefined)
          .map((key) => [key, row[key]]),
      );
    }
    return values;
  }
  function prepare(parsed, mode = "mixed") {
    requireValue(["create", "update", "mixed"].includes(mode), "导入模式无效");
    const documents = [],
      issues = [...parsed.issues],
      refs = createReferences(system);
    const lines = parsed.rows.documents,
      towers = parsed.rows.towers;
    requireValue(
      lines.length + towers.length <= MAX_DOCUMENTS,
      "单批最多5000条完整台账记录",
    );
    for (const [kind, rows] of [
      ["lines", lines],
      ["towers", towers],
    ])
      for (const row of rows) {
        try {
          const existing = row.id ? catalog.get(kind, row.id) : null;
          const status = catalog.definitions[kind].fields.find(
            (field) => field.key === "status",
          );
          requireValue(
            row.status === undefined || status.options.includes(row.status),
            "状态未匹配可选业务值",
            422,
            { status: "请选择在用、停用、退役或适用的草稿状态" },
          );
          if (existing) expectedVersion(existing.version, row.expected_version);
          requireValue(
            mode !== "update" || existing,
            "仅更新模式需要维护导出的隐藏身份",
          );
          requireValue(
            mode !== "create" || !existing,
            "仅新增模式不能修改已有对象",
          );
          if (kind === "lines") {
            requireValue(String(row.name || "").trim(), "请填写线路名称");
            refs.named("voltages", row.voltage_name, row.voltage_level_id);
          } else {
            requireValue(
              row.line_name && row.tower_no,
              "请选择所属线路并填写杆塔号",
            );
            const currentLines = catalog
              .list("lines")
              .filter((line) => line.name === row.line_name);
            const proposed = lines.filter(
              (line) =>
                line.name === row.line_name &&
                (!row.voltage_name || line.voltage_name === row.voltage_name),
            );
            requireValue(
              currentLines.length || proposed.length === 1,
              proposed.length > 1
                ? "清单内同名线路存在歧义"
                : "所属线路尚未定义",
            );
            if (currentLines.length) {
              const values = input({ kind, payload: row });
              const same = catalog
                .list("towers")
                .filter(
                  (tower) =>
                    tower.line_id === values.line_id &&
                    tower.tower_no === String(row.tower_no) &&
                    tower.status !== "retired" &&
                    tower.id !== row.id,
                );
              requireValue(
                !same.length,
                "本线路已有该杆塔号，请使用维护导出更新",
              );
              const potentialShared = catalog
                .list("towers")
                .some(
                  (tower) =>
                    tower.tower_no === String(row.tower_no) &&
                    tower.physical_tower_id &&
                    tower.status !== "retired" &&
                    tower.id !== row.id,
                );
              requireValue(
                existing ||
                  values.physical_tower_id ||
                  !potentialShared ||
                  values.confirm_distinct,
                "已有同号杆塔，请填写共塔关系或明确确认不同实物",
              );
            }
          }
          const payload = { ...row };
          delete payload._sheet;
          delete payload._row;
          const resolved = existing ? input({ kind, payload }) : payload;
          const changes = existing
            ? catalog.definitions[kind].fields
                .filter(
                  (field) =>
                    resolved[field.key] !== undefined &&
                    (field.type === "text"
                      ? String(resolved[field.key] ?? "") !==
                        String(existing[field.key] ?? "")
                      : resolved[field.key] !== existing[field.key]),
                )
                .map((field) => ({
                  field: field.key,
                  before: existing[field.key],
                  after: resolved[field.key],
                }))
            : [];
          documents.push({
            kind,
            payload,
            id: row.id || null,
            number:
              kind === "lines"
                ? row.name
                : row.line_name + " · " + row.tower_no,
            action: existing
              ? changes.length
                ? "update"
                : "unchanged"
              : "create",
            sheet: row._sheet,
            row: row._row,
            changes,
          });
        } catch (error) {
          issues.push(
            issue(
              row._sheet,
              row._row,
              Object.keys(error.fields || {})[0] ||
                (kind === "lines" ? "name" : "tower_no"),
              row,
              error.message,
            ),
          );
        }
      }
    const grouped = new Map();
    for (const document of documents.filter(
      (document) => document.kind === "towers",
    )) {
      const key =
        document.id ||
        JSON.stringify([
          document.payload.line_id || document.payload.line_name,
          document.payload.voltage_name || "",
          document.payload.tower_no,
        ]);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(document);
    }
    for (const group of grouped.values()) {
      if (group.length < 2) continue;
      for (const document of group)
        issues.push(
          issue(
            document.sheet,
            document.row,
            "tower_no",
            document.payload.tower_no,
            "同一线路和杆塔号在文件内重复",
          ),
        );
    }
    const invalidRows = new Set(
      issues.map((issue) => issue.sheet + "/" + issue.row),
    );
    return {
      documents: documents.filter(
        (document) => !invalidRows.has(document.sheet + "/" + document.row),
      ),
      issues,
      document_count: lines.length + towers.length,
      invalid_document_count: invalidRows.size,
    };
  }
  async function preview(actor, buffer, options = {}) {
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
    repo.insert("demand_batches", {
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
  async function exportData(actor, options = {}) {
    authorize(actor, "read");
    const rows = { documents: [], towers: [] };
    for (const kind of ["lines", "towers"])
      for (const record of catalog.list(kind)) {
        if (options.query && !record.label.includes(options.query)) continue;
        if (options.ids?.length && !options.ids.includes(record.id)) continue;
        const value = { ...record, expected_version: record.version };
        if (kind === "lines")
          value.voltage_name = catalog.get(
            "voltages",
            record.voltage_level_id,
            true,
          ).name;
        else {
          value.line_name = catalog.get("lines", record.line_id, true).name;
          value.voltage_name = catalog.get(
            "voltages",
            catalog.get("lines", record.line_id, true).voltage_level_id,
            true,
          ).name;
        }
        rows[kind === "lines" ? "documents" : "towers"].push(value);
      }
    if (options.report)
      return makeBusinessReport("assets", [
        ...rows.documents.map((row) => ({
          对象: "线路",
          名称: row.name,
          电压等级: row.voltage_name,
        })),
        ...rows.towers.map((row) => ({
          对象: "杆塔",
          线路: row.line_name,
          杆塔号: row.tower_no,
        })),
      ]);
    return makeWorkbook("assets", rows);
  }
  return {
    preview,
    prepare,
    execute(actor, document) {
      authorize(actor, "admin");
      return catalog.save(actor, document.kind, input(document), document.id);
    },
    exportData,
  };
}
