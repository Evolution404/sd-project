import { requireValue } from "../../shared/errors/business-error.js";

// One preparation pass uses one read-only index of business descriptions.
export function createReferences({ catalog, repo, projects, demands }) {
  const lists = new Map(),
    indexes = new Map();
  const list = (kind) => {
    if (!lists.has(kind))
      lists.set(
        kind,
        catalog
          .list(kind)
          .filter((row) => !["inactive", "retired"].includes(row.status)),
      );
    return lists.get(kind);
  };
  function indexed(kind, key, value) {
    const indexKey = kind + "/" + key;
    if (!indexes.has(indexKey)) {
      const index = new Map();
      for (const row of list(kind)) {
        const item =
          key === "line_tower" ? row.line_id + "\0" + row.tower_no : row[key];
        if (!index.has(item)) index.set(item, []);
        index.get(item).push(row);
      }
      indexes.set(indexKey, index);
    }
    return indexes.get(indexKey).get(value) || [];
  }
  function unique(rows, description, selectedId) {
    const selected = selectedId && rows.find((row) => row.id === selectedId);
    requireValue(
      selected || rows.length === 1,
      rows.length
        ? `${description}存在同名或同号歧义，请在系统核对真实对象后使用维护导出`
        : `${description}未匹配已有业务对象`,
    );
    return selected || rows[0];
  }
  function named(kind, name, selectedId, filters = {}) {
    if (!name && selectedId) return catalog.get(kind, selectedId, true);
    return unique(
      indexed(kind, kind === "prices" ? "title" : "name", name).filter((row) =>
        Object.entries(filters).every(
          ([key, value]) => !value || row[key] === value,
        ),
      ),
      catalog.definitions[kind].title + "“" + (name || "未填写") + "”",
      selectedId,
    );
  }
  function line(name, voltageName, selectedId) {
    const voltage = voltageName ? named("voltages", voltageName).id : null;
    return unique(
      indexed("lines", "name", name).filter(
        (row) => !voltage || row.voltage_level_id === voltage,
      ),
      "线路“" + (name || "未填写") + "”",
      selectedId,
    );
  }
  function location(row) {
    const result = { ...row };
    const key =
      row.location_kind === "span"
        ? "span_id"
        : row.location_kind === "physical_tower"
          ? "physical_tower_id"
          : "logical_tower_id";
    if (!row.line_name && !row.tower_no && !row.asset_no) return result;
    const selectedLine = row.line_name
      ? line(row.line_name, row.voltage_name)
      : null;
    if (
      row.location_kind === "physical_tower" &&
      row.asset_no &&
      !row.tower_no
    ) {
      result[key] = unique(
        indexed("physical", "asset_no", row.asset_no),
        "物理杆塔资产号",
        row[key],
      ).id;
      return result;
    }
    requireValue(
      selectedLine && row.tower_no,
      "请填写线路名称及杆塔号，独立实物可使用真实资产铭牌号",
    );
    const towers = indexed(
      "towers",
      "line_tower",
      selectedLine.id + "\0" + String(row.tower_no),
    );
    const start = unique(
      towers,
      selectedLine.name + "的杆塔“" + row.tower_no + "”",
      row.logical_tower_id,
    );
    if (row.location_kind === "span") {
      requireValue(row.end_tower_no, "档距须填写起点杆塔号及终点杆塔号");
      const end = unique(
        list("towers").filter(
          (tower) =>
            tower.line_id === selectedLine.id &&
            tower.tower_no === String(row.end_tower_no),
        ),
        "终点杆塔",
        null,
      );
      result.span_id = unique(
        list("spans").filter(
          (span) =>
            span.line_id === selectedLine.id &&
            ((span.start_tower_id === start.id &&
              span.end_tower_id === end.id) ||
              (span.start_tower_id === end.id &&
                span.end_tower_id === start.id)),
        ),
        "两杆塔间档距",
        row.span_id,
      ).id;
    } else if (row.location_kind === "physical_tower") {
      requireValue(start.physical_tower_id, "所选杆塔尚无真实实物关联");
      result.physical_tower_id = start.physical_tower_id;
      result.context_line_id = selectedLine.id;
    } else result.logical_tower_id = start.id;
    return result;
  }
  function project(name, selectedId) {
    if (!name && selectedId) return projects.get(selectedId);
    return unique(
      projects.list().filter((row) => row.name === name),
      "子项目“" + (name || "未填写") + "”",
      selectedId,
    );
  }
  function scope(projectId, problem, selectedId) {
    const scopes = repo
      .where("project_demand_scopes", { project_id: projectId })
      .map((row) => ({
        ...row,
        problem_description: demands.get(row.demand_id, true)
          .problem_description,
      }));
    return unique(
      scopes.filter((row) => !problem || row.problem_description === problem),
      "项目内需求“" + (problem || "未填写") + "”",
      selectedId,
    );
  }
  return { named, line, location, project, scope, unique };
}
