#!/usr/bin/env python3
"""Isolated all-object structural parity audit for Schema 113.

Reports table/view/trigger/index/field totals, validates exact matrix and
trigger-document identity, checks FK targets and view compilation. No app or
user-data access, no filesystem mutations; SQLite candidate loaded in memory.
"""
from __future__ import annotations
import re
import sqlite3
from pathlib import Path

ROOT=Path(__file__).resolve().parent
ddl=(ROOT/"数据库V3_结算驱动_候选表结构.sql").read_text()
db=sqlite3.connect(":memory:")
db.row_factory=sqlite3.Row
db.execute("PRAGMA foreign_keys=ON")
db.executescript(ddl)

objects={
    typ:{r["name"]:r for r in db.execute(
        "SELECT name,tbl_name,sql FROM sqlite_master "
        "WHERE type=? AND name NOT LIKE 'sqlite_%'",(typ,))}
    for typ in ("table","view","trigger","index")
}
tables=objects["table"]
views=objects["view"]
triggers=objects["trigger"]
indexes=objects["index"]
columns=0
for table in tables:
    structure=list(db.execute('PRAGMA table_xinfo("'+table+'")'))
    assert structure, "no fields: "+table
    columns+=len(structure)
    assert tables[table]["sql"].upper().rstrip().endswith("STRICT"),"not STRICT: "+table
    for fk in db.execute('PRAGMA foreign_key_list("'+table+'")'):
        assert fk["table"] in tables,"FK target missing: "+table+" -> "+fk["table"]

def matrix_matches():
    path=ROOT/"Schema113_业务对象完整性矩阵.md"
    found={}
    for line in path.read_text().splitlines():
        m=re.fullmatch(
            r'\| ([^|]+) \| §(\w+)§ \| (\d+) \| (\d+) \| (.*) \|',
            line.replace(chr(96),"§"))
        if not m:
            continue
        table=m.group(2)
        assert table not in found,"duplicate matrix table: "+table
        found[table]=(int(m.group(3)),int(m.group(4)))
    assert set(found)==set(tables),(
        "table matrix missing "+str(sorted(set(tables)-set(found)))+
        "; matrix orphans "+str(sorted(set(found)-set(tables))))
    for table,(expected_cols,expected_fk_parts) in found.items():
        actual=(len(list(db.execute('PRAGMA table_xinfo("'+table+'")'))),
                len(list(db.execute('PRAGMA foreign_key_list("'+table+'")'))))
        assert actual==(expected_cols,expected_fk_parts),(
            "matrix field/FK count mismatch "+table+" "+str((actual,found[table])))
    return len(found)

def trigger_matches():
    path=ROOT/"Schema113_触发器约束责任清单.md"
    found={}
    for line in path.read_text().splitlines():
        m=re.fullmatch(r'\| §(\w+)§ \| §(\w+)§ \| ([^|]+) \| ([^|]+) \|',
                       line.replace(chr(96),"§"))
        if not m:
            continue
        table,name=m.group(1),m.group(2)
        assert name not in found,"duplicate trigger list name: "+name
        found[name]=table
    assert set(found)==set(triggers),(
        "trigger list missing "+str(sorted(set(triggers)-set(found)))+
        "; orphan "+str(sorted(set(found)-set(triggers))))
    for name,table in found.items():
        assert triggers[name]["tbl_name"]==table,"trigger wrong owner "+name
    return len(found)

matrix_count=matrix_matches()
trigger_count=trigger_matches()
for name in views:
    db.execute('SELECT * FROM "'+name+'" LIMIT 0')
assert db.execute("PRAGMA integrity_check").fetchone()[0]=="ok"
assert db.execute("PRAGMA foreign_key_check").fetchall()==[]

for removed in ("executions","completion_records","material_usage_records",
                "material_usage_revisions","cost_allocations","cost_allocation_versions"):
    assert removed not in tables,"superseded business table restored "+removed
for removed in ("v_completion_current","v_material_usage_current",
                "v_cost_allocation_current"):
    assert removed not in views,"superseded business view restored "+removed
cost_fields={r["name"] for r in db.execute("PRAGMA table_xinfo(cost_versions)")}
assert "category_id" not in cost_fields and "category_snapshot" not in cost_fields
assert "cost_node_version_id" in cost_fields
root_fields={r["name"] for r in db.execute("PRAGMA table_xinfo(projects)")}
assert not {"name","category_id","updated_at"}&root_fields
org_fields={r["name"] for r in db.execute("PRAGMA table_xinfo(organizational_units)")}
assert not {"name","parent_id","status"}&org_fields
assert "organizational_unit_versions" in tables
assert "v_organizational_unit_current" in views
version_fields={r["name"] for r in db.execute(
    "PRAGMA table_xinfo(project_management_versions)")}
assert {"name","category_version","managing_unit_id",
        "managing_unit_version_id"}<=version_fields
assert not {"responsible_unit_id","responsible_unit_version_id"} & version_fields
# This is the subproject's administrative managing unit, not a contractor or
# physical execution unit. Its active meaning is one unit per profile version,
# with an immutable typed master definition binding both stable and version IDs.
unit_columns={r["name"]:r for r in db.execute(
    "PRAGMA table_info(project_management_versions)")}
assert unit_columns["managing_unit_id"]["notnull"]==0
assert unit_columns["managing_unit_version_id"]["notnull"]==0
assert any(x["name"]=="idx_project_managing_unit" for x in db.execute(
    "PRAGMA index_list(project_management_versions)"))

# A complete set of relevant indexes is preferable to blind FK indexing,
# but any non-partial explicit index exactly covered by a longer equivalent
# non-partial index on its first columns is a redundancy warning.
redundant=[]
for table in tables:
    listing=list(db.execute('PRAGMA index_list("'+table+'")'))
    signatures={}
    for ix in listing:
        name=ix["name"]
        cols=tuple(r["name"] for r in db.execute(
            'PRAGMA index_xinfo("'+name+'")') if r["key"]==1)
        signatures[name]=(cols,ix["origin"],ix["partial"])
    for name,(cols,origin,partial) in signatures.items():
        if origin!="c" or partial or not cols:continue
        for other,(othercols,otherorigin,otherpartial) in signatures.items():
            if other==name or otherpartial or not othercols:continue
            if othercols[:len(cols)]==cols and (
                len(othercols)>len(cols) or
                (len(othercols)==len(cols) and otherorigin!="c")):
                redundant.append((table,name,other))
                break
assert not redundant,"redundant overlapping indexes: "+str(redundant)
print("SCHEMA113_FULL_STRUCTURE_AUDIT_OK",len(tables),"STRICT tables,",
      len(views),"views,",len(triggers),"triggers,",len(indexes),"indexes,",
      columns,"columns,",matrix_count,"matrix tables,",
      trigger_count,"listed triggers; all FK, views, indexes and history boundaries pass")
