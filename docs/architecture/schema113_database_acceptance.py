#!/usr/bin/env python3
"""Isolated SQLite design-contract tests for the Schema 113 candidate.

No application code, user database, frontend or network access.
Usage: python3 -B docs/architecture/schema113_database_acceptance.py
"""
from __future__ import annotations
import sqlite3
import tempfile
from pathlib import Path

schema = Path(__file__).with_name("数据库V3_结算驱动_候选表结构.sql")
db = sqlite3.connect(":memory:")
db.row_factory = sqlite3.Row
db.execute("PRAGMA foreign_keys=ON")
db.executescript(schema.read_text())
checks = []

def insert_raw(t, **data):
    names=list(data)
    db.execute(
        f"INSERT INTO {t} ({','.join(names)}) VALUES ({','.join('?' for _ in names)})",
        list(data.values()),
    )

def add(t, **data):
    if t=="materials":
        # Test-fixture convenience only. Production writes root and v1 in one
        # BEGIN IMMEDIATE transaction; the SQL contract requires both.
        insert_raw("materials",**{k:data[k] for k in
            ("id","code","unit_id","created_by","created_at")
            if k in data})
        insert_raw("material_versions",id=data["id"]+"_v1",
            material_id=data["id"],version_no=1,
            pms_material_code=data.get("pms_material_code"),name=data["name"],
            model=data.get("model",""),specification=data.get("specification",""),
            category_id=data.get("category_id"),status=data.get("status","active"),
            note=data.get("note",""),reason="首次登记",
            changed_by=data.get("created_by") or "u",
            recorded_at=data.get("updated_at") or data["created_at"])
        return
    if t=="project_approval_material_items" and "material_version_id" not in data:
        material_id=db.execute("SELECT material_id FROM project_scope_materials "
            "WHERE id=?",(data["project_material_id"],)).fetchone()[0]
        data["material_version_id"]=db.execute(
            "SELECT material_version_id FROM v_material_current WHERE id=?",
            (material_id,)).fetchone()[0]
    if t in ('cost_entries', 'settlement_items') and 'cost_node_id' not in data:
        # Only the legacy *test fixtures* use an implicit default terminal node.
        # The actual DDL requires callers to explicitly select the expense node.
        project_id=(data['project_id'] if t=='cost_entries' else
            db.execute('SELECT project_id FROM settlements WHERE id=?',
                (data['settlement_id'],)).fetchone()[0])
        node_id=f'fixture_fee_{project_id}'
        if not db.execute('SELECT 1 FROM project_cost_nodes WHERE id=?',
                          (node_id,)).fetchone():
            insert_raw('project_cost_nodes',id=node_id,project_id=project_id,
                parent_id=None,created_by='u',created_at='2026-11-07T00:00:00.000Z')
            insert_raw('project_cost_node_versions',id=node_id+'_v1',
                node_id=node_id,version_no=1,name='测试默认费用项',
                status='active',reason='测试定义',actor_id='u',
                recorded_at='2026-11-07T00:00:00.000Z')
        data['cost_node_id']=node_id
    if t in ('cost_versions','settlement_item_versions') and 'cost_node_version_id' not in data:
        if t=='cost_versions':
            cost_node_id=db.execute('SELECT cost_node_id FROM cost_entries WHERE id=?',
                (data['entry_id'],)).fetchone()[0]
        else:
            cost_node_id=db.execute('SELECT cost_node_id FROM settlement_items WHERE id=?',
                (data['settlement_item_id'],)).fetchone()[0]
        data['cost_node_version_id']=db.execute(
            'SELECT id FROM project_cost_node_versions WHERE node_id=? '
            'ORDER BY version_no DESC LIMIT 1',(cost_node_id,)).fetchone()[0]
    insert_raw(t,**data)

def revise_material(material_id, *, recorded_at, reason, changed_by="u",
                    **changes):
    current=db.execute("SELECT * FROM v_material_current WHERE id=?",
        (material_id,)).fetchone()
    assert current is not None, material_id
    fields={k:changes.get(k,current[k]) for k in
        ("name","model","specification","category_id","status","note",
         "pms_material_code")}
    version_no=current["version_no"]+1
    insert_raw("material_versions",id=f"{material_id}_v{version_no}",
        material_id=material_id,version_no=version_no,
        reason=reason,changed_by=changed_by,
        recorded_at=recorded_at,**fields)

def row(sql, *args):
    result = db.execute(sql, args).fetchone()
    assert result is not None, sql
    return result

def ok(label, value=True):
    assert value, label
    checks.append(label)
    print("PASS", label)

def blocked(label, sql, args=()):
    db.execute("SAVEPOINT invalid")
    try:
        db.execute(sql, args)
    except sqlite3.IntegrityError:
        checks.append(label)
        print("PASS BLOCKED", label)
    else:
        raise AssertionError("Invalid write was allowed: " + label)
    finally:
        db.execute("ROLLBACK TO invalid")
        db.execute("RELEASE invalid")

def approval(id, no, budget, change_id=None, status="draft"):
    assert status=="draft"
    add("project_approval_versions", id=id, project_id="p",
        version_no=no,change_order_id=change_id,snapshot_json="{}",
        approved_budget_fen=budget,created_at="2026-11-07T00:00:00.000Z")

def approve(id):
    db.execute("UPDATE project_approval_versions SET status='approved',"
        "approved_by='u',approved_at='2026-11-07T00:00:00.000Z' WHERE id=?", (id,))

def stage(project_id, target, actor="u", time="2026-11-07T00:00:00.000Z"):
    current = row("SELECT version FROM projects WHERE id=?", project_id)
    add("project_stage_events",id=f"stage_{project_id}_{current['version']+1}",
        project_id=project_id,stage=target,project_version=current["version"]+1,
        reason=f"正式状态流转：{target}",
        actor_id=actor,created_at=time)

def demand(name,batch_id=None):
    add("demands",id=name,demand_no=name,batch_id=batch_id,logical_tower_id="tower",
        observed_physical_tower_id=row("SELECT physical_tower_id FROM logical_towers WHERE id='tower'")["physical_tower_id"],
        line_name_snapshot=row("SELECT name FROM transmission_lines WHERE id='line'")["name"],
        tower_no_snapshot="001",
        work_target_type="line",operation_id="op",operation_version=1,
        operation_snapshot="更换",work_object_id="obj",work_object_snapshot="绝缘子",
        target_object="A相",quantity_scaled=10000,unit_id="unit",
        unit_version=1,unit_snapshot="套",completion_standard="合格",
        problem_description="隐患",created_by="u",created_at="2026-11-07T00:00:00.000Z")

def activate_demand(name):
    current = row("SELECT event_seq,to_status FROM demand_lifecycle_events "
                  "WHERE demand_id=? ORDER BY event_seq DESC LIMIT 1", name)
    assert current["to_status"]=="pending",name
    add("demand_lifecycle_events",id="activate_"+name,demand_id=name,
        event_seq=current["event_seq"]+1,from_status="pending",
        to_status="active",reason="专业需求正式确认",
        actor_id="u",recorded_at="2026-11-07T00:00:00.000Z")

def event(ver,seq,action):
    add("settlement_review_events",id=f"review{ver}_{seq}",
        settlement_version_id=ver,event_seq=seq,action=action,
        actor_id="u",recorded_at=f"2026-11-07T10:00:{seq:02d}.000Z",
        effective_on="2026-11-07" if action=="approve" else None)

def settlement_version(name,seq,amount):
    add("settlement_versions",id=name,settlement_id="st",
        version_no=seq,previous_version_id=None if seq==1 else "stv1",
        approval_version_id="av1",funding_version_id="fund1",
        change_type="initial" if seq==1 else "revision",
        reason="正式版本",created_by="u",recorded_at="2026-11-07T00:00:00.000Z")
    add("settlement_item_versions",id="item"+name,settlement_version_id=name,
        settlement_item_id="it",approval_scope_version_id="scopev1",
        amount_fen=amount,quantity_scaled=10000,
        evidence="验收记录",scope_snapshot_json="{}")

def net():
    return row("SELECT COALESCE(SUM(net_amount_fen),0) n "
        "FROM v_effective_settlement_items")["n"]

add("users",id="u",username="admin",password_hash="x",role="admin",created_at="2026-11-07T00:00:00.000Z")
add("dictionary_types",id="unit",title="计量单位")
add("dictionary_types",id="expense_category",title="费用类别")
add("dictionary_items",id="unit",type_id="unit",code="set",
    created_at="2026-11-07T00:00:00.000Z")
add("dictionary_items",id="expense",type_id="expense_category",
    code="exp",created_at="2026-11-07T00:00:00.000Z")
add("dictionary_item_versions",id="unitv1",item_id="unit",version=1,
    name="套",status="active",reason="首次定义",changed_by="u",changed_at="2026-11-07T00:00:00.000Z")
add("dictionary_item_versions",id="expensev1",item_id="expense",version=1,
    name="费用",status="active",reason="首次定义",changed_by="u",changed_at="2026-11-07T00:00:00.000Z")
add("voltage_levels",id="vol",code="110",name="110kV")
add("transmission_lines",id="line",line_code="L",name="L",voltage_level_id="vol",created_by="u")
add("physical_towers",id="pt",tower_code="PT",created_by="u")
add("logical_towers",id="tower",logical_code="T",line_id="line",created_by="u",
    physical_tower_id="pt",tower_no="001",sort_rank=1)
add("work_objects",id="obj",code="OBJ",created_at="2026-11-07T00:00:00.000Z")
add("work_object_versions",id="objv1",work_object_id="obj",version_no=1,
    name="绝缘子",work_target_type="line",status="active",reason="首次发布",
    changed_by="u",recorded_at="2026-11-07T00:00:00.000Z")
add("operations",id="op",code="OP",created_at="2026-11-07T00:00:00.000Z")
add("operation_versions",id="ov",operation_id="op",version=1,
    name="更换",status="active",work_target_type="line",
    work_object_id="obj",default_unit_id="unit",default_unit_version=1,allow_tower=1,
    allow_span=0,default_location_kind="tower",reason="首次定义",
    changed_by="u",changed_at="2026-11-07T00:00:00.000Z")
add("materials",id="master1",code="MAT-001",name="绝缘子",
    model="A",unit_id="unit",created_at="2026-11-07T00:00:00.000Z",updated_at="2026-11-07T00:00:00.000Z")
demand("d")
add("demand_material_items",id="dm",demand_id="d",item_no=1,
    material_id="master1",quantity_scaled=1000,
    created_at="2026-11-07T00:00:00.000Z",updated_at="2026-11-07T00:00:00.000Z")
activate_demand("d")
add("frameworks",id="f",code="F",fiscal_year=2026,created_at="2026-11-07T00:00:00.000Z")
add("frameworks",id="f2",code="F2",fiscal_year=2026,created_at="2026-11-07T00:00:00.000Z")
add("framework_versions",id="fv1",framework_id="f",version_no=1,
    name="年度框架",limit_fen=1000,status="active",reason="首次发布",
    changed_by="u",recorded_at="2026-11-07T00:00:00.000Z")
add("framework_versions",id="fv2",framework_id="f2",version_no=1,
    name="另一个框架",limit_fen=1000,status="active",reason="首次发布",
    changed_by="u",recorded_at="2026-11-07T00:00:00.000Z")
add("agreements",id="ag",code="AG",framework_id="f",created_at="2026-11-07T00:00:00.000Z")
add("agreements",id="ag2",code="AG2",framework_id="f2",created_at="2026-11-07T00:00:00.000Z")
add("agreement_versions",id="agv1",agreement_id="ag",version_no=1,
    name="协议",limit_fen=600,status="active",reason="首次发布",
    changed_by="u",recorded_at="2026-11-07T00:00:00.000Z")
add("agreement_versions",id="agv2",agreement_id="ag2",version_no=1,
    name="其他协议",limit_fen=600,status="active",reason="首次发布",
    changed_by="u",recorded_at="2026-11-07T00:00:00.000Z")
add("projects",id="p",code="P",name="无协议子项目",
    framework_id="f",created_by="u",created_at="2026-11-07T00:00:00.000Z",updated_at="2026-11-07T00:00:00.000Z")
stage("p","stocked")
add("project_funding_versions",id="fund1",project_id="p",
    version_no=1,agreement_id=None,reason="无协议立项",
    actor_id="u",recorded_at="2026-11-07T00:00:00.000Z")
approval("av1",1,5000)
blocked("incomplete approval cannot finalize",
    "UPDATE project_approval_versions SET status='approved',"
    "approved_by='u',approved_at='2026-11-07T00:00:00.000Z' WHERE id='av1'")
add("project_demand_scopes",id="scope",project_id="p",demand_id="d",
    demand_version=1,proposed_quantity_scaled=10000,proposed_amount_fen=5000,
    created_at="2026-11-07T00:00:00.000Z",updated_at="2026-11-07T00:00:00.000Z")
add("project_approval_scope_versions",id="scopev1",approval_version_id="av1",
    project_scope_id="scope",demand_id="d",demand_version=1,quantity_scaled=10000,
    approved_amount_fen=5000,snapshot_json="{}",created_at="2026-11-07T00:00:00.000Z")
add("project_scope_materials",id="mat",project_scope_id="scope",
    material_id="master1",created_at="2026-11-07T00:00:00.000Z")
add("project_approval_material_items",id="am1",approval_version_id="av1",
    project_scope_id="scope",project_material_id="mat",item_no=1,
    material_code_snapshot="MAT-001",material_name="绝缘子",
    material_model="A",approved_quantity_scaled=1000,
    unit_id="unit",unit_snapshot="套")
approve("av1")
stage("p","approved")
ok("approval baseline owned by immutable approval version",
    row("SELECT approved_budget_fen FROM v_project_current_approval "
        "WHERE project_id='p'")["approved_budget_fen"]==5000)
ok("optional funding is null",
    row("SELECT agreement_id FROM v_project_funding_current "
        "WHERE project_id='p'")["agreement_id"] is None)
blocked("cannot append approval materials after approval",
    "INSERT INTO project_approval_material_items"
    "(id,approval_version_id,project_scope_id,project_material_id,item_no,"
    "material_code_snapshot,material_name,material_model,approved_quantity_scaled,unit_id,unit_snapshot)"
    " VALUES('x','av1','scope','mat',2,'MAT-001','绝缘子','A',1,'unit','套')")
blocked("project home immutable",
    "UPDATE projects SET framework_id='f2' WHERE id='p'")
blocked("cross-framework agreement forbidden",
    "INSERT INTO project_funding_versions"
    "(id,project_id,version_no,agreement_id,reason,actor_id,recorded_at)"
    " VALUES('bad','p',2,'ag2','错误关联','u','2026-11-07T00:00:00.000Z')")
add("settlements",id="st",project_id="p",number="S1",
    created_by="u",created_at="2026-11-07T00:00:00.000Z")
add("settlement_items",id="it",settlement_id="st",
    project_scope_id="scope",created_at="2026-11-07T00:00:00.000Z")
settlement_version("stv1",1,8000)
event("stv1",1,"submit")
event("stv1",2,"approve")
ok("settlement over budget accepted",net()==8000)
blocked("immutable historical settlement item",
    "UPDATE settlement_item_versions SET amount_fen=0 WHERE id='itemstv1'")
# Formal project change V2, including approved amount and material changes.
add("project_change_orders",id="chg",project_id="p",code="CHG",
    base_approval_version_id="av1",proposal_json="{}",reason="预算范围调整",
    created_by="u",created_at="2026-11-07T00:00:00.000Z")
db.execute("UPDATE project_change_orders SET status='approved',"
    "decided_by='u',decided_at='2026-11-07T00:00:00.000Z',decision_reason='已核定' WHERE id='chg'")
approval("av2",2,7000,"chg")
add("project_approval_scope_versions",id="scopev2",approval_version_id="av2",
    project_scope_id="scope",demand_id="d",demand_version=1,quantity_scaled=30000,
    approved_amount_fen=4000,snapshot_json="{}",created_at="2026-11-07T00:00:00.000Z")
add("project_approval_material_items",id="am2",approval_version_id="av2",
    project_scope_id="scope",project_material_id="mat",item_no=1,
    material_code_snapshot="MAT-001",material_name="绝缘子",
    material_model="A",approved_quantity_scaled=3000,
    unit_id="unit",unit_snapshot="套")
ok("draft approval V2 must not change official budget",
    row("SELECT approved_budget_fen FROM v_project_current_approval "
        "WHERE project_id='p'")["approved_budget_fen"]==5000)
approve("av2")
ok("new approved budget replaces old budget not adds",
    row("SELECT approved_budget_fen FROM v_project_current_approval "
        "WHERE project_id='p'")["approved_budget_fen"]==7000)
approved_scope=row("SELECT quantity_scaled,approved_amount_fen "
    "FROM v_approval_scope_current WHERE project_scope_id='scope'")
settled=row("SELECT COALESCE(SUM(net_amount_fen),0) AS n "
    "FROM v_effective_settlement_items WHERE project_scope_id='scope'")["n"]
ok("approved scope and installment settlement remain separate real facts",
    (approved_scope["quantity_scaled"],approved_scope["approved_amount_fen"],settled)
    ==(30000,4000,8000))
approved_material=row("SELECT approved_quantity_scaled FROM v_approved_material_current "
    "WHERE project_material_id='mat'")["approved_quantity_scaled"]
ok("approved material remains a separate formal versioned project fact",
    approved_material==3000
    and row("SELECT approved_quantity_scaled FROM project_approval_material_items "
            "WHERE id='am1'")["approved_quantity_scaled"]==1000)
add("project_funding_versions",id="fund2",project_id="p",
    version_no=2,agreement_id="ag",reason="后续选择执行协议",
    actor_id="u",recorded_at="2026-11-07T00:00:00.000Z")
ok("current project agreement is sourced from funding identity/version",
    row("SELECT agreement_id FROM v_project_funding_current "
        "WHERE project_id='p'")["agreement_id"]=="ag")
agreement_limit=row("SELECT limit_fen FROM v_agreement_current WHERE id='ag'")["limit_fen"]
project_approved=row("SELECT approved_budget_fen FROM v_project_current_approval "
    "WHERE project_id='p'")["approved_budget_fen"]
ok("project approval may exceed agreement budget without a database cap",
    (project_approved,agreement_limit)==(7000,600))
# A further approval draft contains no scope: it cannot replace approved V2.
add("project_change_orders",id="chg2",project_id="p",code="CHG2",
    base_approval_version_id="av2",proposal_json="{}",reason="再次调整",
    created_by="u",created_at="2026-11-07T00:00:00.000Z")
db.execute("UPDATE project_change_orders SET status='approved',"
    "decided_by='u',decided_at='2026-11-07T00:00:00.000Z',decision_reason='同意' WHERE id='chg2'")
approval("av3",3,20000,"chg2")
blocked("incomplete later approval cannot hide current scope",
    "UPDATE project_approval_versions SET status='approved',"
    "approved_by='u',approved_at='2026-11-07T00:00:00.000Z' WHERE id='av3'")
ok("draft V3 does not mask officially approved V2",
    row("SELECT approved_budget_fen FROM v_project_current_approval "
        "WHERE project_id='p'")["approved_budget_fen"]==7000)
# New settlement version submitted but not yet approved does not change net.
add("settlement_versions",id="stv2",settlement_id="st",version_no=2,
    previous_version_id="stv1",approval_version_id="av2",
    funding_version_id="fund2",
    change_type="revision",reason="重新结算",recorded_at="2026-11-07T00:00:00.000Z",
    created_by="u")
add("settlement_item_versions",id="itemstv2",settlement_version_id="stv2",
    settlement_item_id="it",approval_scope_version_id="scopev2",
    amount_fen=10500,quantity_scaled=30000,evidence="复核",
    scope_snapshot_json="{}")
event("stv2",1,"submit")
ok("pending settlement V2 leaves previous amount intact",net()==8000)
event("stv2",2,"approve")
ok("approved settlement V2 replaces prior amount",net()==10500)
# Content-addressed files with referential owner, not a loose generic entity_id.
sha="a"*64
add("evidence_files",id="ef",sha256=sha,
    storage_key="sha256/aa/"+sha,filename="签章结算.pdf",bytes=900,
    mime="application/pdf",uploaded_by="u",created_at="2026-11-07T00:00:00.000Z")
add("evidence_links",id="e1",file_id="ef",settlement_version_id="stv1",
    linked_by="u",linked_at="2026-11-07T00:00:00.000Z")
add("evidence_links",id="e2",file_id="ef",
    settlement_review_event_id="reviewstv1_2",linked_by="u",linked_at="2026-11-07T00:00:00.000Z")
blocked("evidence link cannot own two different business facts",
    "INSERT INTO evidence_links(id,file_id,settlement_version_id,"
    "settlement_review_event_id,linked_by,linked_at) "
    "VALUES('bad','ef','stv1','reviewstv1_2','u','2026-11-07T00:00:00.000Z')")
blocked("immutable physical evidence",
    "UPDATE evidence_files SET bytes=899 WHERE id='ef'")
# Asset/topology historical snapshots are real foreign-keyed identities.
add("physical_towers",id="pt2",tower_code="PT2",created_by="u")
add("logical_towers",id="tower2",logical_code="T2",line_id="line",created_by="u",
    physical_tower_id="pt2",tower_no="002",sort_rank=2)
add("line_spans",id="span",line_id="line",start_tower_id="tower",
    end_tower_id="tower2",status="active",version=1,created_by="u",
    created_at="2026-11-07T09:00:00.000Z",updated_at="2026-11-07T09:00:00.000Z")
ok("initial span topology recorded",row(
    "SELECT count(*) n FROM line_span_history WHERE span_id='span'")["n"]==1)
blocked("span cannot change endpoints without new historical version",
    "UPDATE line_spans SET status='retired' WHERE id='span'")
db.execute("UPDATE line_spans SET status='retired',version=2,"
    "updated_by='u',change_reason='杆段调整',updated_at='2026-11-07T11:00:00.000Z'"
    " WHERE id='span'")
ok("topology update retains prior endpoints and version",
    row("SELECT COUNT(*) n FROM line_span_history WHERE span_id='span'")["n"]==2)
blocked("span historical topology cannot be overwritten",
    "UPDATE line_span_history SET status='draft' WHERE span_id='span' AND version_no=1")
# Typed dictionary changes preserve demand's bound historical unit.
add("dictionary_item_versions",id="unitv2",item_id="unit",version=2,
    name="组",status="active",reason="单位名称调整",changed_by="u",changed_at="2026-11-07T00:00:00.000Z")
ok("historical unit identity independent from newest label",
    row("SELECT unit_snapshot FROM demands WHERE id='d'")["unit_snapshot"]=="套"
    and row("SELECT name FROM v_dictionary_current WHERE id='unit'")["name"]=="组")
# A newer complete project approval can remove an old approved scope entirely,
# without deleting actual work/material historical facts.
demand("d2")
activate_demand("d2")
add("project_demand_scopes",id="scope2",project_id="p",demand_id="d2",
    demand_version=1,proposed_quantity_scaled=5000,proposed_amount_fen=1000,
    created_at="2026-11-07T00:00:00.000Z",updated_at="2026-11-07T00:00:00.000Z")
add("project_approval_scope_versions",id="scopev3",approval_version_id="av3",
    project_scope_id="scope2",demand_id="d2",demand_version=1,quantity_scaled=5000,
    approved_amount_fen=1000,snapshot_json="{}",created_at="2026-11-07T00:00:00.000Z")
approve("av3")
ok("new approved version entirely replaces old effective scope",
    row("SELECT COUNT(*) n FROM v_approval_scope_current a "
        "JOIN project_approval_versions ap ON ap.id=a.approval_version_id "
        "WHERE ap.project_id='p'")["n"]==1
    and row("SELECT project_scope_id FROM v_approval_scope_current a "
        "JOIN project_approval_versions ap ON ap.id=a.approval_version_id "
        "WHERE ap.project_id='p'")["project_scope_id"]=="scope2")
ok("old material approval history survives scope retirement",
    row("SELECT COUNT(*) n FROM v_approved_material_current "
        "WHERE project_material_id='mat'")["n"]==0
    and row("SELECT COUNT(*) n FROM project_approval_material_items "
            "WHERE project_material_id='mat'")["n"]==2)
ok("approved project budget uses newest full version",
    row("SELECT approved_budget_fen FROM v_project_current_approval "
        "WHERE project_id='p'")["approved_budget_fen"]==20000)
add("projects",id="p_other",code="P_OTHER",name="另一个子项目",
    framework_id="f",created_by="u",created_at="2026-11-07T00:00:00.000Z",updated_at="2026-11-07T00:00:00.000Z")
add("project_demand_scopes",id="other_scope",project_id="p_other",
    demand_id="d",demand_version=1,proposed_quantity_scaled=10000,
    proposed_amount_fen=500,created_at="2026-11-07T00:00:00.000Z",updated_at="2026-11-07T00:00:00.000Z")
add("project_approval_versions",id="other_av",project_id="p_other",
    version_no=1,approved_budget_fen=500,snapshot_json="{}",created_at="2026-11-07T00:00:00.000Z")
add("project_approval_scope_versions",id="other_ap_scope",
    approval_version_id="other_av",project_scope_id="other_scope",
    demand_id="d",demand_version=1,quantity_scaled=10000,approved_amount_fen=500,
    snapshot_json="{}",created_at="2026-11-07T00:00:00.000Z")
blocked("another project cannot formally adopt an already approved demand",
    "UPDATE project_approval_versions SET status='approved',"
    "approved_by='u',approved_at='2026-11-07T00:00:00.000Z' WHERE id='other_av'")
# Material root is a stable identity; all descriptive material definitions
# are immutable full versions, not independent current-state duplicates.
ok("material master has a dedicated immutable full-version table",
    row("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'"
        " AND name='material_versions'")["n"]==1
    and row("SELECT material_version_id FROM v_material_current "
        "WHERE id='master1'")["material_version_id"]=="master1_v1")
blocked("material master cannot use a non-unit dictionary type",
    "INSERT INTO materials(id,code,unit_id,created_at)"
    " VALUES('badUnit','BAD-U','expense','2026-11-07T00:00:00.000Z')")
blocked("material master code is unique",
    "INSERT INTO materials(id,code,unit_id,created_at)"
    " VALUES('duplicate','MAT-001','unit','2026-11-07T00:00:00.000Z')")
blocked("referenced material cannot silently change units",
    "UPDATE materials SET unit_id='expense' WHERE id='master1'")
blocked("material code is permanent identity",
    "UPDATE materials SET code='MAT-001-A' WHERE id='master1'")
# A genuine new physical material used on site is allowed without a planned BOM
# or an approved material row. Still identified by the same shared master table.
add("materials",id="master2",code="MAT-002",name="连接金具",
    model="JG-01",specification="热镀锌",unit_id="unit",
    created_at="2026-11-07T00:00:00.000Z",updated_at="2026-11-07T00:00:00.000Z")
add("project_scope_materials",id="unplanned_mat",project_scope_id="scope",
    material_id="master2",addition_reason="作业中新增",created_at="2026-11-07T00:00:00.000Z")
ok("additional project material has shared master identity, not a fake approval",
    row("SELECT m.code code,pm.addition_reason reason "
        "FROM project_scope_materials pm "
        "JOIN materials m ON m.id=pm.material_id "
        "WHERE pm.id='unplanned_mat'")["code"]=="MAT-002"
    and row("SELECT COUNT(*) n FROM project_approval_material_items "
        "WHERE project_material_id='unplanned_mat'")["n"]==0)
blocked("newly included project material requires a reason",
    "INSERT INTO project_scope_materials(id,project_scope_id,material_id,"
    "addition_reason,created_at) VALUES('unexplained_material','scope',"
    "'master2','','2026-11-07T00:00:00.000Z')")
# Material names/models become immutable version records; approved snapshots
# keep their own time-of-approval facts.
revise_material("master1",name="复合绝缘子",model="A-改",
    recorded_at="2026-11-07T01:00:00.000Z",reason="核实新型号")
ok("material master latest description is derived from a real immutable version",
    row("SELECT name,model FROM v_material_current WHERE id='master1'")["name"]
       =="复合绝缘子"
    and row("SELECT model FROM v_material_current WHERE id='master1'")["model"]
       =="A-改"
    and row("SELECT model FROM material_versions WHERE id='master1_v1'")["model"]
       =="A")
ok("approved material snapshot preserves historical name and model",
    row("SELECT material_name,material_model,material_code_snapshot FROM "
        "project_approval_material_items WHERE id='am1'")["material_name"]=="绝缘子"
    and row("SELECT material_model FROM project_approval_material_items "
        "WHERE id='am1'")["material_model"]=="A"
    and row("SELECT material_code_snapshot FROM project_approval_material_items "
        "WHERE id='am1'")["material_code_snapshot"]=="MAT-001")
# A different project with its own demand still references the SAME master ID.
# The same material master can be approved separately for two projects.
demand("d3")
add("demand_material_items",id="dm3",demand_id="d3",item_no=1,
    material_id="master1",quantity_scaled=2000,created_at="2026-11-07T00:00:00.000Z",updated_at="2026-11-07T00:00:00.000Z")
activate_demand("d3")
add("projects",id="p3",code="P3",name="另一子项目",framework_id="f",
    created_by="u",created_at="2026-11-07T00:00:00.000Z",updated_at="2026-11-07T00:00:00.000Z")
stage("p3","stocked")
add("project_approval_versions",id="avp3",project_id="p3",version_no=1,
    approved_budget_fen=2000,snapshot_json="{}",created_at="2026-11-07T00:00:00.000Z")
add("project_demand_scopes",id="s3",project_id="p3",demand_id="d3",
    demand_version=1,proposed_quantity_scaled=10000,proposed_amount_fen=2000,
    created_at="2026-11-07T00:00:00.000Z",updated_at="2026-11-07T00:00:00.000Z")
add("project_approval_scope_versions",id="sv3",approval_version_id="avp3",
    project_scope_id="s3",demand_id="d3",demand_version=1,quantity_scaled=10000,
    approved_amount_fen=2000,snapshot_json="{}",created_at="2026-11-07T00:00:00.000Z")
add("project_scope_materials",id="p3m",project_scope_id="s3",
    material_id="master1",created_at="2026-11-07T00:00:00.000Z")
add("project_approval_material_items",id="p3am",approval_version_id="avp3",
    project_scope_id="s3",project_material_id="p3m",
    item_no=1,
    material_code_snapshot="MAT-001",material_name="复合绝缘子",
    material_model="A-改",approved_quantity_scaled=2000,
    unit_id="unit",unit_snapshot="组")
db.execute("UPDATE project_approval_versions SET status='approved',"
    "approved_by='u',approved_at='2026-11-07T00:00:00.000Z' WHERE id='avp3'")
stage("p3","approved")
add("settlements",id="st3",project_id="p3",number="S3",
    created_by="u",created_at="2026-11-07T00:00:00.000Z")
add("settlement_items",id="it3",settlement_id="st3",
    project_scope_id="s3",created_at="2026-11-07T00:00:00.000Z")
ok("two projects reuse one material master with distinct approved material identities",
    row("SELECT COUNT(DISTINCT pm.project_scope_id) scopes "
        "FROM project_scope_materials pm WHERE pm.material_id='master1'")["scopes"]==2
    and row("SELECT COUNT(DISTINCT a.project_material_id) ids "
        "FROM project_approval_material_items a "
        "JOIN project_scope_materials pm ON pm.id=a.project_material_id "
        "WHERE pm.material_id='master1'")["ids"]==2
    and row("SELECT material_model FROM project_approval_material_items "
        "WHERE id='p3am'")["material_model"]=="A-改"
    and row("SELECT material_model FROM project_approval_material_items "
        "WHERE id='am1'")["material_model"]=="A")
# Previously proven failures must remain blocked forever.
blocked("STRICT forbids null material primary keys",
    "INSERT INTO materials(id,code,unit_id,created_at)"
    " VALUES(NULL,'NULL-1','unit','2026-11-07T00:00:00.000Z')")
blocked("STRICT forbids text in scaled quantity",
    "INSERT INTO demand_material_items(id,demand_id,item_no,material_id,quantity_scaled,"
    "created_at,updated_at) VALUES('badqty','d',13,'master1','notanumber',"
    "'2026-11-07T00:00:00.000Z','2026-11-07T00:00:00.000Z')")
blocked("STRICT forbids fractional scaled quantity",
    "INSERT INTO demand_material_items(id,demand_id,item_no,material_id,quantity_scaled,"
    "created_at,updated_at) VALUES('badreal','d',13,'master1',1.5,"
    "'2026-11-07T00:00:00.000Z','2026-11-07T00:00:00.000Z')")
for label,bad_time in [
    ("invalid material version timestamp","tomorrow"),
    ("invalid material version calendar date","2026-02-30T00:00:00.000Z")
]:
    blocked(label,
        "INSERT INTO material_versions(id,material_id,version_no,name,status,"
        "reason,changed_by,recorded_at) VALUES(?,?,?,?,?,?,?,?)",
        ("bad_material_time","master1",3,"非法版本","active",
         "非法时间","u",bad_time))
blocked("material code unique ignores ASCII case",
    "INSERT INTO materials(id,code,unit_id,created_at)"
    " VALUES('case001','mat-001','unit','2026-11-07T00:00:00.000Z')")
blocked("same scope and material cannot create duplicate project identity",
    "INSERT INTO project_scope_materials(id,project_scope_id,material_id,created_at)"
    " VALUES('duplicate_master','scope','master1','2026-11-07T00:00:00.000Z')")
db.execute("SAVEPOINT inactive")
revise_material("master2",status="inactive",
    recorded_at="2026-11-07T01:00:00.000Z",reason="暂时停用物资")
blocked("inactive master barred from a NEW demand",
    "INSERT INTO demand_material_items(id,demand_id,item_no,material_id,quantity_scaled,"
    "created_at,updated_at) VALUES('inactive_new','d3',9,'master2',100,"
    "'2026-11-07T00:00:00.000Z','2026-11-07T00:00:00.000Z')")
db.execute("ROLLBACK TO inactive")
db.execute("RELEASE inactive")

blocked("published demand quantity cannot be overwritten",
    "UPDATE demands SET quantity_scaled=123456 WHERE id='d'")
blocked("approved source material amount cannot be overwritten",
    "UPDATE demand_material_items SET quantity_scaled=999999 WHERE id='dm'")
blocked("approved snapshot quantity cannot be overwritten",
    "UPDATE project_approval_scope_versions SET quantity_scaled=999999 "
    "WHERE id='scopev1'")
blocked("nonexistent demand version cannot be used in project scope",
    "INSERT INTO project_demand_scopes(id,project_id,demand_id,demand_version,"
    "proposed_quantity_scaled,created_at,updated_at)"
    " VALUES('invalid_revision','p3','d3',9999,10000,"
    "'2026-11-07T00:00:00.000Z','2026-11-07T00:00:00.000Z')")
blocked("approved scope requires genuine demand version",
    "INSERT INTO project_approval_scope_versions(id,approval_version_id,"
    "project_scope_id,demand_id,demand_version,quantity_scaled,"
    "snapshot_json,created_at) VALUES('badapprovalver','other_av',"
    "'other_scope','d',9999,10000,'{}','2026-11-07T00:00:00.000Z')")
blocked("approved scope must use its actual demand identity",
    "INSERT INTO project_approval_scope_versions(id,approval_version_id,"
    "project_scope_id,demand_id,demand_version,quantity_scaled,"
    "snapshot_json,created_at) VALUES('badapprovaldemand','other_av',"
    "'other_scope','d3',1,10000,'{}','2026-11-07T00:00:00.000Z')")
ok("original demand automatically published as demand version 1",
    row("SELECT quantity_scaled FROM demand_versions "
        "WHERE demand_id='d' AND version=1")["quantity_scaled"]==10000)
add("demand_revisions",id="d_rev2",demand_id="d",version=2,
    snapshot_json='{"quantity_scaled":15000,"operation_id":"op",'
        '"operation_version":1,"work_object_id":"obj","unit_id":"unit",'
        '"unit_version":1}',reason="工作量调整",changed_by="u",
    changed_at="2026-11-07T13:00:00.000Z")
ok("new demand revision creates a genuine immutable typed version",
    row("SELECT quantity_scaled FROM demand_versions WHERE demand_id='d' "
        "AND version=2")["quantity_scaled"]==15000)
blocked("missing formal demand revision cannot fake version 3",
    "INSERT INTO demand_versions(demand_id,version,quantity_scaled,operation_id,"
    "operation_version,work_object_id,unit_id,unit_version,snapshot_json,"
    "recorded_by,recorded_at) VALUES('d',3,20000,'op',1,'obj','unit',1,'{}','u',"
    "'2026-11-07T13:00:00.000Z')")

# Draft project approval editing is allowed until final publication.
db.execute("SAVEPOINT draft_edit")
db.execute("UPDATE project_approval_versions SET approved_budget_fen=700,"
    "snapshot_json='{\"draft\":true}' WHERE id='other_av'")
db.execute("UPDATE project_approval_scope_versions SET quantity_scaled=11000 "
    "WHERE id='other_ap_scope'")
ok("project approval draft budget and scope are editable",
    row("SELECT approved_budget_fen FROM project_approval_versions "
        "WHERE id='other_av'")["approved_budget_fen"]==700
    and row("SELECT quantity_scaled FROM project_approval_scope_versions "
        "WHERE id='other_ap_scope'")["quantity_scaled"]==11000)
db.execute("DELETE FROM project_approval_scope_versions WHERE id='other_ap_scope'")
ok("project approval draft scope can be deleted",
    row("SELECT COUNT(*) n FROM project_approval_scope_versions "
        "WHERE approval_version_id='other_av'")["n"]==0)
db.execute("ROLLBACK TO draft_edit")
db.execute("RELEASE draft_edit")

# Real cost reconciliation budget is not a cap, but the SAME cost record
# must not be reconciled twice. Corrected reconciliation versions replace.
add("cost_entries",id="audit_ce",project_id="p",
    created_by="u",created_at="2026-11-07T13:00:00.000Z")
add("cost_versions",id="audit_cv",entry_id="audit_ce",version_no=1,
    funding_version_id="fund2",status="active",category_id="expense",
    category_snapshot="费用",title="真实发生的费用",
    occurred_on="2026-11-07",amount_fen=10000,evidence="凭据",
    reason="首次确认",confirmed_by="u",confirmed_at="2026-11-07T13:00:00.000Z",
    request_key="audit_cv")
def rec(ident,amount_cost,amount_settled):
    add("cost_reconciliation_versions",id=ident,record_id=ident,
        version_no=1,status="active",cost_version_id="audit_cv",
        settlement_item_id="it",settlement_item_version_id="itemstv2",
        reconciled_cost_fen=amount_cost,
        reconciled_settlement_fen=amount_settled,is_final=0,
        evidence="核对依据",actor_id="u",created_at="2026-11-07T13:00:00.000Z",
        request_key=ident)
rec("rec_A",9000,9000)
blocked("cumulative cost reconciliation cannot exceed actual cost",
    "INSERT INTO cost_reconciliation_versions(id,record_id,version_no,status,"
    "cost_version_id,settlement_item_id,settlement_item_version_id,"
    "reconciled_cost_fen,reconciled_settlement_fen,is_final,evidence,"
    "actor_id,created_at,request_key) VALUES('badcostrec','badcostrec',1,"
    "'active','audit_cv','it','itemstv2',9000,1000,0,'凭据','u',"
    "'2026-11-07T13:00:00.000Z','badcostrec')")
blocked("cumulative settlement-side reconciliation cannot exceed item",
    "INSERT INTO cost_reconciliation_versions(id,record_id,version_no,status,"
    "cost_version_id,settlement_item_id,settlement_item_version_id,"
    "reconciled_cost_fen,reconciled_settlement_fen,is_final,evidence,"
    "actor_id,created_at,request_key) VALUES('badsettledrec','badsettledrec',1,"
    "'active','audit_cv','it','itemstv2',1000,1501,0,'凭据','u',"
    "'2026-11-07T13:00:00.000Z','badsettledrec')")
rec("rec_B",1000,1500)
ok("cumulative reconciliation at exact upper bound valid",
    tuple(row("SELECT SUM(reconciled_cost_fen),SUM(reconciled_settlement_fen)"
              " FROM v_cost_reconciliation_current"))==(10000,10500))

# Historical agreement attribution stays pinned even after the project's
# CURRENT (optional) agreement is changed to another funding version.
add("project_funding_versions",id="fund3",project_id="p",version_no=3,
    agreement_id=None,reason="资金重新分配尚未关联协议",
    actor_id="u",recorded_at="2026-11-07T14:00:00.000Z")
ok("current project funding becomes unbound",
    row("SELECT agreement_id FROM v_project_funding_current WHERE project_id='p'"
        )["agreement_id"] is None)
ok("historical cost version retains the original agreement identity",
    row("SELECT fv.agreement_id FROM cost_versions cv "
        "JOIN project_funding_versions fv ON fv.id=cv.funding_version_id "
        "WHERE cv.id='audit_cv'")["agreement_id"]=="ag"
    and row("SELECT amount_fen FROM cost_versions WHERE id='audit_cv'")["amount_fen"]==10000)

# Existing cost's historical funding identity may not be silently nulled.
blocked("funded actual expense correction cannot erase historical agreement",
    "INSERT INTO cost_versions(id,entry_id,version_no,status,category_id,"
    "category_snapshot,title,occurred_on,amount_fen,evidence,reason,"
    "confirmed_by,confirmed_at,request_key) VALUES('audit_cv_bad2','audit_ce',"
    "2,'active','expense','费用','费用复核','2026-11-07',9500,'依据','更正',"
    "'u','2026-11-07T16:00:00.000Z','audit_cv_bad2')")
add("cost_versions",id="audit_cv2",entry_id="audit_ce",
    version_no=2,funding_version_id="fund2",status="active",
    category_id="expense",category_snapshot="费用",
    title="真实费用更正",occurred_on="2026-11-07",amount_fen=9500,
    evidence="新核对凭据",reason="实际成本复核",confirmed_by="u",
    confirmed_at="2026-11-07T16:00:00.000Z",request_key="audit_cv2")
ok("historical reconciliation still references original actual cost version",
    row("SELECT cost_version_id FROM cost_reconciliation_versions "
        "WHERE id='rec_A'")["cost_version_id"]=="audit_cv"
    and row("SELECT id FROM v_cost_current "
        "WHERE entry_id='audit_ce'")["id"]=="audit_cv2")

# Approval snapshot must be rechecked against CURRENT material master when
# draft goes live, despite the master itself having NO material version table.
add("project_change_orders",id="p3chg",project_id="p3",code="P3-MATERIAL",
    base_approval_version_id="avp3",proposal_json="{}",reason="物资名称复核",
    created_by="u",created_at="2026-11-07T15:00:00.000Z")
db.execute("UPDATE project_change_orders SET status='approved',"
    "decided_by='u',decided_at='2026-11-07T15:00:00.000Z',"
    "decision_reason='同意' WHERE id='p3chg'")
add("project_approval_versions",id="p3av2",project_id="p3",version_no=2,
    change_order_id="p3chg",snapshot_json="{}",approved_budget_fen=2000,
    created_at="2026-11-07T15:00:00.000Z")
add("project_approval_scope_versions",id="p3sv2",
    approval_version_id="p3av2",project_scope_id="s3",demand_id="d3",
    demand_version=1,quantity_scaled=10000,approved_amount_fen=2000,
    snapshot_json="{}",created_at="2026-11-07T15:00:00.000Z")
add("project_approval_material_items",id="p3am2",
    approval_version_id="p3av2",project_scope_id="s3",
    project_material_id="p3m",
    item_no=1,material_code_snapshot="MAT-001",
    material_name="复合绝缘子",material_model="A-改",
    approved_quantity_scaled=2000,unit_id="unit",unit_snapshot="组")
revise_material("master1",name="复合绝缘子优化",
    recorded_at="2026-11-07T15:02:00.000Z",reason="物资描述核定")
blocked("stale master material draft cannot be formally approved",
    "UPDATE project_approval_versions SET status='approved',"
    "approved_by='u',approved_at='2026-11-07T15:03:00.000Z'"
    " WHERE id='p3av2'")
db.execute("UPDATE project_approval_material_items"
    " SET material_name='复合绝缘子优化',"
    "material_version_id=(SELECT material_version_id "
    "FROM v_material_current WHERE id='master1') WHERE id='p3am2'")
db.execute("UPDATE project_approval_versions SET status='approved',"
    "approved_by='u',approved_at='2026-11-07T15:04:00.000Z'"
    " WHERE id='p3av2'")
ok("refreshed draft material snapshot can be formally approved",
    row("SELECT status FROM project_approval_versions "
        "WHERE id='p3av2'")["status"]=="approved")
# Complete one isolated project, then exercise post-close state and late facts.
demand("dclose")
activate_demand("dclose")
add("projects",id="pclose",code="PCLOSE",name="关闭验证项目",
    framework_id="f",created_by="u",created_at="2026-11-07T10:00:00.000Z",
    updated_at="2026-11-07T10:00:00.000Z")
stage("pclose","stocked",time="2026-11-07T10:00:00.000Z")
add("project_demand_scopes",id="sclose",project_id="pclose",
    demand_id="dclose",demand_version=1,proposed_quantity_scaled=10000,
    proposed_amount_fen=1000,created_at="2026-11-07T10:00:00.000Z",
    updated_at="2026-11-07T10:00:00.000Z")
add("project_approval_versions",id="avclose",project_id="pclose",
    version_no=1,approved_budget_fen=1000,snapshot_json="{}",
    created_at="2026-11-07T10:00:00.000Z")
add("project_approval_scope_versions",id="asclose",
    approval_version_id="avclose",project_scope_id="sclose",
    demand_id="dclose",demand_version=1,quantity_scaled=10000,
    approved_amount_fen=1000,snapshot_json="{}",
    created_at="2026-11-07T10:00:00.000Z")
db.execute("UPDATE project_approval_versions SET status='approved',"
    "approved_by='u',approved_at='2026-11-07T10:00:00.000Z' WHERE id='avclose'")
stage("pclose","approved")
add("settlements",id="stclose",project_id="pclose",number="SCLOSE",
    created_by="u",created_at="2026-11-07T10:00:00.000Z")
add("settlement_items",id="itclose",settlement_id="stclose",
    project_scope_id="sclose",created_at="2026-11-07T10:00:00.000Z")
add("settlement_versions",id="vclose",settlement_id="stclose",
    version_no=1,approval_version_id="avclose",
    change_type="initial",reason="关闭结算",created_by="u",
    recorded_at="2026-11-07T10:00:00.000Z")
add("settlement_item_versions",id="ivclose",settlement_item_id="itclose",
    settlement_version_id="vclose",approval_scope_version_id="asclose",
    quantity_scaled=10000,amount_fen=1000,evidence="验收",
    scope_snapshot_json="{}")
add("settlement_review_events",id="submitclose",settlement_version_id="vclose",
    event_seq=1,action="submit",actor_id="u",recorded_at="2026-11-07T10:00:00.000Z")
add("settlement_review_events",id="approveclose",settlement_version_id="vclose",
    event_seq=2,action="approve",actor_id="u",
    recorded_at="2026-11-07T10:01:00.000Z",effective_on="2026-11-07")
# The existing closure fixture must reflect the SAME finalized cost/statement
# contract: an approved 1000-fen statement without matching actual cost is
# not a completed financial closeout.
add("cost_entries",id="pclose_real_cost",project_id="pclose",
    created_by="u",created_at="2026-11-07T10:01:10.000Z")
add("cost_versions",id="pclose_real_cv",entry_id="pclose_real_cost",
    version_no=1,status="active",category_id="expense",
    category_snapshot="费用",title="结项实际费用",
    occurred_on="2026-11-07",amount_fen=1000,
    evidence="实际费用凭据",reason="结项前真实发生",
    confirmed_by="u",confirmed_at="2026-11-07T10:01:11.000Z",
    request_key="pclose_real_cv")
add("cost_reconciliation_versions",id="pclose_real_recon",
    record_id="pclose_real_recon",version_no=1,status="active",
    cost_version_id="pclose_real_cv",settlement_item_id="itclose",
    settlement_item_version_id="ivclose",
    reconciled_cost_fen=1000,reconciled_settlement_fen=1000,
    is_final=1,evidence="已审核结项核对",actor_id="u",
    created_at="2026-11-07T10:01:12.000Z",request_key="pclose_real_recon")
# A fully accepted project-change decision must first become a real approved
# scope snapshot. Merely approving its change-order header is not enough.
add("project_change_orders",id="chg_close",project_id="pclose",
    code="CLOSECHANGE",base_approval_version_id="avclose",
    proposal_json="{}",reason="最后的范围核定",created_by="u",
    created_at="2026-11-07T11:00:00.000Z")
db.execute("UPDATE project_change_orders SET status='approved',"
    "decided_by='u',decided_at='2026-11-07T11:00:00.000Z',"
    "decision_reason='同意' WHERE id='chg_close'")
add("project_approval_versions",id="avclose2",project_id="pclose",
    version_no=2,change_order_id="chg_close",approved_budget_fen=1000,
    snapshot_json="{}",created_at="2026-11-07T11:00:00.000Z")
add("project_approval_scope_versions",id="asclose2",
    approval_version_id="avclose2",project_scope_id="sclose",
    demand_id="dclose",demand_version=1,quantity_scaled=10000,
    approved_amount_fen=1000,snapshot_json="{}",
    created_at="2026-11-07T11:00:00.000Z")
blocked("project cannot close with unfinished approved-scope draft",
    "UPDATE projects SET status='closed' WHERE id='pclose'")
db.execute("UPDATE project_approval_versions SET status='approved',"
    "approved_by='u',approved_at='2026-11-07T11:30:00.000Z'"
    " WHERE id='avclose2'")
blocked("closure must never cite outdated approved project version",
    "INSERT INTO project_closures(id,project_id,approval_version_id,reason,"
    "close_snapshot_json,closed_by,closed_at) VALUES('outdated_close',"
    "'pclose','avclose','旧批准版本','{}','u',"
    "'2026-11-07T12:00:00.000Z')")
add("project_closures",id="closure",project_id="pclose",
    approval_version_id="avclose2",reason="已全部完成",close_snapshot_json="{}",
    closed_by="u",closed_at="2026-11-07T12:00:00.000Z")
stage("pclose","closed")
ok("complete project can formally close",
    row("SELECT status FROM projects WHERE id='pclose'")["status"]=="closed")
blocked("closed project cannot silently reopen via status edit",
    "UPDATE projects SET status='approved' WHERE id='pclose'")
blocked("closed project cannot silently create a new settlement identity",
    "INSERT INTO settlements(id,project_id,number,created_by,created_at)"
    " VALUES('postclose','pclose','POST','u','2026-11-08T00:00:00.000Z')")
ok("closure persists authenticated immutable closing timestamp",
    row("SELECT closed_at FROM project_closures WHERE project_id='pclose'")
        ["closed_at"]=="2026-11-07T12:00:00.000Z")
add("cost_entries",id="cost_after_close",project_id="pclose",
    created_by="u",created_at="2026-11-08T10:00:00.000Z")
add("cost_versions",id="cv_after_close",entry_id="cost_after_close",
    version_no=1,status="active",category_id="expense",
    category_snapshot="费用",title="事后发现的真实费用",
    occurred_on="2026-11-07",amount_fen=200,
    evidence="事后凭据",reason="关闭后补报",
    confirmed_by="u",confirmed_at="2026-11-08T10:00:00.000Z",
    request_key="cv_after_close")
ok("late actual cost retains its occurrence date and later confirmation timestamp",
    row("SELECT occurred_on,confirmed_at FROM cost_versions "
        "WHERE id='cv_after_close'")["confirmed_at"]
      >row("SELECT closed_at FROM project_closures WHERE project_id='pclose'")
        ["closed_at"]
    and row("SELECT occurred_on FROM cost_versions "
        "WHERE id='cv_after_close'")["occurred_on"]=="2026-11-07")
# Atomic business writes: a multi-row operation with a bad child must leave
# no partial row after transaction rollback.
db.execute("SAVEPOINT atomic_biz")
add("materials",id="atomic_mat",code="ATOMIC_MAT",name="事务测试",
    unit_id="unit",created_at="2026-11-07T16:00:00.000Z",
    updated_at="2026-11-07T16:00:00.000Z")
try:
    add("materials",id="atomic_dup",code="ATOMIC_MAT",name="重复",
        unit_id="unit",created_at="2026-11-07T16:00:00.000Z",
        updated_at="2026-11-07T16:00:00.000Z")
except sqlite3.IntegrityError:
    db.execute("ROLLBACK TO atomic_biz")
else:
    raise AssertionError("expected duplicate operation to fail")
finally:
    db.execute("RELEASE atomic_biz")
ok("atomic multi-row rejection leaves no partial master material",
    row("SELECT COUNT(*) n FROM materials WHERE id='atomic_mat'")["n"]==0)
ok("framework and agreement current definitions remain available as business facts",
    row("SELECT limit_fen FROM v_framework_current WHERE id='f'")["limit_fen"]==1000
    and row("SELECT limit_fen FROM v_agreement_current WHERE id='ag'")["limit_fen"]==600)

# SQLite single-writer/WAL semantics under two independent concurrent
# connections, with temporary file automatically deleted afterwards.
with tempfile.TemporaryDirectory(prefix="schema113_sqlite_") as tempdir:
    path = Path(tempdir)/"candidate.sqlite"
    a = sqlite3.connect(path,timeout=0.05,isolation_level=None)
    a.execute("PRAGMA foreign_keys=ON")
    assert a.execute("PRAGMA journal_mode=WAL").fetchone()[0]=="wal"
    a.executescript(schema.read_text())
    b = sqlite3.connect(path,timeout=0.05,isolation_level=None)
    b.execute("PRAGMA foreign_keys=ON")
    b.execute("PRAGMA busy_timeout=0")
    a.execute("BEGIN IMMEDIATE")
    try:
        b.execute("BEGIN IMMEDIATE")
    except sqlite3.OperationalError as error:
        assert "locked" in str(error).lower(),str(error)
    else:
        raise AssertionError("second independent writer bypassed first writer lock")
    finally:
        a.execute("ROLLBACK")
    b.execute("BEGIN IMMEDIATE")
    b.execute("ROLLBACK")
    ok("WAL dual-connection BEGIN IMMEDIATE serializes competing writers")
    ok("SQLite WAL temporary database has zero integrity defects",
       a.execute("PRAGMA integrity_check").fetchone()[0]=="ok")
    b.close()
    a.close()
# A logical online snapshot must retain the user-created relational facts
# and the immutable version/approval history, not just build an empty schema.
db.commit()
with tempfile.TemporaryDirectory(prefix="schema113_backup_") as backup_dir:
    backup_path = Path(backup_dir)/"snapshot.sqlite"
    target = sqlite3.connect(backup_path)
    db.backup(target)
    target.close()
    restored = sqlite3.connect(backup_path)
    restored.execute("PRAGMA foreign_keys=ON")
    ok("SQLite consistent backup restores material master records",
       restored.execute("SELECT code FROM materials WHERE id='master1'").fetchone()[0]=="MAT-001")
    ok("SQLite consistent backup restores approved settlement history",
       restored.execute("SELECT COUNT(*) FROM settlement_review_events "
           "WHERE action='approve'").fetchone()[0]>=3)
    ok("SQLite consistent backup integrity",
       restored.execute("PRAGMA integrity_check").fetchone()[0]=="ok"
       and not restored.execute("PRAGMA foreign_key_check").fetchall())
    restored.close()
# ---------------- Schema113 structural-normalization governance ----------------
# Equipment complete versions are append-only, auto-captured, and no longer
# provide three unrelated name/physical timelines.
ok("line initial complete-history version auto-captured",
   row("SELECT name,version FROM line_history WHERE line_id='line'")["name"]=="L")
ok("physical tower initial complete-history version auto-captured",
   row("SELECT version FROM physical_tower_history WHERE physical_tower_id='pt'")["version"]==1)
ok("logical tower initial complete-history version auto-captured",
   row("SELECT version FROM logical_tower_history WHERE logical_tower_id='tower'")["version"]==1)
blocked("raw line name cannot change without an audited new version",
    "UPDATE transmission_lines SET name='未记录更名' WHERE id='line'")
blocked("raw physical tower cannot change without a version",
    "UPDATE physical_towers SET model='无法追溯' WHERE id='pt'")
blocked("raw logical tower physical reassignment cannot bypass history",
    "UPDATE logical_towers SET physical_tower_id='pt2' WHERE id='tower'")
db.execute("UPDATE transmission_lines SET name='正式更名线路',version=2,"
    "updated_by='u',change_reason='台账名称核对',"
    "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day') WHERE id='line'")
ok("line name change creates immutable full equipment history",
    row("SELECT COUNT(*) n FROM line_history WHERE line_id='line'")["n"]==2
    and row("SELECT name FROM line_history WHERE line_id='line' AND version=1")["name"]=="L"
    and row("SELECT name FROM line_history WHERE line_id='line' AND version=2")["name"]=="正式更名线路")
db.execute("UPDATE physical_towers SET model='新塔型',version=2,"
    "updated_by='u',change_reason='结构更新',"
    "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day') WHERE id='pt'")
ok("physical tower changed attributes retain old history",
    row("SELECT COUNT(*) n FROM physical_tower_history WHERE physical_tower_id='pt'")["n"]==2)
db.execute("UPDATE logical_towers SET physical_tower_id='pt2',status='active',"
    "version=2,updated_by='u',change_reason='塔体整体更换',"
    "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day') WHERE id='tower'")
ok("logical tower replacement retains old physical relation",
    row("SELECT physical_tower_id FROM logical_tower_history "
        "WHERE logical_tower_id='tower' AND version=1")["physical_tower_id"]=="pt"
    and row("SELECT physical_tower_id FROM logical_tower_history "
        "WHERE logical_tower_id='tower' AND version=2")["physical_tower_id"]=="pt2")
blocked("equipment history cannot be rewritten",
    "UPDATE logical_tower_history SET physical_tower_id='pt2' "
    "WHERE logical_tower_id='tower' AND version=1")
blocked("equipment history cannot be deleted",
    "DELETE FROM physical_tower_history WHERE physical_tower_id='pt' AND version=1")
blocked("cannot forge an unbacked line-history row",
    "INSERT INTO line_history(line_id,version,name,voltage_level_id,status,"
    "line_kind,setup_status,erection_type,actor_id,reason,recorded_at) "
    "VALUES('line',3,'假版本','vol','active','main','ready','','u','伪造',"
    "'2026-11-07T20:00:00.000Z')")
blocked("a line cannot contain two active logical towers with identical number",
    "INSERT INTO logical_towers(id,logical_code,line_id,physical_tower_id,"
    "tower_no,sort_rank,status,created_by) "
    "VALUES('tower_dup','DUP-TOWER','line','pt2','001',11,'active','u')")

# Demand's status is not a mutable field; lifecycle events are the authority.
demand("d_lifecycle")
ok("initial demand lifecycle is created with root identity",
   row("SELECT event_seq,to_status FROM demand_lifecycle_events "
       "WHERE demand_id='d_lifecycle'")["to_status"]=="pending")
blocked("immutable demand registration cannot be rewritten after creation",
    "UPDATE demands SET target_object='不同对象' WHERE id='d_lifecycle'")
add("users",id="view_governance",username="read-only",password_hash="x",
    role="viewer",created_at="2026-11-07T17:00:00.000Z")
demand("d_actor_fk")
add("demand_lifecycle_events",id="app_authorization_boundary",
    demand_id="d_actor_fk",event_seq=2,from_status="pending",
    to_status="active",reason="数据库验证主体引用及状态转换",
    actor_id="view_governance",recorded_at="2026-11-07T17:10:00.000Z")
ok("database validates actor FK and lifecycle; role authorization is an application task",
    row("SELECT status FROM v_demand_current WHERE id='d_actor_fk'")["status"]=="active"
    and row("SELECT role FROM users WHERE id='view_governance'")["role"]=="viewer")
blocked("business event must reference a real user regardless of application permission",
    "INSERT INTO demand_lifecycle_events(id,demand_id,event_seq,from_status,"
    "to_status,reason,actor_id,recorded_at) VALUES('d_invalid_actor','d',2,"
    "'pending','active','伪造','nonexistent_user','2026-11-07T17:10:00.000Z')")
add("demand_lifecycle_events",id="d_activate",demand_id="d_lifecycle",event_seq=2,
    from_status="pending",to_status="active",reason="正式确认需求",
    actor_id="u",recorded_at="2026-11-07T17:10:00.000Z")
ok("current demand lifecycle state comes from immutable event",
    row("SELECT status FROM v_demand_current WHERE id='d_lifecycle'")["status"]=="active")
blocked("demand lifecycle history cannot be edited",
    "UPDATE demand_lifecycle_events SET reason='篡改' WHERE id='d_activate'")

# The same master material has no version, but every demand revision freezes
# a full independent expected-material list. Fields not revised carry forward.
ok("demand V2 still carries V1 material despite revised work quantity",
    row("SELECT quantity_scaled FROM demand_material_version_items "
        "WHERE demand_id='d' AND demand_version=2 AND material_id='master1'")
       ["quantity_scaled"]==1000)
add("materials",id="master3",code="MAT-003",name="新的更换金具",model="JG-B",
    unit_id="unit",created_by="u",
    created_at="2026-11-07T17:00:00.000Z",updated_at="2026-11-07T17:00:00.000Z")
add("demand_revisions",id="d_rev3",demand_id="d",version=3,
    snapshot_json='{"quantity_scaled":20000,"operation_id":"op",'
      '"operation_version":1,"work_object_id":"obj",'
      '"unit_id":"unit","unit_version":1,"target_object":"B相",'
      '"problem_description":"复核后的B相缺陷",'
      '"materials":[{"material_id":"master1","quantity_scaled":2000},'
      '{"material_id":"master3","quantity_scaled":3000}]}',
    reason="物资预计清单正式调整",changed_by="u",
    changed_at="2026-11-07T17:30:00.000Z")
ok("current demand points to complete newest revision and amended work target",
    row("SELECT current_version,target_object,quantity_scaled FROM "
        "v_demand_current WHERE id='d'")["current_version"]==3
    and row("SELECT target_object FROM v_demand_current WHERE id='d'")["target_object"]=="B相"
    and row("SELECT target_object FROM demands WHERE id='d'")["target_object"]=="A相")
ok("revised demand material list contains correct two master identities",
    {r["material_id"]:r["quantity_scaled"] for r in db.execute(
      "SELECT material_id,quantity_scaled FROM v_demand_material_current "
      "WHERE demand_id='d'")}=={"master1":2000,"master3":3000})
ok("old V1 expected material remains unchanged after V3 revision",
    row("SELECT quantity_scaled FROM demand_material_version_items WHERE "
        "demand_id='d' AND demand_version=1 AND material_id='master1'")
      ["quantity_scaled"]==1000)
blocked("published demand material V2 cannot be changed",
    "UPDATE demand_material_version_items SET quantity_scaled=99999 "
    "WHERE demand_id='d' AND demand_version=2 AND material_id='master1'")
blocked("cannot append a fabricated demand-version material",
    "INSERT INTO demand_material_version_items(demand_id,demand_version,"
    "material_id,item_no,quantity_scaled,unit_id,unit_snapshot) "
    "VALUES('d',3,'master2',3,500,'unit','组')")
blocked("initial demand material cannot be secretly changed after revision",
    "UPDATE demand_material_items SET quantity_scaled=99999 WHERE id='dm'")

# Every project stage event must be causally consistent and is the only write
# path for materialized projects.status. It is NOT a free-form audit record.
ok("project stage history exists for formally approved project",
    row("SELECT COUNT(*) n FROM project_stage_events WHERE project_id='p'")["n"]==2)
blocked("cannot update project stage directly without stage event",
    "UPDATE projects SET status='stocked' WHERE id='p'")
blocked("cannot forge project stage event unrelated to state transition",
    "INSERT INTO project_stage_events(id,project_id,stage,project_version,"
    "reason,actor_id,created_at) VALUES('bad_stage','p','stocked',3,"
    "'非法回退','u','2026-11-07T17:00:00.000Z')")
blocked("stage cannot close without the required formal project closure facts",
    "INSERT INTO project_stage_events(id,project_id,stage,project_version,"
    "reason,actor_id,created_at) VALUES('bad_view_close','p','closed',4,"
    "'无权审批','view_governance','2026-11-07T17:00:00.000Z')")
blocked("second project cannot silently approve a demand already formally claimed",
    "UPDATE project_approval_versions SET status='approved',"
    "approved_by='view_governance',"
    "approved_at='2026-11-07T17:00:00.000Z' WHERE id='other_av'")

# A latest formal approved amount NULL means *unknown*, not previous
# (unapproved) project-scope estimate. This formerly leaked 5000 fen.
demand("dnull")
activate_demand("dnull")
add("projects",id="pnull",code="PNULL",name="批准价格尚未核定",
    framework_id="f",created_by="u",created_at="2026-11-07T18:00:00.000Z",
    updated_at="2026-11-07T18:00:00.000Z")
stage("pnull","stocked",time="2026-11-07T18:00:00.000Z")
add("project_demand_scopes",id="snull",project_id="pnull",
    demand_id="dnull",demand_version=1,proposed_quantity_scaled=10000,
    proposed_amount_fen=5000,created_at="2026-11-07T18:00:00.000Z",
    updated_at="2026-11-07T18:00:00.000Z")
add("project_approval_versions",id="avnull",project_id="pnull",
    version_no=1,approved_budget_fen=0,snapshot_json="{}",
    created_at="2026-11-07T18:00:00.000Z")
add("project_approval_scope_versions",id="avnullscope",
    approval_version_id="avnull",project_scope_id="snull",demand_id="dnull",
    demand_version=1,quantity_scaled=10000,approved_amount_fen=None,
    snapshot_json="{}",created_at="2026-11-07T18:00:00.000Z")
db.execute("UPDATE project_approval_versions SET status='approved',"
    "approved_by='u',approved_at='2026-11-07T18:00:00.000Z' WHERE id='avnull'")
stage("pnull","approved")
ok("unknown approved scope amount stays NULL, independent of proposed amount",
    row("SELECT approved_amount_fen FROM v_approval_scope_current "
        "WHERE project_scope_id='snull'")["approved_amount_fen"] is None
    and row("SELECT proposed_amount_fen FROM project_demand_scopes "
        "WHERE id='snull'")["proposed_amount_fen"]==5000)
blocked("approved scope cannot silently retire outside a real approval change",
    "UPDATE project_demand_scopes SET proposal_status='retired' WHERE id='snull'")
add("project_closures",id="close_null",project_id="pnull",
    approval_version_id="avnull",reason="结项前审核",
    close_snapshot_json="{}",closed_by="u",
    closed_at="2026-11-07T18:30:00.000Z")
stage("pnull","closed",time="2026-11-07T18:32:00.000Z")
ok("project with no cost or settlement may close without fictional work completion",
    row("SELECT status FROM projects WHERE id='pnull'")["status"]=="closed")

# Money cannot point to funding recorded after its own ledger event.
add("settlements",id="st_future",project_id="p",number="FUND-TIME",
    created_by="u",created_at="2026-11-07T13:00:00.000Z")
blocked("settlement cannot use a future funding association version",
    "INSERT INTO settlement_versions(id,settlement_id,version_no,"
    "approval_version_id,funding_version_id,change_type,reason,"
    "created_by,recorded_at) VALUES('futurev','st_future',1,'av3',"
    "'fund3','initial','穿越资金归属','u',"
    "'2026-11-07T13:00:00.000Z')")

# Application-layer closure review will compare immutable fact times.
closure_time=row("SELECT closed_at FROM project_closures "
    "WHERE project_id='pclose'")["closed_at"]
add("cost_allocations",id="late_alloc",cost_entry_id="cost_after_close",
    settlement_item_id="itclose",created_at="2026-11-08T11:00:00.000Z")
add("cost_allocation_versions",id="late_alloc_v1",allocation_id="late_alloc",
    version_no=1,cost_version_id="cv_after_close",amount_fen=200,
    status="active",reason="事后责任费用分摊",actor_id="u",
    recorded_at="2026-11-08T11:00:00.000Z")
ok("cost allocation version retains late-registration evidence for application review",
    row("SELECT recorded_at FROM cost_allocation_versions "
        "WHERE id='late_alloc_v1'")["recorded_at"]>closure_time
    and row("SELECT amount_fen FROM cost_allocation_versions "
        "WHERE id='late_alloc_v1'")["amount_fen"]==200)

# Model metadata, organization hierarchy and source provenance are typed,
# without duplicating current values inside projects and external_ref.
add("organizational_units",id="ou",code="T-OPS",name="输电运检中心")
add("organizational_units",id="childou",code="T-OPS-1",
    name="输电班组",parent_id="ou")
blocked("organization units cannot be their own ancestors",
    "UPDATE organizational_units SET parent_id='childou' WHERE id='ou'")
add("project_management_versions",id="mgt1",project_id="p",
    version_no=1,owner_id="u",manager_id="u",responsible_unit_id="ou",
    planned_start_on="2026-11-08",planned_end_on="2026-11-30",
    preliminary_estimate_fen=7000,preliminary_estimate_basis="初步估算",
    reason="首次计划",actor_id="u",recorded_at="2026-11-07T18:00:00.000Z")
add("project_management_versions",id="mgt2",project_id="p",
    version_no=2,owner_id="u",manager_id="u",responsible_unit_id="ou",
    planned_start_on="2026-11-08",planned_end_on="2026-12-31",
    preliminary_estimate_fen=8000,preliminary_estimate_basis="范围核定后估算",
    reason="调整目标时间",actor_id="u",recorded_at="2026-11-07T19:00:00.000Z")
ok("responsibility and schedule are separate historical project facts",
    row("SELECT version_no,planned_end_on FROM v_project_management_current "
       "WHERE project_id='p'")["version_no"]==2
    and row("SELECT planned_end_on FROM project_management_versions "
       "WHERE id='mgt1'")["planned_end_on"]=="2026-11-30")
blocked("project management history cannot be overwritten",
    "UPDATE project_management_versions SET planned_end_on='2027-01-01' "
    "WHERE id='mgt1'")
add("source_records",id="pms_source",source_system="pms",
    external_record_id="PMS-DEV-100",
    description="PMS 台账来源",created_by="u",
    created_at="2026-11-07T18:00:00.000Z")
blocked("one PMS source ID cannot be imported into two independent source identities",
    "INSERT INTO source_records(id,source_system,external_record_id,"
    "description,created_by,created_at) VALUES('duplicate_pms','pms',"
    "'PMS-DEV-100','重复','u','2026-11-07T18:01:00.000Z')")
blocked("audit evidence cannot use a nonexistent user",
    "INSERT INTO audit_events(id,actor_id,entity,entity_id,action,created_at)"
    " VALUES('fake_audit','ghost','projects','p','edit',"
    "'2026-11-07T18:00:00.000Z')")
blocked("audit evidence cannot use malformed JSON",
    "INSERT INTO audit_events(id,actor_id,entity,entity_id,action,before_json,"
    "created_at) VALUES('bad_json_audit','u','projects','p','edit','bad',"
    "'2026-11-07T18:00:00.000Z')")

# No duplicate "approved" fields on proposal scope identity or
# misleading voltage-level version counter without a corresponding history.
scope_columns={x["name"] for x in db.execute("PRAGMA table_info(project_demand_scopes)")}
ok("project proposal baseline has explicit different identity from approved scope",
   {"proposed_quantity_scaled","proposed_amount_fen",
    "proposed_unit_price_fen","proposal_status"}<=scope_columns
   and "approved_amount_fen" not in scope_columns)
ok("voltage type no fake version without version history",
   "version" not in {x["name"] for x in db.execute("PRAGMA table_info(voltage_levels)")})
ok("three competing partial asset histories have been consolidated",
   row("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'"
       " AND name IN ('line_name_history','logical_tower_name_history',"
       "'logical_tower_physical_history')")["n"]==0)
ok("project stage history no longer stores redundant JSON status",
   "snapshot_json" not in {x["name"] for x in db.execute("PRAGMA table_info(project_stage_events)")})

# Active topology may not be invalidated by a tower/line administrative update.
add("line_spans",id="active_span_audit",line_id="line",
    start_tower_id="tower",end_tower_id="tower2",
    status="active",version=1,created_by="u",
    created_at="2026-11-07T19:00:00.000Z",
    updated_at="2026-11-07T19:00:00.000Z")
blocked("active span endpoint cannot be retired before span revision",
    "UPDATE logical_towers SET status='inactive',version=3,"
    "updated_by='u',change_reason='退役',"
    "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+2 day') WHERE id='tower'")
blocked("active span line cannot be retired before span revision",
    "UPDATE transmission_lines SET status='inactive',version=3,"
    "updated_by='u',change_reason='退运',"
    "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+2 day') WHERE id='line'")
blocked("active physical tower may not retire while serving a logical tower",
    "UPDATE physical_towers SET status='retired',version=3,"
    "updated_by='u',change_reason='拆除',"
    "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+2 day') WHERE id='pt2'")

blocked("formally adopted demand cannot be cancelled without project change",
    "INSERT INTO demand_lifecycle_events(id,demand_id,event_seq,from_status,"
    "to_status,reason,actor_id,recorded_at)"
    " VALUES('cancel_d3','d3',2,'pending','cancelled',"
    "'跳过批准项目','u','2026-11-07T19:00:00.000Z')")
blocked("closed project cannot register a new funding association",
    "INSERT INTO project_funding_versions(id,project_id,version_no,"
    "agreement_id,reason,actor_id,recorded_at)"
    " VALUES('after_close_funding','pclose',1,NULL,'结项后非法',"
    "'u','2026-11-07T19:00:00.000Z')")
blocked("funding event dates cannot reverse chronological order",
    "INSERT INTO project_funding_versions(id,project_id,version_no,"
    "agreement_id,reason,actor_id,recorded_at)"
    " VALUES('reverse_funding','p',4,NULL,'倒置事件',"
    "'u','2026-11-07T13:00:00.000Z')")
blocked("new material version requires a real accountable actor",
    "INSERT INTO material_versions(id,material_id,version_no,name,status,"
    "reason,changed_by,recorded_at) VALUES(?,?,?,?,?,?,?,?)",
    ("material_missing_actor","master1",4,"改版","active",
     "非法缺少人员",None,"2026-11-08T00:00:00.000Z"))
blocked("material version category must be actual material dictionary",
    "INSERT INTO material_versions(id,material_id,version_no,name,category_id,"
    "status,reason,changed_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)",
    ("wrong_material_cat","master3",2,"物资","expense","active",
     "非法分类","u","2026-11-08T00:00:00.000Z"))
blocked("invalid VAT calculation metadata rejected",
    "INSERT INTO cost_versions(id,entry_id,version_no,"
    "funding_version_id,status,category_id,category_snapshot,title,"
    "occurred_on,amount_fen,tax_mode,tax_rate_basis_points,evidence,reason,"
    "confirmed_by,confirmed_at,request_key) VALUES('bad_tax','audit_ce',3,"
    "'fund2','active','expense','费用','不合法税率','2026-11-07',1000,"
    "'none',1100,'票据','税率错误','u','2026-11-07T20:00:00.000Z','bad_tax')")

add("agreement_versions",id="agv3",agreement_id="ag",version_no=2,
    name="协议合同正式资料",limit_fen=1600,
    contract_number="CONTRACT-2026-001",counterparty_name="检修服务单位",
    signed_on="2026-10-25",effective_from="2026-11-01",effective_to="2027-10-31",
    status="active",reason="补充合同基础资料",changed_by="u",
    recorded_at="2026-11-07T20:00:00.000Z")
ok("current agreement includes typed contract identity and effective period",
   row("SELECT contract_number, effective_to FROM v_agreement_current "
       "WHERE id='ag'")["contract_number"]=="CONTRACT-2026-001"
   and row("SELECT effective_to FROM v_agreement_current "
       "WHERE id='ag'")["effective_to"]=="2027-10-31")
# Demand V1 remains a pending intake snapshot until a qualified acceptance
# event freezes its material BOM. A project cannot approve an unconfirmed one.
demand("pending_gov")
add("demand_material_items",id="pending_init_mat",
    demand_id="pending_gov",item_no=1,material_id="master2",
    quantity_scaled=500,created_at="2026-11-07T21:00:00.000Z",
    updated_at="2026-11-07T21:00:00.000Z")
add("projects",id="p_pending",code="P-PENDING",name="待确认需求项目",
    framework_id="f",created_by="u",created_at="2026-11-07T21:00:00.000Z",
    updated_at="2026-11-07T21:00:00.000Z")
blocked("reserve project cannot skip required stocking stage",
    "INSERT INTO project_stage_events(id,project_id,stage,project_version,"
    "reason,actor_id,created_at) VALUES('skip_stock','p_pending','approved',2,"
    "'直接立项','u','2026-11-07T21:00:00.000Z')")
stage("p_pending","stocked",time="2026-11-07T21:00:00.000Z")
add("project_approval_versions",id="a_pending",project_id="p_pending",
    version_no=1,snapshot_json="{}",approved_budget_fen=900,
    created_at="2026-11-07T21:01:00.000Z")
add("project_demand_scopes",id="s_pending",project_id="p_pending",
    demand_id="pending_gov",demand_version=1,
    proposed_quantity_scaled=10000,proposed_amount_fen=900,
    created_at="2026-11-07T21:01:00.000Z",
    updated_at="2026-11-07T21:01:00.000Z")
add("project_approval_scope_versions",id="as_pending",
    approval_version_id="a_pending",project_scope_id="s_pending",
    demand_id="pending_gov",demand_version=1,quantity_scaled=10000,
    approved_amount_fen=900,snapshot_json="{}",
    created_at="2026-11-07T21:01:00.000Z")
blocked("formally stocked project cannot approve an unconfirmed demand",
    "UPDATE project_approval_versions SET status='approved',"
    "approved_by='u',approved_at='2026-11-07T21:02:00.000Z' WHERE id='a_pending'")
activate_demand("pending_gov")
blocked("confirmed demand cannot directly append material to frozen V1",
    "INSERT INTO demand_material_items(id,demand_id,item_no,material_id,"
    "quantity_scaled,created_at,updated_at) "
    "VALUES('pending_fake','pending_gov',2,'master1',100,"
    "'2026-11-07T21:03:00.000Z','2026-11-07T21:03:00.000Z')")
blocked("confirmed demand V1 material cannot be altered",
    "UPDATE demand_material_items SET quantity_scaled=700 "
    "WHERE id='pending_init_mat'")
db.execute("UPDATE project_approval_versions SET status='approved',"
    "approved_by='u',approved_at='2026-11-07T21:05:00.000Z' WHERE id='a_pending'")
stage("p_pending","approved",time="2026-11-07T21:06:00.000Z")
ok("confirmed demand formally accepted and project legitimately approved",
    row("SELECT status FROM projects WHERE id='p_pending'")["status"]=="approved")
add("dictionary_items",id="other_unit",type_id="unit",code="pcs",
    created_at="2026-11-07T22:00:00.000Z")
add("dictionary_item_versions",id="other_unit_v1",item_id="other_unit",
    version=1,name="件",status="active",reason="增加物资单位",
    changed_by="u",changed_at="2026-11-07T22:00:00.000Z")
blocked("material master units cannot change when referenced only in a demand revision",
    "UPDATE materials SET unit_id='other_unit' WHERE id='master3'")

# Full historical demand domain uses VIRTUAL typed projections from the
# authoritative full snapshot; no extra persisted duplicate location fields.
def blocked_demand_v4(label, changes):
    import json
    payload = {
      "quantity_scaled":21000, "operation_id":"op","operation_version":1,
      "work_object_id":"obj","unit_id":"unit","unit_version":1
    }
    payload.update(changes)
    blocked(label,
      "INSERT INTO demand_revisions(id,demand_id,version,snapshot_json,"
      "reason,changed_by,changed_at) VALUES(?,?,?,?,?,?,?)",
      ("invalid_v4","d",4,json.dumps(payload,ensure_ascii=False),
       "结构类型反例验证","u","2026-11-07T23:00:00.000Z"))
blocked_demand_v4("full demand version cannot delete its required work target",
                  {"target_object":None})
blocked_demand_v4("full demand version cannot blank its completion standard",
                  {"completion_standard":"   "})
blocked_demand_v4("full demand version rejects nonexistent logical tower FK",
                  {"logical_tower_id":"tower-does-not-exist"})
blocked_demand_v4("full demand version rejects invalid work location category",
                  {"work_target_type":"physical"})
blocked_demand_v4("full demand version rejects wrong priority dictionary type",
                  {"priority_id":"expense"})
blocked_demand_v4("full demand version rejects invalid expected business date",
                  {"expected_on":"2026-02-30"})
ok("generated location fields are not stored twice as mutable columns",
    any(c["name"]=="logical_tower_id" and c["hidden"] in (2,3) for c in
        db.execute("PRAGMA table_xinfo(demand_versions)")))
ok("unchanged historical demand versions preserve the selected equipment FK",
    row("SELECT logical_tower_id FROM demand_versions "
        "WHERE demand_id='d' AND version=1")["logical_tower_id"]=="tower")

# Domain revisions carry only changed fields; the published business version
# is always complete and matches its typed columns and material BOM.
last_d=row("SELECT MAX(version) AS v FROM demand_versions WHERE demand_id='d'")["v"]
old_qty=row("SELECT quantity_scaled FROM v_demand_current WHERE id='d'")["quantity_scaled"]
old_bom=db.execute("SELECT material_id,quantity_scaled FROM v_demand_material_current "
    "WHERE demand_id='d' ORDER BY material_id").fetchall()
add("demand_revisions",id="delta_revision",demand_id="d",
    version=last_d+1,snapshot_json='{"problem_description":"修订描述但不改变工程量"}',
    reason="现场问题描述规范化",changed_by="u",
    changed_at="2026-11-07T23:20:00.000Z")
ok("partial demand revision publishes complete typed latest definition",
    row("SELECT quantity_scaled FROM v_demand_current WHERE id='d'")["quantity_scaled"]==old_qty
    and row("SELECT problem_description FROM v_demand_current WHERE id='d'")
        ["problem_description"]=="修订描述但不改变工程量")
ok("partial demand revision inherits preceding material list without duplicating usage",
    [tuple(x) for x in db.execute("SELECT material_id,quantity_scaled "
        "FROM v_demand_material_current WHERE demand_id='d' ORDER BY material_id")]
      ==[tuple(x) for x in old_bom])
blocked("delta revision may not erase required quantity",
    "INSERT INTO demand_revisions(id,demand_id,version,snapshot_json,reason,"
    "changed_by,changed_at) VALUES(?,?,?,?,?,?,?)",
    ("invalid_patch", "d",last_d+2,'{"quantity_scaled":null}',
     "破坏必须字段","u","2026-11-07T23:21:00.000Z"))
# Reconciliation identity remains fixed across historical versions, even
# when a cost is corrected and produces a newer cost_version_id.
add("cost_entries",id="distinct_cost_for_reconciliation",project_id="p",
    created_by="u",created_at="2026-11-07T23:25:00.000Z")
add("cost_versions",id="distinct_cost_version",entry_id="distinct_cost_for_reconciliation",
    version_no=1,funding_version_id="fund2",status="active",
    category_id="expense",category_snapshot="费用",title="另一笔实际费用",
    occurred_on="2026-11-07",amount_fen=6000,evidence="另一笔凭证",
    reason="核实费用身份",confirmed_by="u",
    confirmed_at="2026-11-07T23:25:00.000Z",
    request_key="distinct_cost_version")
blocked("reconciliation correction cannot transfer the record to a different cost",
    "INSERT INTO cost_reconciliation_versions(id,record_id,version_no,status,"
    "cost_version_id,settlement_item_id,settlement_item_version_id,"
    "reconciled_cost_fen,reconciled_settlement_fen,is_final,evidence,"
    "actor_id,created_at,request_key) VALUES('bad_reassignment','rec_A',2,"
    "'active','distinct_cost_version','it','itemstv2',1000,1000,0,"
    "'另一笔凭证','u','2026-11-07T23:26:00.000Z','bad_reassignment')")
add("cost_reconciliation_versions",id="rec_A_revised",record_id="rec_A",
    version_no=2,status="active",cost_version_id="audit_cv2",
    settlement_item_id="it",settlement_item_version_id="itemstv2",
    reconciled_cost_fen=7000,reconciled_settlement_fen=7000,is_final=0,
    evidence="同一笔费用新版真实金额",actor_id="u",
    created_at="2026-11-07T23:27:00.000Z",request_key="rec_A_revised")
ok("reconciliation may follow corrected cost version of the same expense",
    row("SELECT cost_version_id FROM v_cost_reconciliation_current "
        "WHERE record_id='rec_A'")["cost_version_id"]=="audit_cv2")
# Further structural governance: one source lineage, actual chronology and
# no inactive newly selected master materials (past materials remain legal).
ok("immutable import provenance distinguished from current demand-source links",
    row("SELECT COUNT(*) n FROM sqlite_master "
        "WHERE type='table' AND name='batch_demand_sources'")["n"]==1
    and row("SELECT COUNT(*) n FROM sqlite_master "
        "WHERE type='table' AND name='demand_sources'")["n"]==1)
ok("source facts retain batch membership and demand-source authoritative links",
    "batch_id" in {x["name"] for x in db.execute("PRAGMA table_info(demands)")}
    and row("SELECT COUNT(*) n FROM sqlite_master "
        "WHERE type='table' AND name='demand_sources'")["n"]==1)
db.execute("SAVEPOINT source_lineage_test")
add("demand_sources",demand_id="d",source_id="pms_source")
blocked("used raw source description cannot change without new source evidence",
    "UPDATE source_records SET description='篡改来源' WHERE id='pms_source'")
blocked("used raw source record cannot be deleted",
    "DELETE FROM source_records WHERE id='pms_source'")
blocked("confirmed demand cannot erase its original source association",
    "DELETE FROM demand_sources WHERE demand_id='d' AND source_id='pms_source'")
blocked("demand source may not be silently changed to another source",
    "UPDATE demand_sources SET source_id='missing' WHERE demand_id='d'")
add("demand_batches",id="batch_used",source_id="pms_source",
    status="submitted",draft_json="[]",created_by="u",
    created_at="2026-11-07T23:30:00.000Z",
    updated_at="2026-11-07T23:30:00.000Z")
blocked("submitted batch cannot silently replace origin source",
    "UPDATE demand_batches SET source_id=NULL WHERE id='batch_used'")
demand("imported_from_batch",batch_id="batch_used")
add("batch_demand_sources",batch_id="batch_used",
    demand_id="imported_from_batch",source_id="pms_source")
ok("raw import provenance remains a separate immutable assertion",
    row("SELECT COUNT(*) n FROM batch_demand_sources "
        "WHERE batch_id='batch_used' AND demand_id='imported_from_batch'")["n"]==1)
add("demand_batches",id="other_batch",source_id="pms_source",
    status="submitted",draft_json="[]",created_by="u",
    created_at="2026-11-07T23:30:00.000Z",
    updated_at="2026-11-07T23:30:00.000Z")
blocked("import provenance cannot claim an unrelated batch",
    "INSERT INTO batch_demand_sources(batch_id,demand_id,source_id) "
    "VALUES('other_batch','imported_from_batch','pms_source')")
blocked("raw import provenance row cannot be erased",
    "DELETE FROM batch_demand_sources "
    "WHERE batch_id='batch_used' AND demand_id='imported_from_batch'")
add("source_records",id="raw_import_only",source_system="excel",
    description="仅存在于原始导入断言",
    created_by="u",created_at="2026-11-07T23:31:00.000Z")
add("batch_demand_sources",batch_id="batch_used",
    demand_id="imported_from_batch",source_id="raw_import_only")
blocked("source referenced only by raw batch provenance cannot be rewritten",
    "UPDATE source_records SET description='伪造改动' WHERE id='raw_import_only'")
blocked("source referenced only by raw batch provenance cannot be deleted",
    "DELETE FROM source_records WHERE id='raw_import_only'")


db.execute("ROLLBACK TO source_lineage_test")
db.execute("RELEASE source_lineage_test")

latest=row("SELECT MAX(version) v FROM demand_versions WHERE demand_id='d'")["v"]
blocked("formal demand revision cannot backdate prior published version",
    "INSERT INTO demand_revisions(id,demand_id,version,snapshot_json,"
    "reason,changed_by,changed_at) VALUES(?,?,?,?,?,?,?)",
    ("bad_backdated_revision","d",latest+1,
     '{"problem_description":"倒填历史"}',"倒填历史","u",
     "2026-11-07T00:00:00.000Z"))
db.execute("SAVEPOINT material_status_test")
revise_material("master2",status="inactive",
    recorded_at="2026-11-07T23:30:00.000Z",reason="新增物资选择前停用")
blocked("new demand revision cannot add an inactive master material",
    "INSERT INTO demand_revisions(id,demand_id,version,snapshot_json,"
    "reason,changed_by,changed_at) VALUES(?,?,?,?,?,?,?)",
    ("bad_inactive_added","d",latest+1,
     '{"materials":[{"material_id":"master2","quantity_scaled":1000}]}',
     "新增已停用物资","u","2026-11-07T23:35:00.000Z"))
db.execute("ROLLBACK TO material_status_test")
db.execute("RELEASE material_status_test")

db.execute("SAVEPOINT historical_inactive_material_test")
revise_material("master1",status="inactive",
    recorded_at="2026-11-07T23:36:00.000Z",reason="旧物资保留历史")
add("demand_revisions",id="valid_old_inactive_material",demand_id="d",
    version=latest+1,
    snapshot_json='{"materials":[{"material_id":"master1","quantity_scaled":1000}]}',
    reason="继续保留此前已使用物资",
    changed_by="u",changed_at="2026-11-07T23:40:00.000Z")
ok("historically selected inactive material may remain on existing demand",
    row("SELECT quantity_scaled FROM demand_material_version_items WHERE "
        "demand_id='d' AND demand_version=? AND material_id='master1'",
        latest+1)["quantity_scaled"]==1000)
db.execute("ROLLBACK TO historical_inactive_material_test")
db.execute("RELEASE historical_inactive_material_test")

db.execute("SAVEPOINT demand_lifecycle_order_test")
demand("chronological_demand")
add("demand_lifecycle_events",id="chronological_active",
    demand_id="chronological_demand",event_seq=2,
    from_status="pending",to_status="active",reason="正式确认",actor_id="u",
    recorded_at="2026-11-07T23:42:00.000Z")
blocked("demand lifecycle event cannot go backwards in recorded time",
    "INSERT INTO demand_lifecycle_events(id,demand_id,event_seq,from_status,"
    "to_status,reason,actor_id,recorded_at) VALUES(?,?,?,?,?,?,?,?)",
    ("backward_lifecycle","chronological_demand",3,"active","returned",
     "倒填事件","u","2026-11-07T21:00:00.000Z"))
db.execute("ROLLBACK TO demand_lifecycle_order_test")
db.execute("RELEASE demand_lifecycle_order_test")
# Intake provenance cannot be overwritten once formally submitted. A draft
# is editable under optimistic versioning; provenance associations append only.
blocked("intake batch must contain valid JSON",
    "INSERT INTO demand_batches(id,draft_json,created_by,created_at,updated_at)"
    " VALUES('badBatch','not-json','u','2026-11-07T23:30:00.000Z',"
    "'2026-11-07T23:30:00.000Z')")
blocked("intake batch payload hash must be normalized SHA-256",
    "INSERT INTO demand_batches(id,draft_json,payload_sha256,created_by,"
    "created_at,updated_at) VALUES('badHash','{}','incorrect','u',"
    "'2026-11-07T23:30:00.000Z','2026-11-07T23:30:00.000Z')")
add("demand_batches",id="audit_intake",draft_json='{"work":"v1"}',
    source_id="pms_source",created_by="u",
    created_at="2026-11-07T23:30:00.000Z",
    updated_at="2026-11-07T23:30:00.000Z")
blocked("editing intake draft without optimistic version increment",
    "UPDATE demand_batches SET draft_json='{\"work\":\"v2\"}'"
    " WHERE id='audit_intake'")
db.execute("UPDATE demand_batches SET draft_json='{\"work\":\"v2\"}',"
    " version=2,updated_at='2026-11-07T23:31:00.000Z'"
    " WHERE id='audit_intake'")
ok("editable intake draft is versioned",
    row("SELECT version FROM demand_batches WHERE id='audit_intake'")["version"]==2)
db.execute("UPDATE demand_batches SET status='submitted',"
    "updated_at='2026-11-07T23:32:00.000Z' WHERE id='audit_intake'")
blocked("submitted intake batch cannot be reverted or rewritten",
    "UPDATE demand_batches SET status='draft',draft_json='{}'"
    " WHERE id='audit_intake'")
blocked("submitted intake batch is not deletable",
    "DELETE FROM demand_batches WHERE id='audit_intake'")
# Planned budget and approved detail amounts are different historical facts.
# An unknown approved amount must not be replaced with an old candidate value.
ok("unknown approved scope amount is represented by a real NULL",
    row("SELECT approved_amount_fen FROM v_approval_scope_current "
        "WHERE project_scope_id='snull'")["approved_amount_fen"] is None)
ok("project approval budget is an independent soft planning baseline",
    row("SELECT approved_budget_fen FROM v_project_current_approval "
        "WHERE project_id='p'")["approved_budget_fen"]==20000)

# Physical evidence can attach to the EXACT immutable domain version,
# never an unvalidated (entity_type, entity_id) string.
evidence_ts="2026-11-07T23:45:00.000Z"
dver=row("SELECT MAX(version) v FROM demand_versions WHERE demand_id='d'")["v"]
add("evidence_links",id="ev_demand_version",file_id="ef",
    demand_version_demand_id="d",demand_version_no=dver,
    linked_by="u",linked_at=evidence_ts)
add("evidence_links",id="ev_demand_material",file_id="ef",
    demand_material_demand_id="d",demand_material_version_no=dver,
    demand_material_master_id="master1",linked_by="u",linked_at=evidence_ts)
ok("file evidence references two distinct typed published demand snapshots",
    row("SELECT COUNT(*) n FROM evidence_links WHERE id IN "
        "('ev_demand_version','ev_demand_material')")["n"]==2)
blocked("evidence cannot link to incomplete demand version identity",
    "INSERT INTO evidence_links(id,file_id,demand_version_demand_id,"
    "linked_by,linked_at) VALUES('ev_bad_pair','ef','d','u',?)",(evidence_ts,))
blocked("evidence cannot reference nonexistent demand material version",
    "INSERT INTO evidence_links(id,file_id,demand_material_demand_id,"
    "demand_material_version_no,demand_material_master_id,linked_by,linked_at)"
    " VALUES('ev_bad_material','ef','d',999,'master1','u',?)",(evidence_ts,))
blocked("evidence link must have exactly one business owner even with composites",
    "INSERT INTO evidence_links(id,file_id,demand_version_demand_id,"
    "demand_version_no,project_management_version_id,linked_by,linked_at)"
    " VALUES('ev_two_owners','ef','d',?, 'mgt2','u',?)",(dver,evidence_ts))
add("evidence_links",id="ev_management",file_id="ef",
    project_management_version_id="mgt2",linked_by="u",linked_at=evidence_ts)
add("evidence_links",id="ev_funding",file_id="ef",
    project_funding_version_id="fund2",linked_by="u",linked_at=evidence_ts)
add("evidence_links",id="ev_allocation",file_id="ef",
    cost_allocation_version_id="late_alloc_v1",linked_by="u",linked_at=evidence_ts)
add("evidence_links",id="ev_lifecycle",file_id="ef",
    demand_lifecycle_event_id="d_activate",linked_by="u",linked_at=evidence_ts)
add("evidence_links",id="ev_approved_material",file_id="ef",
    project_approval_material_id="am1",linked_by="u",linked_at=evidence_ts)
stage_id=row("SELECT id FROM project_stage_events WHERE project_id='p' "
    "ORDER BY project_version DESC LIMIT 1")["id"]
add("evidence_links",id="ev_project_stage",file_id="ef",
    project_stage_event_id=stage_id,linked_by="u",linked_at=evidence_ts)
span_history_id=row("SELECT id FROM line_span_history WHERE span_id='span' "
    "ORDER BY version_no DESC LIMIT 1")["id"]
add("evidence_links",id="ev_span_history",file_id="ef",
    line_span_history_id=span_history_id,linked_by="u",linked_at=evidence_ts)
ok("all new typed evidence owner targets are FK-linked and valid",
    row("SELECT COUNT(*) n FROM evidence_links WHERE id LIKE 'ev_%'")["n"]==9)
# Business analytics and reporting belong to the future application
# service, not to the persistent database schema. Canonical effective-fact
# projections used for integrity must remain available.
APPLICATION_ONLY_VIEWS=(
    'v_framework_monthly_cost','v_framework_quarterly_progress',
    'v_project_monthly_cost','v_project_quarterly_cost_contribution',
    'v_scope_progress','v_settlement_workflow','v_material_variance',
    'v_material_usage_by_master','v_project_variance','v_agreement_variance',
    'v_framework_variance','v_cost_reconciliation_freshness',
    'v_settlement_item_variance','v_post_close_activity',
    'v_project_close_recheck','v_funding_historical_actuals',
    'v_project_approved_amount_comparison'
)
present={x["name"] for x in db.execute(
    "SELECT name FROM sqlite_master WHERE type='view'")}
ok("application reporting and analysis do not define SQLite views",
    not present.intersection(APPLICATION_ONLY_VIEWS))
ok("settlement-only model has no construction, completion or maintenance-plan tables",
    all(row("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name=?",name)["n"]==0
        for name in ("executions","execution_items","completion_records",
                     "completion_revisions","project_closure_dispositions"))
    and row("SELECT count(*) n FROM sqlite_master WHERE type='table' "
            "AND name='settlements'")["n"]==1)
ok("settlement-only schema has no obsolete evidence FK for completed work",
    not any(x["name"]=="completion_record_id"
            for x in db.execute("PRAGMA table_info(evidence_links)"))
    and not any(x["table"]=="completion_records"
                for x in db.execute("PRAGMA foreign_key_list(evidence_links)")))
ok("no standalone material issue/return transactions or evidence references exist",
    all(row("SELECT COUNT(*) n FROM sqlite_master "
            "WHERE type='table' AND name=?",name)["n"]==0
        for name in ("material_usage_records","material_usage_revisions"))
    and row("SELECT COUNT(*) n FROM sqlite_master WHERE type='view' "
            "AND name='v_material_usage_current'")["n"]==0
    and not any(x["name"]=="material_consumption_id"
                for x in db.execute("PRAGMA table_info(evidence_links)"))
    and not any(x["table"]=="material_usage_records"
                for x in db.execute("PRAGMA foreign_key_list(evidence_links)")))
ok("only canonical effective-business-fact views remain",
    len(present)==23
    and {'v_approval_scope_current',
         'v_settlement_review_status','v_cost_current',
         'v_cost_reconciliation_current',
         'v_effective_cost_reconciliations',
         'v_effective_settlement_items','v_demand_current',
         'v_material_current'}.issubset(present))
closure_ddl=row("SELECT sql FROM sqlite_master WHERE type='trigger'"
    " AND name='project_close_guard'")["sql"]
ok("database trigger bodies have no embedded application role-authorization rules",
    row("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' "
        "AND sql LIKE '%role_permissions%'")["n"]==0
    and row("SELECT COUNT(*) n FROM role_permissions")["n"]>0)
ok("project closeout checks effective financial facts without construction views",
    'v_effective_cost_reconciliations' in closure_ddl
    and 'v_effective_settlement_items' in closure_ddl
    and 'v_completion_current' not in closure_ddl
    and 'v_scope_progress' not in closure_ddl
    and 'v_settlement_workflow' not in closure_ddl)
# Actual expenses are project facts, NOT settlement documents. They must
# be accepted before a project even has a settlement number; later settlement
# allocation/reconciliation must match project identity, not be fictional cost.
add("projects",id="expense_first_project",code="EXP-FIRST",
    name="先发生费用后结算的子项目",framework_id="f",
    created_by="u",created_at="2026-11-07T20:00:00.000Z",
    updated_at="2026-11-07T20:00:00.000Z")
ok("the project has no settlement before cost is recorded",
    row("SELECT COUNT(*) n FROM settlements WHERE project_id='expense_first_project'")["n"]==0)
add("cost_entries",id="independent_project_cost",
    project_id="expense_first_project",
    created_by="u",created_at="2026-11-07T20:01:00.000Z")
add("cost_versions",id="independent_project_cost_v1",
    entry_id="independent_project_cost",version_no=1,status="active",
    category_id="expense",category_snapshot="费用",
    title="结算前实际发生的工作费用",occurred_on="2026-11-07",
    amount_fen=17500,evidence="真实费用依据",reason="结算前已发生",
    confirmed_by="u",confirmed_at="2026-11-07T20:02:00.000Z",
    request_key="independent_project_cost_v1")
ok("valid actual cost exists without any settlement document",
    row("SELECT project_id FROM v_cost_current "
        "WHERE entry_id='independent_project_cost'")["project_id"]
        =="expense_first_project"
    and row("SELECT amount_fen FROM v_cost_current "
        "WHERE entry_id='independent_project_cost'")["amount_fen"]==17500)
blocked("independent cost cannot be allocated to another project's settlement",
    "INSERT INTO cost_allocations(id,cost_entry_id,settlement_item_id,created_at) "
    "VALUES('cross_project_cost_alloc','independent_project_cost','it',"
    "'2026-11-07T20:03:00.000Z')")
blocked("independent cost cannot reconcile another project's settlement item",
    "INSERT INTO cost_reconciliation_versions(id,record_id,version_no,status,"
    "cost_version_id,settlement_item_id,settlement_item_version_id,"
    "reconciled_cost_fen,reconciled_settlement_fen,is_final,evidence,"
    "actor_id,created_at,request_key) VALUES('cross_project_reconcile',"
    "'cross_project_reconcile',1,'active','independent_project_cost_v1',"
    "'it','itemstv2',500,500,0,'真实凭据','u',"
    "'2026-11-07T20:04:00.000Z','cross_project_reconcile')")
ok("existing cost allocations keep their original amount without double counting",
    row("SELECT project_id FROM cost_entries WHERE id='audit_ce'")["project_id"]=="p"
    and row("SELECT id FROM v_cost_current WHERE entry_id='audit_ce'")["id"]
      =="audit_cv2")
# Explicit query-plan coverage: prioritize domain reverse lookups, not an
# index on every rarely-read audit actor FK.
query_index_contracts=[
 ("real costs by project irrespective of settlement",
  "SELECT id FROM cost_entries WHERE project_id=?",
  ("p",),"idx_cost_entries_project"),
 ("financial reconciliation by actual cost version",
  "SELECT id FROM cost_reconciliation_versions WHERE cost_version_id=?",
  ("audit_cv",),"idx_reconciliation_cost_version"),
 ("approval scope by actual demand version",
  "SELECT id FROM project_approval_scope_versions "
  "WHERE demand_id=? AND demand_version=?",
  ("d",2),"idx_approval_scope_demand_version"),
 ("evidence tied to exact published demand version",
  "SELECT id FROM evidence_links "
  "WHERE demand_version_demand_id=? AND demand_version_no=?",
  ("d",2),"idx_evidence_demand_version"),
 ("evidence tied to exact published material version",
  "SELECT id FROM evidence_links WHERE demand_material_demand_id=? "
  "AND demand_material_version_no=? AND demand_material_master_id=?",
  ("d",2,"master1"),"idx_evidence_demand_material_version"),
]
for label,sql,args,expected_index in query_index_contracts:
    plan=" ".join(str(x[3]) for x in db.execute(
        "EXPLAIN QUERY PLAN "+sql,args).fetchall())
    ok("indexed reverse lookup: "+label,expected_index in plan)
# PMS custody facts: store ONLY transmission-center-managed length of
# each span. Unknown is NULL, definite zero is 0; quantity is integer mm.
ok("span has independent nullable transmission-center custody length",
    row("SELECT transmission_center_length_mm FROM line_spans "
        "WHERE id='span'")["transmission_center_length_mm"] is None)
db.execute("SAVEPOINT span_custody_revision")
span_version=row("SELECT version FROM line_spans WHERE id='span'")["version"]
db.execute("UPDATE line_spans SET transmission_center_length_mm=125750,"
    "version=?,updated_by='u',change_reason='2026最新台账管辖长度复核',"
    "updated_at='2026-11-07T23:50:00.000Z' WHERE id='span'",
    (span_version+1,))
ok("managed span length changes only through true versioned asset history",
    row("SELECT transmission_center_length_mm FROM line_spans "
        "WHERE id='span'")["transmission_center_length_mm"]==125750
    and row("SELECT transmission_center_length_mm FROM line_span_history "
        "WHERE span_id='span' AND version_no=?",span_version+1
        )["transmission_center_length_mm"]==125750
    and row("SELECT transmission_center_length_mm FROM line_span_history "
        "WHERE span_id='span' AND version_no=?",span_version
        )["transmission_center_length_mm"] is None)
blocked("negative span custody length is not a valid physical length",
    "UPDATE line_spans SET transmission_center_length_mm=-5,version=?,"
    "updated_by='u',change_reason='非法',"
    "updated_at='2026-11-07T23:51:00.000Z' WHERE id='span'",
    (span_version+2,))
db.execute("ROLLBACK TO span_custody_revision")
db.execute("RELEASE span_custody_revision")
ok("new candidate SQLite database declares schema version 113",
    row("PRAGMA user_version")[0]==113)
# Full end-to-end database scenario: provenance -> demand V1/materials ->
# stocked project -> formal approval -> true work/material/cost facts BEFORE any
# settlement -> approved final statement -> final cost reconciliation -> close.
demand("end_to_end_d")
add("demand_material_items",id="end_to_end_dm",demand_id="end_to_end_d",
    item_no=1,material_id="master2",quantity_scaled=1000,
    created_at="2026-11-07T00:00:00.000Z",
    updated_at="2026-11-07T00:00:00.000Z")
activate_demand("end_to_end_d")
add("projects",id="end_to_end_p",code="E2E-P",name="数据库完整业务闭环",
    framework_id="f",created_by="u",
    created_at="2026-11-07T20:30:00.000Z",
    updated_at="2026-11-07T20:30:00.000Z")
stage("end_to_end_p","stocked",time="2026-11-07T20:31:00.000Z")
add("project_demand_scopes",id="end_to_end_scope",
    project_id="end_to_end_p",demand_id="end_to_end_d",
    demand_version=1,proposed_quantity_scaled=10000,
    proposed_amount_fen=3000,created_at="2026-11-07T20:31:00.000Z",
    updated_at="2026-11-07T20:31:00.000Z")
add("project_scope_materials",id="end_to_end_pm",
    project_scope_id="end_to_end_scope",material_id="master2",
    created_at="2026-11-07T20:32:00.000Z")
add("project_approval_versions",id="end_to_end_ap",
    project_id="end_to_end_p",version_no=1,
    snapshot_json="{}",approved_budget_fen=3000,
    created_at="2026-11-07T20:32:00.000Z")
add("project_approval_scope_versions",id="end_to_end_aps",
    approval_version_id="end_to_end_ap",
    project_scope_id="end_to_end_scope",demand_id="end_to_end_d",
    demand_version=1,quantity_scaled=10000,approved_amount_fen=3000,
    snapshot_json="{}",created_at="2026-11-07T20:32:00.000Z")
add("project_approval_material_items",id="end_to_end_apm",
    approval_version_id="end_to_end_ap",
    project_scope_id="end_to_end_scope",project_material_id="end_to_end_pm",
    item_no=1,material_code_snapshot="MAT-002",
    material_name="连接金具",material_model="JG-01",
    specification="热镀锌",approved_quantity_scaled=1000,
    unit_id="unit",unit_snapshot="套")
db.execute("UPDATE project_approval_versions SET status='approved',"
    "approved_by='u',approved_at='2026-11-07T20:33:00.000Z'"
    " WHERE id='end_to_end_ap'")
stage("end_to_end_p","approved",time="2026-11-07T20:34:00.000Z")
add("cost_entries",id="end_to_end_cost",project_id="end_to_end_p",
    created_by="u",created_at="2026-11-07T20:37:00.000Z")
add("cost_versions",id="end_to_end_cv",entry_id="end_to_end_cost",
    version_no=1,status="active",category_id="expense",
    category_snapshot="费用",title="现场实际费用",occurred_on="2026-11-07",
    amount_fen=3000,evidence="实际费用凭据",reason="发生事实",
    confirmed_by="u",confirmed_at="2026-11-07T20:38:00.000Z",
    request_key="end_to_end_cv")
ok("project retains approved material snapshot and real cost before settlement",
    row("SELECT COUNT(*) n FROM settlements "
        "WHERE project_id='end_to_end_p'")["n"]==0
    and row("SELECT approved_quantity_scaled FROM project_approval_material_items "
        "WHERE id='end_to_end_apm'")["approved_quantity_scaled"]==1000
    and row("SELECT amount_fen FROM v_cost_current "
        "WHERE entry_id='end_to_end_cost'")["amount_fen"]==3000)
add("settlements",id="end_to_end_st",project_id="end_to_end_p",
    number="E2E-S1",created_by="u",created_at="2026-11-07T20:39:00.000Z")
add("settlement_items",id="end_to_end_item",
    settlement_id="end_to_end_st",project_scope_id="end_to_end_scope",
    created_at="2026-11-07T20:40:00.000Z")
add("settlement_versions",id="end_to_end_sv",
    settlement_id="end_to_end_st",version_no=1,
    approval_version_id="end_to_end_ap",
    change_type="initial",reason="最终结算",
    created_by="u",recorded_at="2026-11-07T20:41:00.000Z")
add("settlement_item_versions",id="end_to_end_itemv",
    settlement_item_id="end_to_end_item",
    settlement_version_id="end_to_end_sv",
    approval_scope_version_id="end_to_end_aps",
    quantity_scaled=10000,amount_fen=3000,
    evidence="验收结算依据",scope_snapshot_json="{}")
add("settlement_review_events",id="end_to_end_submit",
    settlement_version_id="end_to_end_sv",event_seq=1,
    action="submit",actor_id="u",recorded_at="2026-11-07T20:42:00.000Z")
add("settlement_review_events",id="end_to_end_approve",
    settlement_version_id="end_to_end_sv",event_seq=2,
    action="approve",actor_id="u",
    recorded_at="2026-11-07T20:43:00.000Z",effective_on="2026-11-07")
add("cost_reconciliation_versions",id="end_to_end_reconcile",
    record_id="end_to_end_reconcile",version_no=1,status="active",
    cost_version_id="end_to_end_cv",
    settlement_item_id="end_to_end_item",
    settlement_item_version_id="end_to_end_itemv",
    reconciled_cost_fen=3000,reconciled_settlement_fen=3000,
    is_final=1,evidence="业务核对依据",
    actor_id="u",created_at="2026-11-07T20:44:00.000Z",
    request_key="end_to_end_reconcile")
# Regression: final closure must count historical reconciliations against the
# SAME stable cost entry, even after the true expense is formally corrected.
# Per-statement "is_final" flags are not a substitute for the derived balance.
add("cost_versions",id="end_to_end_cv_v2",entry_id="end_to_end_cost",
    version_no=2,status="active",category_id="expense",
    category_snapshot="费用",title="现场实际费用追加",
    occurred_on="2026-11-07",amount_fen=3500,
    evidence="新增实际费用500分",reason="实际费用正式补录",
    confirmed_by="u",confirmed_at="2026-11-07T20:44:05.000Z",
    request_key="end_to_end_cv_v2")
add("settlements",id="end_to_end_st2",project_id="end_to_end_p",
    number="E2E-S2",created_by="u",created_at="2026-11-07T20:44:10.000Z")
add("settlement_items",id="end_to_end_item2",
    settlement_id="end_to_end_st2",project_scope_id="end_to_end_scope",
    created_at="2026-11-07T20:44:11.000Z")
add("settlement_versions",id="end_to_end_sv2",
    settlement_id="end_to_end_st2",version_no=1,
    approval_version_id="end_to_end_ap",change_type="initial",
    reason="第二期新增费用结算",created_by="u",
    recorded_at="2026-11-07T20:44:12.000Z")
add("settlement_item_versions",id="end_to_end_itemv2",
    settlement_item_id="end_to_end_item2",
    settlement_version_id="end_to_end_sv2",
    approval_scope_version_id="end_to_end_aps",
    quantity_scaled=0,amount_fen=500,
    evidence="追加费用结算",scope_snapshot_json="{}")
add("settlement_review_events",id="end_to_end_submit2",
    settlement_version_id="end_to_end_sv2",event_seq=1,
    action="submit",actor_id="u",recorded_at="2026-11-07T20:44:13.000Z")
add("settlement_review_events",id="end_to_end_approve2",
    settlement_version_id="end_to_end_sv2",event_seq=2,
    action="approve",actor_id="u",
    recorded_at="2026-11-07T20:44:14.000Z",
    effective_on="2026-11-07")
add("cost_reconciliation_versions",id="end_to_end_reconcile2",
    record_id="end_to_end_reconcile2",version_no=1,status="active",
    cost_version_id="end_to_end_cv_v2",
    settlement_item_id="end_to_end_item2",
    settlement_item_version_id="end_to_end_itemv2",
    reconciled_cost_fen=500,reconciled_settlement_fen=500,
    is_final=1,evidence="追加结算最终核对",
    actor_id="u",created_at="2026-11-07T20:44:15.000Z",
    request_key="end_to_end_reconcile2")
ok("cross-version installment reconciliation covers corrected actual cost",
    row("SELECT sum(reconciled_cost_fen) n FROM "
        "v_effective_cost_reconciliations WHERE entry_id='end_to_end_cost'")["n"]==3500
    and row("SELECT amount_fen FROM v_cost_current "
        "WHERE entry_id='end_to_end_cost'")["amount_fen"]==3500)
# A revised statement supersedes its former approved snapshot and MUST
# invalidate the previous 3000-fen cost application (not erase its history).
add("settlement_versions",id="end_to_end_sv_revision",
    settlement_id="end_to_end_st",version_no=2,
    previous_version_id="end_to_end_sv",
    approval_version_id="end_to_end_ap",change_type="revision",
    reason="第一期实际结算金额减少500分",
    created_by="u",recorded_at="2026-11-07T20:44:16.000Z")
add("settlement_item_versions",id="end_to_end_itemv_revision",
    settlement_item_id="end_to_end_item",
    settlement_version_id="end_to_end_sv_revision",
    approval_scope_version_id="end_to_end_aps",
    quantity_scaled=10000,amount_fen=2500,
    evidence="第一期正式更正",scope_snapshot_json="{}")
add("settlement_review_events",id="end_to_end_revision_submit",
    settlement_version_id="end_to_end_sv_revision",event_seq=1,
    action="submit",actor_id="u",recorded_at="2026-11-07T20:44:17.000Z")
add("settlement_review_events",id="end_to_end_revision_approve",
    settlement_version_id="end_to_end_sv_revision",event_seq=2,
    action="approve",actor_id="u",
    recorded_at="2026-11-07T20:44:18.000Z",effective_on="2026-11-07")
ok("approved revision removes superseded installment from effective cost",
    row("SELECT sum(reconciled_cost_fen) n FROM "
        "v_effective_cost_reconciliations WHERE entry_id='end_to_end_cost'")["n"]==500
    and row("SELECT amount_fen FROM v_effective_settlement_items "
        "WHERE id='end_to_end_item'")["amount_fen"]==2500)
add("project_closures",id="end_to_end_close",
    project_id="end_to_end_p",approval_version_id="end_to_end_ap",
    reason="本子项目全部费用已最终核对",close_snapshot_json="{}",
    closed_by="u",closed_at="2026-11-07T20:45:00.000Z")
# Closure must reject an older approved reconciliation as evidence for a
# newer changed statement snapshot, even though its history still exists.
def e2e_close_rejection(label, message):
    version=row("SELECT version FROM projects WHERE id='end_to_end_p'")["version"]+1
    db.execute("SAVEPOINT invalid_e2e_close")
    try:
        add("project_stage_events",id="invalid_e2e_close",
            project_id="end_to_end_p",stage="closed",
            project_version=version,reason="拟核对结项",
            actor_id="u",created_at="2026-11-07T20:44:19.000Z")
    except sqlite3.IntegrityError as error:
        ok(label,message in str(error))
    else:
        raise AssertionError("Unreconciled project was permitted to close: "+label)
    finally:
        db.execute("ROLLBACK TO invalid_e2e_close")
        db.execute("RELEASE invalid_e2e_close")

e2e_close_rejection("revised statement cannot close using former approved cost reconciliation",
                    "实际费用与各期有效最终核对金额不一致")
add("cost_reconciliation_versions",id="end_to_end_reconcile_revision",
    record_id="end_to_end_reconcile_revision",version_no=1,status="active",
    cost_version_id="end_to_end_cv_v2",
    settlement_item_id="end_to_end_item",
    settlement_item_version_id="end_to_end_itemv_revision",
    reconciled_cost_fen=2500,reconciled_settlement_fen=2500,
    is_final=1,evidence="新版第一期最终核对",
    actor_id="u",created_at="2026-11-07T20:44:20.000Z",
    request_key="end_to_end_reconcile_revision")
# The second approved installment is still only 500: one more new
# 500-fen statement is needed after the first statement reduction.
add("settlements",id="end_to_end_st3",project_id="end_to_end_p",
    number="E2E-S3",created_by="u",
    created_at="2026-11-07T20:44:21.000Z")
add("settlement_items",id="end_to_end_item3",
    settlement_id="end_to_end_st3",project_scope_id="end_to_end_scope",
    created_at="2026-11-07T20:44:22.000Z")
add("settlement_versions",id="end_to_end_sv3",
    settlement_id="end_to_end_st3",version_no=1,
    approval_version_id="end_to_end_ap",change_type="initial",
    reason="第一期更正后的余额结算",created_by="u",
    recorded_at="2026-11-07T20:44:23.000Z")
add("settlement_item_versions",id="end_to_end_itemv3",
    settlement_item_id="end_to_end_item3",
    settlement_version_id="end_to_end_sv3",
    approval_scope_version_id="end_to_end_aps",
    quantity_scaled=0,amount_fen=450,
    evidence="余额费用核减50分后最终结算",scope_snapshot_json="{}")
add("settlement_review_events",id="end_to_end_submit3",
    settlement_version_id="end_to_end_sv3",event_seq=1,
    action="submit",actor_id="u",
    recorded_at="2026-11-07T20:44:24.000Z")
add("settlement_review_events",id="end_to_end_approve3",
    settlement_version_id="end_to_end_sv3",event_seq=2,
    action="approve",actor_id="u",
    recorded_at="2026-11-07T20:44:25.000Z",
    effective_on="2026-11-07")
add("cost_reconciliation_versions",id="end_to_end_reconcile3",
    record_id="end_to_end_reconcile3",version_no=1,status="active",
    cost_version_id="end_to_end_cv_v2",
    settlement_item_id="end_to_end_item3",
    settlement_item_version_id="end_to_end_itemv3",
    reconciled_cost_fen=500,reconciled_settlement_fen=450,
    is_final=0,evidence="本期发生500分，核减50分，确认结算450分",
    actor_id="u",created_at="2026-11-07T20:44:26.000Z",
    request_key="end_to_end_reconcile3")
ok("newly revised three-installment settlement reconciles complete true cost",
    row("SELECT sum(reconciled_cost_fen) n FROM "
        "v_effective_cost_reconciliations WHERE entry_id='end_to_end_cost'")["n"]==3500)
# Although every cent is provisionally mapped, is_final=0 means a real
# review is still outstanding. The closeout cannot infer finality from sums.
e2e_close_rejection("amount matching alone cannot mark a provisional reconciliation final",
                    "实际费用与各期有效最终核对金额不一致")
add("cost_reconciliation_versions",id="end_to_end_reconcile3_final",
    record_id="end_to_end_reconcile3",version_no=2,status="active",
    cost_version_id="end_to_end_cv_v2",
    settlement_item_id="end_to_end_item3",
    settlement_item_version_id="end_to_end_itemv3",
    reconciled_cost_fen=500,reconciled_settlement_fen=450,
    is_final=1,evidence="发生500分、核减50分的最终审核",
    actor_id="u",created_at="2026-11-07T20:44:26.001Z",
    request_key="end_to_end_reconcile3_final")
ok("final review is an independently versioned approval fact, not an inferred running balance",
    row("SELECT sum(reconciled_cost_fen) n FROM "
        "v_effective_cost_reconciliations WHERE entry_id='end_to_end_cost' "
        "AND is_final=1")["n"]==3500
    and row("SELECT is_final FROM v_cost_reconciliation_current "
        "WHERE record_id='end_to_end_reconcile3'")["is_final"]==1)
ok("audited deduction does not create false outstanding actual-cost balance",
    row("SELECT sum(reconciled_cost_fen) n FROM "
        "v_effective_cost_reconciliations WHERE entry_id='end_to_end_cost' "
        "AND is_final=1")["n"]==3500
    and row("SELECT sum(reconciled_settlement_fen) n FROM "
        "v_effective_cost_reconciliations WHERE entry_id='end_to_end_cost' "
        "AND is_final=1")["n"]==3450
    and row("SELECT sum(net_amount_fen) n FROM "
        "v_effective_settlement_items WHERE project_id='end_to_end_p'")["n"]==3450)
# Additional approved statement with no associated actual expense MUST NOT
# be treated as settlement merely because all other actual costs are covered.
add("settlements",id="end_to_end_st_extra",project_id="end_to_end_p",
    number="E2E-EXTRA",created_by="u",
    created_at="2026-11-07T20:44:27.000Z")
add("settlement_items",id="end_to_end_extra_item",
    settlement_id="end_to_end_st_extra",project_scope_id="end_to_end_scope",
    created_at="2026-11-07T20:44:28.000Z")
add("settlement_versions",id="end_to_end_extra_v1",
    settlement_id="end_to_end_st_extra",version_no=1,
    approval_version_id="end_to_end_ap",change_type="initial",
    reason="待核对的额外结算",created_by="u",
    recorded_at="2026-11-07T20:44:29.000Z")
add("settlement_item_versions",id="end_to_end_extra_itemv",
    settlement_item_id="end_to_end_extra_item",
    settlement_version_id="end_to_end_extra_v1",
    approval_scope_version_id="end_to_end_aps",
    quantity_scaled=0,amount_fen=25,
    evidence="无实际费用核对的金额",scope_snapshot_json="{}")
add("settlement_review_events",id="end_to_end_extra_submit",
    settlement_version_id="end_to_end_extra_v1",event_seq=1,
    action="submit",actor_id="u",
    recorded_at="2026-11-07T20:44:30.000Z")
add("settlement_review_events",id="end_to_end_extra_approve",
    settlement_version_id="end_to_end_extra_v1",event_seq=2,
    action="approve",actor_id="u",
    recorded_at="2026-11-07T20:44:31.000Z",effective_on="2026-11-07")
e2e_close_rejection("approved unmatched settlement amount cannot be hidden by fully paid costs",
                    "未完成实际费用核对的有效结算明细")
# Explicit approved void supersedes only that extra statement. Nothing is
# silently erased from the audit history or earlier approved snapshots.
add("settlement_versions",id="end_to_end_extra_void",
    settlement_id="end_to_end_st_extra",version_no=2,
    previous_version_id="end_to_end_extra_v1",
    approval_version_id="end_to_end_ap",change_type="void",
    reason="额外结算缺少真实费用，正式注销",
    created_by="u",recorded_at="2026-11-07T20:44:32.000Z")
add("settlement_review_events",id="end_to_end_extra_void_submit",
    settlement_version_id="end_to_end_extra_void",event_seq=1,
    action="submit",actor_id="u",
    recorded_at="2026-11-07T20:44:33.000Z")
add("settlement_review_events",id="end_to_end_extra_void_approve",
    settlement_version_id="end_to_end_extra_void",event_seq=2,
    action="approve",actor_id="u",
    recorded_at="2026-11-07T20:44:34.000Z",effective_on="2026-11-07")
ok("formal statement void preserves history and removes unsupported effective balance",
    row("SELECT count(*) n FROM v_effective_settlement_items "
        "WHERE settlement_id='end_to_end_st_extra'")["n"]==0
    and row("SELECT count(*) n FROM settlement_item_versions "
        "WHERE settlement_item_id='end_to_end_extra_item'")["n"]==1)
stage("end_to_end_p","closed",time="2026-11-07T20:46:00.000Z")
ok("complete end-to-end business facts can settle, reconcile and close",
    row("SELECT status FROM projects WHERE id='end_to_end_p'")["status"]=="closed"
    and row("SELECT net_amount_fen FROM v_effective_settlement_items "
        "WHERE id='end_to_end_item'")["net_amount_fen"]==2500
    and row("SELECT count(*) n FROM v_effective_settlement_items "
        "WHERE project_id='end_to_end_p'")["n"]==3
    and row("SELECT sum(reconciled_cost_fen) n FROM "
        "v_effective_cost_reconciliations "
        "WHERE entry_id='end_to_end_cost'")["n"]==3500
    and row("SELECT status FROM v_cost_reconciliation_current "
        "WHERE record_id='end_to_end_reconcile'")["status"]=="active")
# A catalog version is separate from project approval history; exact
# material-version identities must survive later master definition changes.
ok("material stable identity contains no duplicated current name/model/status",
    {'id','code','unit_id','created_at','created_by'}
       =={x[1] for x in db.execute("PRAGMA table_info(materials)")})
ok("material version history is immutable and contiguous",
    [x["version_no"] for x in db.execute(
        "SELECT version_no FROM material_versions "
        "WHERE material_id='master1' ORDER BY version_no")]==[1,2,3])
ok("demand historical versions retain the source master version used then",
    row("SELECT material_version_id FROM demand_material_version_items "
        "WHERE demand_id='d' AND demand_version=1 AND material_id='master1'")
      ["material_version_id"]=="master1_v1"
    and row("SELECT material_version_id FROM demand_material_version_items "
        "WHERE demand_id='d' AND demand_version=2 AND material_id='master1'")
      ["material_version_id"]=="master1_v1"
    and row("SELECT material_version_id FROM demand_material_version_items "
        "WHERE demand_id='d' AND demand_version=3 AND material_id='master1'")
      ["material_version_id"]=="master1_v3")
ok("project approval snapshots remain linked to old master version",
    row("SELECT material_version_id FROM project_approval_material_items "
        "WHERE id='am1'")["material_version_id"]=="master1_v1"
    and row("SELECT material_name FROM project_approval_material_items "
        "WHERE id='am1'")["material_name"]=="绝缘子"
    and row("SELECT material_version_id FROM v_material_current "
        "WHERE id='master1'")["material_version_id"]=="master1_v3")
blocked("material versions cannot be overwritten",
    "UPDATE material_versions SET model='覆盖旧历史' WHERE id='master1_v1'")
blocked("material versions cannot be deleted",
    "DELETE FROM material_versions WHERE id='master1_v1'")
blocked("material master root identity cannot be altered silently",
    "UPDATE materials SET code='CHANGED' WHERE id='master1'")
blocked("material new version numbers cannot skip historical versions",
    "INSERT INTO material_versions(id,material_id,version_no,name,status,"
    "reason,changed_by,recorded_at) VALUES(?,?,?,?,?,?,?,?)",
    ("gap_material_v5","master1",5,"跳号","active","跳号",
     "u","2026-11-08T00:00:00.000Z"))
blocked("material new version must reflect an actual property change",
    "INSERT INTO material_versions(id,material_id,version_no,name,model,"
    "specification,category_id,status,note,reason,changed_by,recorded_at)"
    " SELECT 'duplicate_catalog_v4',material_id,4,name,model,"
    "specification,category_id,status,note,'无变化','u',"
    "'2026-11-08T00:00:00.000Z' FROM material_versions "
    "WHERE id='master1_v3'")
blocked("material version cannot backdate a previous published definition",
    "INSERT INTO material_versions(id,material_id,version_no,name,status,"
    "reason,changed_by,recorded_at) VALUES(?,?,?,?,?,?,?,?)",
    ("backdated_material_v4","master1",4,"新名称","active","时间倒置",
     "u","2026-11-07T01:00:00.000Z"))
db.execute("SAVEPOINT orphan_material_master")
insert_raw("materials",id="orphan_material_master",code="ORPHAN",
    unit_id="unit",created_by="u",
    created_at="2026-11-07T23:59:00.000Z")
demand("orphan_material_demand")
blocked("unpublished master definition cannot be added to a new demand",
    "INSERT INTO demand_material_items(id,demand_id,item_no,material_id,"
    "quantity_scaled,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    ("orphan_material_item","orphan_material_demand",1,
     "orphan_material_master",100,"2026-11-07T23:59:00.000Z",
     "2026-11-07T23:59:00.000Z"))
blocked("unpublished material master cannot be added to a project scope",
    "INSERT INTO project_scope_materials(id,project_scope_id,material_id,"
    "addition_reason,created_at) VALUES(?,?,?,?,?)",
    ("orphan_project_material","scope","orphan_material_master",
     "现场新增","2026-11-07T23:59:00.000Z"))
db.execute("ROLLBACK TO orphan_material_master")
db.execute("RELEASE orphan_material_master")
add("evidence_links",id="evidence_master_history",file_id="ef",
    material_version_id="master1_v1",linked_by="u",
    linked_at="2026-11-07T23:59:00.000Z")
ok("documentary evidence may refer to an exact immutable material version",
    row("SELECT material_version_id FROM evidence_links "
        "WHERE id='evidence_master_history'")["material_version_id"]=="master1_v1")
blocked("evidence cannot link to nonexistent material master history",
    "INSERT INTO evidence_links(id,file_id,material_version_id,"
    "linked_by,linked_at) VALUES(?,?,?,?,?)",
    ("evidence_fake_master_history","ef","nonexistent_master_version",
     "u","2026-11-07T23:59:00.000Z"))
blocked("material evidence owner must be unique",
    "INSERT INTO evidence_links(id,file_id,material_version_id,"
    "project_closure_id,linked_by,linked_at) VALUES(?,?,?,?,?,?)",
    ("evidence_bad_ambiguous_owner","ef","master1_v2",
     "end_to_end_close","u","2026-11-07T23:59:00.000Z"))
for source_table,version_column,idx in [
    ("demand_material_version_items","material_version_id",
     "idx_demand_material_catalog_version"),
    ("project_approval_material_items","material_version_id",
     "idx_approved_material_catalog_version"),
    ("evidence_links","material_version_id",
     "idx_evidence_material_catalog_version"),
]:
    detail=" ".join(str(q[3]) for q in db.execute(
        "EXPLAIN QUERY PLAN SELECT * FROM "+source_table+
        " WHERE "+version_column+"=?",("master1_v1",)))
    ok("indexed material version evidence lookup: "+source_table,
        idx in detail)
# PMS material code is an external mapping, not an immutable local identity.
# A correction must be auditable, and two current materials cannot claim the
# same external code (ASCII case-insensitive).
add("materials",id="pms_mat_a",code="LOCAL-A",name="PMS映射试验A",
    pms_material_code="PMS-ORIGINAL",unit_id="unit",
    created_by="u",created_at="2026-11-07T12:00:00.000Z")
add("materials",id="pms_mat_b",code="LOCAL-B",name="PMS映射试验B",
    unit_id="unit",created_by="u",
    created_at="2026-11-07T12:00:00.000Z")
ok("initial PMS external code belongs to a material version",
    row("SELECT pms_material_code FROM material_versions "
        "WHERE id='pms_mat_a_v1'")["pms_material_code"]=="PMS-ORIGINAL")
blocked("two current materials cannot claim one case-insensitive PMS code",
    "INSERT INTO material_versions(id,material_id,version_no,pms_material_code,"
    "name,status,reason,changed_by,recorded_at)"
    " VALUES(?,?,?,?,?,?,?,?,?)",
    ("duplicate_pms_v2","pms_mat_b",2,"pms-original",
     "PMS映射试验B","active","冲突映射","u","2026-11-07T13:00:00.000Z"))
revise_material("pms_mat_a",pms_material_code="PMS-CORRECTED",
    recorded_at="2026-11-07T13:00:00.000Z",
    reason="外部PMS编码勘误")
ok("PMS code correction retains old external code in immutable history",
    row("SELECT pms_material_code FROM material_versions WHERE "
        "id='pms_mat_a_v1'")["pms_material_code"]=="PMS-ORIGINAL"
    and row("SELECT pms_material_code FROM v_material_current "
        "WHERE id='pms_mat_a'")["pms_material_code"]=="PMS-CORRECTED"
    and row("SELECT code FROM materials WHERE id='pms_mat_a'")["code"]
       =="LOCAL-A")
revise_material("pms_mat_b",pms_material_code="PMS-ORIGINAL",
    recorded_at="2026-11-07T13:01:00.000Z",
    reason="旧PMS编码完成正式重新映射")
ok("old external PMS alias can be reassigned only after it is no longer current",
    row("SELECT pms_material_code FROM v_material_current "
        "WHERE id='pms_mat_b'")["pms_material_code"]=="PMS-ORIGINAL"
    and row("SELECT pms_material_code FROM material_versions "
        "WHERE id='pms_mat_a_v1'")["pms_material_code"]=="PMS-ORIGINAL")
# User-confirmed business model: one subproject can be settled in MANY
# independent installments. Each approved settlement item is its THIS-TIME
# amount, never a cumulative amount. Actual cost is settled progressively
# through real cost-to-statement reconciliation; avoid counting historic
# replaced statement versions or counting allocation+reconciliation twice.
db.execute("SAVEPOINT user_confirmed_installments")
try:
    add("cost_entries",id="installment_cost",project_id="p",
        created_by="u",created_at="2026-11-08T02:00:00.000Z")
    add("cost_versions",id="installment_cost_v1",
        entry_id="installment_cost",funding_version_id="fund2",
        version_no=1,status="active",category_id="expense",
        category_snapshot="费用",title="待分期结算的真实费用",
        occurred_on="2026-11-08",amount_fen=10000,
        evidence="实际费用确认凭据",reason="实际发生",
        confirmed_by="u",confirmed_at="2026-11-08T02:01:00.000Z",
        request_key="installment_cost_v1")

    def installment_settlement(num, settled_amount):
        sid=f"installment_st_{num}"
        item=f"installment_item_{num}"
        version=f"installment_v_{num}"
        item_version=f"installment_item_v_{num}"
        add("settlements",id=sid,project_id="p",
            number=f"INST-{num}",created_by="u",
            created_at="2026-11-08T02:02:00.000Z")
        add("settlement_items",id=item,settlement_id=sid,
            project_scope_id="scope",
            created_at="2026-11-08T02:02:00.000Z")
        add("settlement_versions",id=version,
            settlement_id=sid,version_no=1,
            approval_version_id="av2",funding_version_id="fund2",
            change_type="initial",reason="本次费用部分结算",
            created_by="u",recorded_at="2026-11-08T02:03:00.000Z")
        add("settlement_item_versions",id=item_version,
            settlement_item_id=item,settlement_version_id=version,
            approval_scope_version_id="scopev2",quantity_scaled=0,
            amount_fen=settled_amount,evidence="本次独立结算依据",
            scope_snapshot_json="{}")
        add("settlement_review_events",id=f"installment_submit_{num}",
            settlement_version_id=version,event_seq=1,
            action="submit",actor_id="u",
            recorded_at="2026-11-08T02:04:00.000Z")
        add("settlement_review_events",id=f"installment_approve_{num}",
            settlement_version_id=version,event_seq=2,
            action="approve",actor_id="u",
            recorded_at="2026-11-08T02:05:00.000Z",
            effective_on="2026-11-08")
        return item,item_version

    def confirmed_partial_amount():
        return row("SELECT COALESCE(SUM(reconciled_cost_fen),0) total "
            "FROM v_cost_reconciliation_current "
            "WHERE cost_version_id='installment_cost_v1' "
            "AND status='active'")["total"]

    def reconcile_partial(num,item,item_version,amount):
        add("cost_reconciliation_versions",
            id=f"installment_reconcile_{num}",
            record_id=f"installment_reconcile_{num}",
            version_no=1,status="active",
            cost_version_id="installment_cost_v1",
            settlement_item_id=item,
            settlement_item_version_id=item_version,
            reconciled_cost_fen=amount,
            reconciled_settlement_fen=amount,
            is_final=0,evidence="本次费用结算核对凭据",
            actor_id="u",created_at="2026-11-08T02:06:00.000Z",
            request_key=f"installment_reconcile_{num}")

    ok("before any installment the full actual cost remains unsettled",
        10000-confirmed_partial_amount()==10000)
    item1,version1=installment_settlement(1,4000)
    reconcile_partial(1,item1,version1,4000)
    ok("first partial settlement leaves an outstanding cost balance",
        confirmed_partial_amount()==4000
        and 10000-confirmed_partial_amount()==6000)
    item2,version2=installment_settlement(2,6000)
    reconcile_partial(2,item2,version2,6000)
    ok("two separate installments fully reconcile one actual expense",
        confirmed_partial_amount()==10000
        and 10000-confirmed_partial_amount()==0)
    ok("two independent approved settlement documents count each actual portion",
        row("SELECT COUNT(DISTINCT settlement_id) n FROM "
            "v_effective_settlement_items "
            "WHERE settlement_id IN ('installment_st_1','installment_st_2')")
            ["n"]==2
        and row("SELECT SUM(net_amount_fen) n FROM "
            "v_effective_settlement_items WHERE settlement_id IN "
            "('installment_st_1','installment_st_2')")["n"]==10000)
    item3,version3=installment_settlement(3,1000)
    try:
        reconcile_partial(3,item3,version3,1000)
    except sqlite3.IntegrityError as error:
        ok("once actual cost is fully settled further duplicate settlement is rejected",
            "不能超过该费用自身" in str(error))
    else:
        raise AssertionError("double settlement of actual cost was accepted")
    ok("failed duplicate reconciliation leaves previous settlements unchanged",
        confirmed_partial_amount()==10000)
finally:
    db.execute("ROLLBACK TO user_confirmed_installments")
    db.execute("RELEASE user_confirmed_installments")

# Stronger late-stage operational contract: online backup contains the
# CURRENT material version and formal approvals, not merely a blank DDL.
# Two independent WAL sessions must serialize the same material's next
# version and reject a stale second writer without overwriting history.
db.commit()
with tempfile.TemporaryDirectory(prefix="schema113_versioned_backup_") as folder:
    path=Path(folder)/"schema113-real-facts.sqlite"
    original_backup=sqlite3.connect(path)
    db.backup(original_backup)
    original_backup.close()
    writer=sqlite3.connect(path,isolation_level=None,timeout=0.05)
    competing=sqlite3.connect(path,isolation_level=None,timeout=0.05)
    writer.execute("PRAGMA foreign_keys=ON")
    competing.execute("PRAGMA foreign_keys=ON")
    competing.execute("PRAGMA busy_timeout=0")
    assert writer.execute("PRAGMA journal_mode=WAL").fetchone()[0]=="wal"
    assert writer.execute("SELECT COUNT(*) FROM material_versions").fetchone()[0]>=3
    ok("online backup preserves latest PMS mapping and old exact master versions",
        writer.execute("SELECT pms_material_code FROM v_material_current "
            "WHERE id='pms_mat_a'").fetchone()[0]=="PMS-CORRECTED"
        and writer.execute("SELECT pms_material_code FROM material_versions "
            "WHERE id='pms_mat_a_v1'").fetchone()[0]=="PMS-ORIGINAL"
        and writer.execute("SELECT material_version_id FROM "
            "project_approval_material_items WHERE id='am1'").fetchone()[0]
            =="master1_v1")
    ok("online backup retains each formal partial settlement amount and schema",
        writer.execute("SELECT amount_fen FROM settlement_item_versions "
            "WHERE id='itemstv2'").fetchone()[0]==10500
        and writer.execute("PRAGMA user_version").fetchone()[0]==113)
    writer.execute("BEGIN IMMEDIATE")
    writer.execute("INSERT INTO material_versions(id,material_id,version_no,"
        "name,model,specification,status,reason,changed_by,recorded_at)"
        " VALUES(?,?,?,?,?,?,?,?,?,?)",
        ("concurrent_master1_v4","master1",4,"并发正式版", "A-改",
         "","active","单写者写入","u","2026-11-08T01:00:00.000Z"))
    try:
        competing.execute("BEGIN IMMEDIATE")
    except sqlite3.OperationalError as error:
        ok("concurrent catalog version writers respect WAL single-writer lock",
            "locked" in str(error).lower())
    else:
        raise AssertionError("second concurrent material writer obtained write lock")
    writer.execute("COMMIT")
    competing.execute("BEGIN IMMEDIATE")
    try:
        competing.execute("INSERT INTO material_versions(id,material_id,"
            "version_no,name,model,specification,status,reason,changed_by,recorded_at)"
            " VALUES(?,?,?,?,?,?,?,?,?,?)",
            ("competing_stale_material_v4","master1",4,"并发旧版",
             "A-改","","active","旧版本号","u","2026-11-08T01:01:00.000Z"))
    except sqlite3.IntegrityError as error:
        ok("stale second catalog writer cannot create a conflicting V4",
            "物资正式版本" in str(error))
    else:
        raise AssertionError("stale second material-version writer was accepted")
    finally:
        competing.execute("ROLLBACK")
    ok("WAL backup with concurrent version append keeps full FK integrity",
        writer.execute("PRAGMA integrity_check").fetchone()[0]=="ok"
        and len(writer.execute("PRAGMA foreign_key_check").fetchall())==0
        and writer.execute("SELECT COUNT(*) FROM material_versions "
            "WHERE material_id='master1' AND version_no=4").fetchone()[0]==1)
    competing.close()
    writer.close()
blocked("internal stable material code must not contain edge whitespace",
    "INSERT INTO materials(id,code,unit_id,created_at) VALUES(?,?,?,?)",
    ("bad_spaced_master","  MAT-WHITESPACE  ","unit",
     "2026-11-08T02:00:00.000Z"))
blocked("external PMS code must not contain leading or trailing whitespace",
    "INSERT INTO material_versions(id,material_id,version_no,"
    "pms_material_code,name,status,reason,changed_by,recorded_at)"
    " VALUES(?,?,?,?,?,?,?,?,?)",
    ("bad_spaced_pms","pms_mat_a",3,"  PMS-SPACED ",
     "未规范化编码","active","非法空格","u",
     "2026-11-08T02:00:00.000Z"))
blocked("external PMS code cannot be whitespace-only",
    "INSERT INTO material_versions(id,material_id,version_no,"
    "pms_material_code,name,status,reason,changed_by,recorded_at)"
    " VALUES(?,?,?,?,?,?,?,?,?)",
    ("empty_pms","pms_mat_a",3,"   ",
     "空白编码","active","非法空格","u",
     "2026-11-08T02:00:00.000Z"))
# User-approved expense tree: multiple granular fees per project, each fee can
# be settled partially in several independent approved settlement statements.
# This isolated fixture also proves that overhead need not invent a demand scope.
db.execute('SAVEPOINT hierarchical_fee_installments')
try:
    t='2026-11-08T03:00:00.000Z'
    def fee_node(node,parent,name,project='p'):
        add('project_cost_nodes',id=node,project_id=project,parent_id=parent,
            created_by='u',created_at=t)
        add('project_cost_node_versions',id=node+'_v1',node_id=node,
            version_no=1,name=name,status='active',reason='建立费用树',
            actor_id='u',recorded_at=t)
    add('project_cost_nodes',id='fee_without_definition',project_id='p',
        parent_id=None,created_by='u',created_at=t)
    blocked('fee node without its first definition cannot be used for actual cost',
        'INSERT INTO cost_entries(id,project_id,cost_node_id,created_by,created_at) '
        'VALUES(?,?,?,?,?)',('undefined_fee_cost','p','fee_without_definition','u',t))
    blocked('fee node without its first definition cannot be settled',
        'INSERT INTO settlement_items(id,settlement_id,cost_node_id,created_at) '
        'VALUES(?,?,?,?)',('undefined_fee_item','st','fee_without_definition',t))
    fee_node('fee_root',None,'实际费用')
    fee_node('fee_labor','fee_root','人工费')
    fee_node('fee_labor_work','fee_labor','安装人工费')
    fee_node('fee_material','fee_root','材料费')
    ok('project expense tree supports 3 levels and multiple fee categories',
        row('SELECT parent_id FROM project_cost_nodes WHERE id=?',
            'fee_labor_work')['parent_id']=='fee_labor'
        and row('SELECT name FROM v_project_cost_node_current WHERE id=?',
            'fee_material')['name']=='材料费')
    blocked('cost tree child cannot belong to a different project than its parent',
        'INSERT INTO project_cost_nodes(id,project_id,parent_id,created_by,created_at) '
        'VALUES(?,?,?,?,?)',('bad_foreign_child','pclose','fee_root','u',t))
    blocked('actual expense cannot be posted to a grouping-only fee node',
        'INSERT INTO cost_entries(id,project_id,cost_node_id,created_by,created_at) '
        'VALUES(?,?,?,?,?)',('bad_parent_cost','p','fee_labor','u',t))
    for ident,leaf,amount in [('fee_labor_cost','fee_labor_work',9000),
                              ('fee_material_cost','fee_material',5000)]:
        add('cost_entries',id=ident,project_id='p',cost_node_id=leaf,
            created_by='u',created_at=t)
        add('cost_versions',id=ident+'_v1',entry_id=ident,version_no=1,
            funding_version_id='fund2',status='active',category_id='expense',
            category_snapshot='人工费' if leaf=='fee_labor_work' else '材料费',
            title='已核定实际费用',occurred_on='2026-11-08',amount_fen=amount,
            evidence='实际费用确认依据',reason='实际费用入账',confirmed_by='u',
            confirmed_at=t,request_key=ident+'_v1')
    blocked('a posted fee leaf cannot silently become a grouping node',
        'INSERT INTO project_cost_nodes(id,project_id,parent_id,created_by,created_at) '
        'VALUES(?,?,?,?,?)',('bad_child_after_cost','p','fee_labor_work','u',t))
    add('project_cost_node_versions',id='fee_material_v2',
        node_id='fee_material',version_no=2,name='施工材料费',status='active',
        reason='费用名称正式更正',actor_id='u',recorded_at=t)
    ok('fee label corrections retain immutable original category definition',
        row('SELECT name FROM v_project_cost_node_current WHERE id=?',
            'fee_material')['name']=='施工材料费'
        and row('SELECT name FROM project_cost_node_versions WHERE id=?',
            'fee_material_v1')['name']=='材料费')
    blocked('published cost-tree label version cannot be overwritten',
        'UPDATE project_cost_node_versions SET name=? WHERE id=?',
        ('覆盖历史','fee_material_v1'))
    blocked('settlement cannot target a grouping-only fee node',
        'INSERT INTO settlement_items(id,settlement_id,cost_node_id,created_at) '
        'VALUES(?,?,?,?)',('bad_group_item','st','fee_labor',t))
    blocked('settlement cannot point to a cost node from another project',
        'INSERT INTO settlement_items(id,settlement_id,cost_node_id,created_at) '
        'VALUES(?,?,?,?)',('bad_project_node','st','fixture_fee_pclose',t))
    def fee_statement(n, amounts):
        sid=f'fee_doc_{n}'
        vid=f'fee_doc_{n}_v1'
        add('settlements',id=sid,project_id='p',number=f'FEE-{n}',
            created_by='u',created_at=t)
        add('settlement_versions',id=vid,settlement_id=sid,version_no=1,
            approval_version_id='av2',funding_version_id='fund2',
            change_type='initial',reason='按费用项分次结算',
            created_by='u',recorded_at=t)
        for leaf,amount in amounts.items():
            item_id=f'{sid}_{leaf}'
            item_vid=item_id+'_v1'
            add('settlement_items',id=item_id,settlement_id=sid,
                project_scope_id=None,cost_node_id=leaf,created_at=t)
            add('settlement_item_versions',id=item_vid,
                settlement_version_id=vid,settlement_item_id=item_id,
                approval_scope_version_id=None,quantity_scaled=0,
                amount_fen=amount,evidence='本期具体费用结算',scope_snapshot_json='{}')
        add('settlement_review_events',id=vid+'_submit',
            settlement_version_id=vid,event_seq=1,action='submit',
            actor_id='u',recorded_at=t)
        add('settlement_review_events',id=vid+'_approve',
            settlement_version_id=vid,event_seq=2,action='approve',
            actor_id='u',recorded_at=t,effective_on='2026-11-08')
        for leaf,amount in amounts.items():
            cost={'fee_labor_work':'fee_labor_cost',
                  'fee_material':'fee_material_cost'}[leaf]
            item_id=f'{sid}_{leaf}'
            add('cost_reconciliation_versions',
                id=item_id+'_recon',record_id=item_id+'_recon',version_no=1,
                status='active',cost_version_id=cost+'_v1',
                settlement_item_id=item_id,
                settlement_item_version_id=item_id+'_v1',
                reconciled_cost_fen=amount,reconciled_settlement_fen=amount,
                is_final=0,evidence='本期费用核对',actor_id='u',
                created_at=t,request_key=item_id+'_recon')
        return sid
    fee_statement(1,{'fee_labor_work':3000,'fee_material':2000})
    ok('one settlement can contain two different fee leaves without fake scopes',
        row('SELECT count(*) n FROM v_effective_settlement_items '
            "WHERE settlement_id='fee_doc_1'")['n']==2)
    def reconciled_amount(cost):
        return row('SELECT coalesce(sum(r.reconciled_cost_fen),0) n '
            'FROM v_cost_reconciliation_current r '
            'JOIN cost_versions v ON v.id=r.cost_version_id '
            "WHERE v.entry_id=? AND r.status='active'",cost)['n']
    ok('first installment keeps independent outstanding amounts per fee',
        reconciled_amount('fee_labor_cost')==3000
        and reconciled_amount('fee_material_cost')==2000)
    fee_statement(2,{'fee_labor_work':6000,'fee_material':1000})
    ok('second installment settles labor in full and only part of materials',
        reconciled_amount('fee_labor_cost')==9000
        and reconciled_amount('fee_material_cost')==3000)
    fee_statement(3,{'fee_material':2000})
    ok('third installment closes every leaf without cumulative statement fields',
        reconciled_amount('fee_labor_cost')==9000
        and reconciled_amount('fee_material_cost')==5000
        and row('SELECT sum(net_amount_fen) n FROM v_effective_settlement_items '
            "WHERE settlement_id LIKE 'fee_doc_%'")['n']==14000)
    # Later fee-label edits do not rewrite either actual-cost evidence or
    # an already approved settlement's frozen fee-definition reference.
    add('project_cost_node_versions',id='fee_material_v3',
        node_id='fee_material',version_no=3,name='设备材料费',status='active',
        reason='再次细化科目名称',actor_id='u',recorded_at=t)
    ok('cost and settlement snapshots pin the exact historical fee label version',
        row('SELECT name FROM v_project_cost_node_current WHERE id=?',
            'fee_material')['name']=='设备材料费'
        and row('SELECT cost_node_version_id FROM cost_versions '
            "WHERE id='fee_material_cost_v1'")['cost_node_version_id']=='fee_material_v1'
        and row('SELECT cost_node_version_id FROM settlement_item_versions '
            "WHERE id='fee_doc_1_fee_material_v1'")['cost_node_version_id']=='fee_material_v2')
    blocked('an unscoped fee node cannot be duplicated within one statement',
        'INSERT INTO settlement_items(id,settlement_id,cost_node_id,created_at) '
        'VALUES(?,?,?,?)',('duplicate_fee_item','fee_doc_3','fee_material',t))
    # The reconciliation cap applies across ALL versions of the same expense.
    add('cost_versions',id='fee_material_cost_v2',entry_id='fee_material_cost',
        version_no=2,funding_version_id='fund2',status='active',
        category_id='expense',category_snapshot='施工材料费',
        title='材料费用补录',occurred_on='2026-11-08',amount_fen=5500,
        evidence='500分补充费用确认',reason='实际费用增补',confirmed_by='u',
        confirmed_at=t,request_key='fee_material_cost_v2')
    ok('corrected actual cost can add new unsettled balance',
        row('SELECT amount_fen FROM v_cost_current '
            "WHERE entry_id='fee_material_cost'")['amount_fen']-
            reconciled_amount('fee_material_cost')==500)
    # A previous reconciliation must not reset its cap just because a newer
    # cost version exists. A genuine 500-fen new installment is still allowed.
    add('settlements',id='fee_doc_4',project_id='p',number='FEE-4',
        created_by='u',created_at=t)
    add('settlement_items',id='fee_doc_4_item',settlement_id='fee_doc_4',
        cost_node_id='fee_material',project_scope_id=None,created_at=t)
    add('settlement_versions',id='fee_doc_4_v1',settlement_id='fee_doc_4',
        version_no=1,approval_version_id='av2',funding_version_id='fund2',
        change_type='initial',reason='新增费用部分结算',created_by='u',recorded_at=t)
    add('settlement_item_versions',id='fee_doc_4_item_v1',
        settlement_version_id='fee_doc_4_v1',settlement_item_id='fee_doc_4_item',
        approval_scope_version_id=None,quantity_scaled=0,amount_fen=600,
        evidence='追加费用待结算',scope_snapshot_json='{}')
    add('settlement_review_events',id='fee_doc_4_submit',
        settlement_version_id='fee_doc_4_v1',event_seq=1,action='submit',
        actor_id='u',recorded_at=t)
    add('settlement_review_events',id='fee_doc_4_approve',
        settlement_version_id='fee_doc_4_v1',event_seq=2,action='approve',
        actor_id='u',recorded_at=t,effective_on='2026-11-08')
    # Even within the same subproject, a labor expense cannot be offset
    # against an approved materials settlement line.
    db.execute('SAVEPOINT invalid_fee_category')
    try:
        add('cost_reconciliation_versions',id='wrong_fee_category',
            record_id='wrong_fee_category',version_no=1,status='active',
            cost_version_id='fee_labor_cost_v1',
            settlement_item_id='fee_doc_4_item',
            settlement_item_version_id='fee_doc_4_item_v1',
            reconciled_cost_fen=1,reconciled_settlement_fen=1,is_final=0,
            evidence='错误费用科目',actor_id='u',created_at=t,
            request_key='wrong_fee_category')
    except sqlite3.IntegrityError as error:
        ok('reconciliation rejects matching project but different fee leaf',
            '费用核对必须匹配' in str(error))
    else:
        raise AssertionError('cross-fee reconciliation was accepted')
    finally:
        db.execute('ROLLBACK TO invalid_fee_category')
        db.execute('RELEASE invalid_fee_category')
    blocked('later cost revision cannot reset previously settled cost balance',
        'INSERT INTO cost_reconciliation_versions(id,record_id,version_no,status,'
        'cost_version_id,settlement_item_id,settlement_item_version_id,'
        'reconciled_cost_fen,reconciled_settlement_fen,is_final,evidence,'
        'actor_id,created_at,request_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ('fee_overpay','fee_overpay',1,'active','fee_material_cost_v2',
         'fee_doc_4_item','fee_doc_4_item_v1',600,600,0,'错误重复结算','u',
         t,'fee_overpay'))
    # A newer APPROVED full-statement revision supersedes earlier allocations.
    # Old reconciliation history remains inspectable but is not net settlement.
    add('settlement_versions',id='fee_doc_3_v2',settlement_id='fee_doc_3',
        version_no=2,previous_version_id='fee_doc_3_v1',
        approval_version_id='av2',funding_version_id='fund2',
        change_type='revision',reason='材料费结算金额复核修正',
        created_by='u',recorded_at=t)
    add('settlement_item_versions',id='fee_doc_3_fee_material_v2',
        settlement_version_id='fee_doc_3_v2',
        settlement_item_id='fee_doc_3_fee_material',
        approval_scope_version_id=None,quantity_scaled=0,
        amount_fen=1500,evidence='材料费更正后的本期金额',
        scope_snapshot_json='{}')
    add('settlement_review_events',id='fee_doc_3_v2_submit',
        settlement_version_id='fee_doc_3_v2',event_seq=1,
        action='submit',actor_id='u',recorded_at=t)
    add('settlement_review_events',id='fee_doc_3_v2_approve',
        settlement_version_id='fee_doc_3_v2',event_seq=2,
        action='approve',actor_id='u',recorded_at=t,
        effective_on='2026-11-08')
    def effective_applied(cost):
        return row('SELECT coalesce(sum(r.reconciled_cost_fen),0) n '
            'FROM v_effective_cost_reconciliations r WHERE r.entry_id=?',
            cost)['n']
    ok('superseded settlement revision drops old cost application from effective sum',
        effective_applied('fee_material_cost')==3000
        and reconciled_amount('fee_material_cost')==5000
        and row('SELECT net_amount_fen n FROM v_effective_settlement_items '
            "WHERE settlement_id='fee_doc_3'")['n']==1500)
    blocked('a superseded historic settlement line cannot receive new reconciliation',
        'INSERT INTO cost_reconciliation_versions(id,record_id,version_no,status,'
        'cost_version_id,settlement_item_id,settlement_item_version_id,'
        'reconciled_cost_fen,reconciled_settlement_fen,is_final,evidence,'
        'actor_id,created_at,request_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ('old_item_new_recon','old_item_new_recon',1,'active',
         'fee_material_cost_v2','fee_doc_3_fee_material',
         'fee_doc_3_fee_material_v1',200,200,0,'已失效单据','u',t,
         'old_item_new_recon'))
    add('cost_reconciliation_versions',id='revised_fee_doc_3_recon',
        record_id='revised_fee_doc_3_recon',version_no=1,status='active',
        cost_version_id='fee_material_cost_v2',
        settlement_item_id='fee_doc_3_fee_material',
        settlement_item_version_id='fee_doc_3_fee_material_v2',
        reconciled_cost_fen=1500,reconciled_settlement_fen=1500,
        is_final=0,evidence='当前正式版材料费复核',actor_id='u',
        created_at=t,request_key='revised_fee_doc_3_recon')
    ok('new formally approved statement amount is separately reconciled',
        effective_applied('fee_material_cost')==4500
        and 5500-effective_applied('fee_material_cost')==1000)
    # A later true-cost reduction may be smaller than the already reviewed
    # portions. Recording the correction is valid; automatic deletion or
    # reinterpretation of historical approved settlements is NOT.
    add('cost_versions',id='fee_material_cost_v3',
        entry_id='fee_material_cost',version_no=3,
        funding_version_id='fund2',status='active',
        category_id='expense',category_snapshot='材料费',
        title='材料退补后的最终实际费用',occurred_on='2026-11-08',
        amount_fen=4000,evidence='实际材料费用正式核减1500分',
        reason='更正应结金额',confirmed_by='u',
        confirmed_at=t,request_key='fee_material_cost_v3')
    ok('downward cost correction retains authentic over-reconciled exception',
        row('SELECT amount_fen FROM v_cost_current '
            "WHERE entry_id='fee_material_cost'")['amount_fen']==4000
        and effective_applied('fee_material_cost')==4500
        and row('SELECT COUNT(*) n FROM v_cost_reconciliation_current '
            "WHERE record_id='fee_doc_1_fee_material_recon'")['n']==1)
    blocked('cannot add more active reconciliation to an already over-matched cost',
        'INSERT INTO cost_reconciliation_versions(id,record_id,version_no,'
        'status,cost_version_id,settlement_item_id,settlement_item_version_id,'
        'reconciled_cost_fen,reconciled_settlement_fen,is_final,evidence,'
        'actor_id,created_at,request_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ('after_downward_overpay','after_downward_overpay',1,'active',
         'fee_material_cost_v3','fee_doc_4_item','fee_doc_4_item_v1',
         100,100,0,'不可再次核对超支历史','u',t,
         'after_downward_overpay'))
finally:
    db.execute('ROLLBACK TO hierarchical_fee_installments')
    db.execute('RELEASE hierarchical_fee_installments')

ok("current SQLite integrity",row("PRAGMA integrity_check")[0]=="ok")
ok("current SQLite FK integrity",not db.execute("PRAGMA foreign_key_check").fetchall())
print(f"\\n{len(checks)} database design contract checks passed. "
      "No production database or application files were used.")
