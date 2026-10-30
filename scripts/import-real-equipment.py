#!/usr/bin/env python3
"""Import 2026 authoritative transmission inventory and coordinate-enabled tower registry.

Import is transactional and idempotent by source fingerprint. No source files are modified.
The 2026 tower ranges are read only to assign each tower's management department; they
are not retained as a separate jurisdiction entity. Distances are derived at query time.
"""
import collections
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import sys
import uuid

PROJECT = Path(__file__).resolve().parent.parent
STAGING = PROJECT / ".local-test-data/pms-import-audit-20261030"
MASTER = Path("/Users/zhangyuxi/Desktop/输电pms数据清洗/pms2.5/附件：输电运检中心各班组管辖设备清册 - 20260810.xlsx")
COORDS = Path("/Users/zhangyuxi/Desktop/输电统计/线路统计管理/数据.json")
DATABASE = Path(os.environ.get("DATA_DIR", str(Path.home() / ".local/share/sd-project"))) / "business.sqlite"
DATE = datetime.datetime.now(datetime.timezone.utc).isoformat()
NAMESPACE = uuid.NAMESPACE_URL

def uid(kind, value):
    return str(uuid.uuid5(NAMESPACE, f"sd-project:2026:{kind}:{value}"))

def normalize(name):
    return re.sub(r"^(?:交流|直流)?(?:±)?(?:35|110|220|500|800|1000)kV",
                  "", re.sub(r"\s+", "", name or ""), flags=re.I)

def get_rows(path):
    with path.open(encoding="utf-8") as stream:
        next(stream)
        return [(obj["row"], {int(k): str(v) for k, v in obj["cells"].items()})
                for obj in map(json.loads, stream)]

def simple_number(value):
    value = str(value or "").strip().lstrip("#")
    if re.fullmatch(r"\d+", value):
        return int(value)
    return None

def tower_number(pole):
    label = str(pole.get("name", "")).strip()
    if len(label) > 35:
        m = re.search(r"(?:#|线)(\d+(?:-\d+|\+\d+)?)$", label)
        if m:
            return m.group(1)
    return label or str(pole.get("number", "")).strip()

def in_range(expression, pole):
    """Only unambiguous numeric ranges and exact tower names; never guess branch topology."""
    expr = (expression or "").strip()
    number = simple_number(pole.get("number"))
    label = tower_number(pole).lstrip("#")
    for segment in re.split(r"[\n,，、；;]", expr):
        segment = segment.strip().replace("～", "-").replace("~", "-").replace("—", "-").replace("至", "-")
        if not segment:
            continue
        if segment == label:
            return True
        exact = re.fullmatch(r"#?(\d+)", segment)
        if exact and number == int(exact.group(1)):
            return True
        match = re.fullmatch(r"#?(\d+)(\(不含\))?\s*-\s*#?(\d+)(\+\d+)?", segment)
        if not match or number is None:
            continue
        first, last = int(match.group(1)), int(match.group(3))
        if first > last:
            continue
        if first < number <= last if match.group(2) else first <= number <= last:
            return True
    return False

def issue(con, typ, source, row, message, meta=None):
    issue_id = uid("issue", f"{typ}:{source}:{row}:{message}")
    con.execute("INSERT OR IGNORE INTO pms_import_issues VALUES(?,?,?,?,?,?,?)",
                (issue_id, typ, source, int(row), message,
                 json.dumps(meta, ensure_ascii=False) if meta is not None else None, DATE))

def numeric_int(value):
    try:
        return int(float(value)) if value else None
    except (ValueError, TypeError):
        return None

def import_all():
    if not MASTER.exists() or not COORDS.exists():
        raise RuntimeError("源文件不存在，请检查 2026 主表和杆塔坐标 JSON")
    master = get_rows(STAGING / "master.jsonl")
    pms = get_rows(STAGING / "xls_towers.jsonl")
    coordinates = json.loads(COORDS.read_text(encoding="utf-8"))["data"]
    fingerprint = hashlib.sha256((hashlib.sha256(MASTER.read_bytes()).hexdigest() + hashlib.sha256(COORDS.read_bytes()).hexdigest() + "tower-management-v1").encode()).hexdigest()
    groups = collections.defaultdict(list)
    for row, data in master:
        groups[data[2]].append((row, data))
    codes = {name: uid("line", name) for name in groups}
    exact = collections.defaultdict(set)
    pms_aliases = collections.defaultdict(set)
    for name, entries in groups.items():
        exact[normalize(name)].add(name)
        for row, data in entries:
            pms_aliases[normalize(data.get(3))].add(name)
    line_ids = {}
    json_names = {l["id"]: l["name"] for l in coordinates["lines"]}
    for line in coordinates["lines"]:
        candidates = exact.get(normalize(line["name"]), set())
        if not candidates:
            candidates = pms_aliases.get(normalize(line["name"]), set())
            main = [name for name in candidates if groups[name][0][1].get(7) == "主线"]
            candidates = set(main) if main else candidates
        if len(candidates) == 1:
            line_ids[line["id"]] = next(iter(candidates))
    details = collections.defaultdict(list)
    for row, data in pms:
        if data.get(12):
            details[data[12]].append((row, data))
    stats = collections.Counter()
    con = sqlite3.connect(DATABASE, timeout=30)
    con.execute("PRAGMA foreign_keys=ON")
    old = con.execute("SELECT result_json FROM pms_import_runs WHERE source_fingerprint=?", (fingerprint,)).fetchone()
    if old:
        print("ALREADY_IMPORTED " + old[0])
        return
    if con.execute("SELECT COUNT(*) FROM transmission_lines").fetchone()[0]:
        raise RuntimeError("目标数据库已有线路，拒绝覆盖；请审查现有数据再执行增量导入")
    admin = con.execute("SELECT id FROM users WHERE role='admin' ORDER BY created_at LIMIT 1").fetchone()
    if not admin:
        raise RuntimeError("目标数据库尚未初始化管理员")
    admin = admin[0]
    con.execute("BEGIN IMMEDIATE")
    try:
        # The line entity has no management team. One tower gets one department
        # after matching the 2026 authority source; ambiguous towers are excluded.
        for name, entries in groups.items():
            first = entries[0][1]
            voltage = first[1]
            vtype = "DC" if "±" in voltage else "AC"
            vcode = vtype + re.search(r"\d+", voltage).group()
            lid = codes[name]
            kind = "branch" if first.get(7) == "支线" else "main"
            con.execute("""INSERT INTO transmission_lines
                         (id,line_code,voltage_level_id,name,status,version,created_at,updated_at,line_kind,setup_status)
                         VALUES (?,?,?,?,?,?,?,?,?,?)""",
                        (lid, "XL-" + lid.replace("-", ""), "builtin-voltage-" + vcode,
                         name, "active", 1, DATE, DATE, kind,
                         "draft" if kind == "branch" else "ready"))
            con.execute("""INSERT INTO line_name_history
                         (id,line_id,name,valid_from,valid_to,changed_by,reason,recorded_at)
                         VALUES(?,?,?,?,NULL,?,?,?)""",
                        (uid("name", name), lid, name, DATE, admin, "2026年8月10日最新台账", DATE))
            for row, item in entries:
                for column, source in ((2, "latest"), (3, "pms-alias")):
                    if item.get(column):
                        con.execute("INSERT OR IGNORE INTO line_source_aliases VALUES(?,?,?)",
                                    (lid, item[column], source))
            stats["lines"] += 1

        # If branch parent is not unambiguous, keep it as a draft rather than invent a connection.
        for name, entries in groups.items():
            if entries[0][1].get(7) != "支线":
                continue
            parent = [candidate for candidate in groups if candidate != name and
                      groups[candidate][0][1].get(7) == "主线" and name.startswith(candidate)]
            if not parent:
                alias = normalize(entries[0][1].get(3))
                parent = [candidate for candidate in pms_aliases.get(alias, set())
                          if candidate != name and groups[candidate][0][1].get(7) == "主线"]
            if len(parent) == 1:
                con.execute("UPDATE transmission_lines SET parent_line_id=? WHERE id=?",
                            (codes[parent[0]], codes[name]))
                stats["branch_parent_confirmable"] += 1
            else:
                issue(con, "line", "2026-master", entries[0][0],
                      "支线接入关系待确认", {"line": name, "candidate_parent_names": parent})
                stats["branch_review"] += 1

        physical_by_coord = {}
        tower_lookup = collections.defaultdict(list)
        selected_by_line = collections.defaultdict(list)
        out_of_range = collections.Counter()
        for index, pole in enumerate(coordinates["poles"], 1):
            source_line = pole["lineId"]
            name = line_ids.get(source_line)
            if not name:
                stats["unmapped_coordinate_towers"] += 1
                continue
            matching = [(row, rec) for row, rec in groups[name] if in_range(rec.get(9, ""), pole)]
            assignments = {record.get(6, "") for row, record in matching if record.get(6, "")}
            if not matching or len(assignments) != 1:
                out_of_range[name] += 1
                stats["unresolved_tower_department"] += 1
                # Log aggregate later, not thousands of repetitive issues.
                continue
            row, master_data = matching[0]
            selected_by_line[name].append((index, pole, master_data))

        for name, skipped in out_of_range.items():
            issue(con, "line", "2026-master", groups[name][0][0],
                  "部分坐标杆塔不在可确认的2026管辖范围，未导入",
                  {"line": name, "skipped": skipped})
        for name, entries in groups.items():
            if not selected_by_line[name]:
                for row, master_data in entries:
                    issue(con, "line", "2026-master", row,
                          "此线路没有可确定管辖部门的坐标杆塔",
                          {"line": name, "2026_description": master_data.get(9, "")})
                stats["lines_without_imported_towers"] += 1

        for name, poles in selected_by_line.items():
            # The JSON already stores the actual pole's name; do not regenerate absent poles.
            def sort_key(entry):
                pole = entry[1]
                number = simple_number(pole.get("number"))
                return (number if number is not None else 10000000, tower_number(pole), entry[0])
            poles.sort(key=sort_key)
            duplicates = collections.Counter(tower_number(p) for _, p, _ in poles)
            for order, (source_row, pole, master_data) in enumerate(poles, 1):
                lon, lat = pole.get("lon"), pole.get("lat")
                if not (isinstance(lon, (int, float)) and isinstance(lat, (int, float)) and
                        math.isfinite(lon) and math.isfinite(lat) and -180 <= lon <= 180 and -90 <= lat <= 90):
                    issue(con, "tower", "coordinates", pole.get("sourceRow") or source_row,
                          "杆塔坐标无效", {"line": name, "tower": tower_number(pole)})
                    continue
                # Exact coordinate identity is strong evidence for the same physical mast.
                # A different equipment code at the same position is held apart for safety.
                same_at_coord = (round(lon, 8), round(lat, 8))
                code = pole.get("equipmentCode") or ""
                physical_key = (same_at_coord, code) if code else (same_at_coord, "")
                # Same equipment code often appears across circuits; use coordinates first if code agrees.
                if physical_key not in physical_by_coord:
                    pid = uid("physical", repr(physical_key))
                    physical_by_coord[physical_key] = pid
                    detail = details.get(code, [])
                    matching_details = [(r, d) for r, d in detail if normalize(d.get(1, "")) == normalize(json_names.get(pole["lineId"], ""))]
                    if len(matching_details) == 1:
                        info = matching_details[0][1]
                    elif len(detail) == 1:
                        info = detail[0][1]
                    else:
                        info = {}
                    try:
                        height = round(float(info.get(38)) * 10000) if info.get(38) and float(info.get(38)) > 0 else None
                    except (ValueError, TypeError):
                        height = None
                    con.execute("""INSERT INTO physical_towers
                        (id,tower_code,asset_no,tower_type,longitude,latitude,commissioned_on,status,version,created_at,updated_at,model,height_scaled,purpose)
                        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (pid, "PT-" + pid.replace("-", ""), code or None, info.get(39, ""), lon, lat,
                         info.get(10) or None, "active", 1, DATE, DATE, info.get(8, ""),
                         height, info.get(45, "")))
                    stats["physical_towers"] += 1
                pid = physical_by_coord[physical_key]
                tower_id = uid("logical", pole["id"])
                number = tower_number(pole)
                if duplicates[number] > 1:
                    issue(con, "tower", "coordinates", pole.get("sourceRow") or source_row,
                          "同线路杆塔编号重复，按设备ID保留并待复核",
                          {"line": name, "number": number, "device": pole.get("id")})
                    number += " [" + str(pole["id"]) + "]"
                    stats["duplicate_tower_number_issues"] += 1
                manage = master_data.get(6) or ""
                delegated = master_data.get(15) or ""
                con.execute("""INSERT INTO logical_towers
                    (id,logical_code,line_id,physical_tower_id,tower_no,display_name,sort_rank,circuit_position,status,version,created_at,updated_at,management_department,maintenance_team)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (tower_id, "WT-" + tower_id.replace("-", ""), codes[name], pid,
                     number, None, order*100, None, "active", 1, DATE, DATE, manage, delegated))
                con.execute("""INSERT INTO logical_tower_name_history
                    (id,logical_tower_id,tower_no,display_name,valid_from,valid_to,changed_by,reason,recorded_at)
                    VALUES(?,?,?,?,?,NULL,?,?,?)""",
                    (uid("tower-name", pole["id"]), tower_id, number, None, DATE, admin, "2026清册归属及杆塔原始编号", DATE))
                con.execute("""INSERT INTO logical_tower_physical_history
                    (id,logical_tower_id,physical_tower_id,valid_from,valid_to,change_kind,changed_by,reason,recorded_at)
                    VALUES(?,?,?,?,NULL,?,?,?,?)""",
                    (uid("tower-bind", pole["id"]), tower_id, pid, DATE, "initial", admin, "坐标和设备身份初始化", DATE))
                number_key = str(pole.get("number", "")).lstrip("0") or "0"
                tower_lookup[(pole["lineId"], number_key)].append(tower_id)
                stats["logical_towers"] += 1

        unique_spans = set()
        for row, span in enumerate(coordinates["spans"], 1):
            source_line = span.get("lineId")
            name = line_ids.get(source_line)
            if not name:
                continue
            start = str(span.get("startNumber", "")).lstrip("0") or "0"
            end = str(span.get("endNumber", "")).lstrip("0") or "0"
            start_matches = tower_lookup.get((source_line, start), [])
            end_matches = tower_lookup.get((source_line, end), [])
            if len(start_matches) != 1 or len(end_matches) != 1 or start_matches[0] == end_matches[0]:
                stats["span_unresolved_endpoints"] += 1
                continue
            key = (name, *sorted((start_matches[0], end_matches[0])))
            if key in unique_spans:
                stats["duplicate_span_relationships"] += 1
                continue
            unique_spans.add(key)
            span_id = uid("span", repr(key))
            con.execute("""INSERT INTO line_spans
                (id,line_id,start_tower_id,end_tower_id,status,version,created_by,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?)""",
                (span_id, codes[name], start_matches[0], end_matches[0], "active", 1, admin, DATE, DATE))
            stats["spans"] += 1
        stats["master_2026_rows"] = len(master)
        stats["master_line_names"] = len(groups)
        stats["source_json_towers"] = len(coordinates["poles"])
        stats["source_json_spans"] = len(coordinates["spans"])
        stats["coordinate_lines_matched"] = len(line_ids)
        summary = dict(stats)
        con.execute("INSERT INTO pms_import_runs VALUES(?,?,?,?,?)",
                    (uid("import-run", fingerprint), fingerprint,
                     "2026年8月10日主清册 + 坐标JSON + PMS杆塔明细；各杆塔管辖部门由主台账判定",
                     json.dumps(summary, ensure_ascii=False), DATE))
        if con.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("外键关系校验失败")
        con.commit()
        print("IMPORT_SUCCESS " + json.dumps(summary, ensure_ascii=False))
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()

if __name__ == "__main__":
    import_all()
