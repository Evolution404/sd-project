#!/usr/bin/env python3
"""Isolated SQLite design-contract tests for the Schema 113 candidate.

No application code, user database, frontend or network access.
Usage: python3 -B docs/architecture/schema113_database_acceptance.py
"""
from __future__ import annotations
import json
import sqlite3
import tempfile
from pathlib import Path

schema = Path(__file__).resolve().parents[2]/"server/database/schema/schema113.sql"
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
            name=data["name"],
            model=data.get("model",""),specification=data.get("specification",""),
            category_id=data.get("category_id"),status=data.get("status","active"),
            note=data.get("note",""),reason="首次登记",
            changed_by=data.get("created_by") or "u",
            recorded_at=data.get("updated_at") or data["created_at"])
        return
    if t=="organizational_units":
        # Test-only atomic organization root/V1 seed, like material master.
        insert_raw('organizational_units',id=data['id'],code=data['code'])
        insert_raw('organizational_unit_versions',
            id=data['id']+'_v1',unit_id=data['id'],version_no=1,
            name=data['name'],parent_unit_id=data.get('parent_id'),
            status=data.get('status','active'),reason='组织首次建档',
            actor_id=data.get('actor_id','u'),
            recorded_at=data.get('recorded_at','2026-11-07T00:00:00.000Z'))
        return
    if t=="projects":
        # Test-fixture convenience ONLY: project root and V1 complete immutable
        # profile are written together; production uses one BEGIN IMMEDIATE txn.
        name=data.pop('name')
        category_id=data.pop('category_id',None)
        data.pop('updated_at',None)  # phase timestamp is derived from stage events
        insert_raw('projects',**data)
        category_version=None
        if category_id is not None:
            category_version=db.execute(
                'SELECT MAX(version) FROM dictionary_item_versions WHERE item_id=?',
                (category_id,)).fetchone()[0]
        insert_raw('project_management_versions',
            id='project_profile_'+data['id']+'_v1',
            project_id=data['id'],version_no=1,name=name,
            category_id=category_id,category_version=category_version,
            reason='项目首次建档',actor_id=data.get('created_by','u'),
            recorded_at=data['created_at'])
        return
    if (t=="project_management_versions" and
        'managing_unit_id' in data and
        'managing_unit_version_id' not in data):
        unit_id=data['managing_unit_id']
        data['managing_unit_version_id']=(
            db.execute('SELECT unit_version_id FROM v_organizational_unit_current '
                       'WHERE id=?',(unit_id,)).fetchone()[0] if unit_id else None)
    if t=="project_management_versions":
        # A full historical profile retains all unchanged metadata even
        # if only the project name OR only its category was updated.
        current=db.execute('SELECT name,category_id,category_version '
            'FROM v_project_management_current WHERE project_id=?',
            (data['project_id'],)).fetchone()
        assert current is not None,data['project_id']
        for key in ('name','category_id','category_version'):
            data.setdefault(key,current[key])
    if t=="project_approval_material_items" and "material_version_id" not in data:
        material_id=db.execute("SELECT material_id FROM project_scope_materials "
            "WHERE id=?",(data["project_material_id"],)).fetchone()[0]
        data["material_version_id"]=db.execute(
            "SELECT material_version_id FROM v_material_current WHERE id=?",
            (material_id,)).fetchone()[0]
    if t=='project_demand_scopes':
        # Test-only: the project scope's true linker is required by SQL.
        # All fixtures created by the "u" admin explicitly remain that actor.
        data.setdefault('created_by','u')
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
    if t=="settlement_scope_results" and "location_item_no" not in data:
        # Legacy one-position acceptance fixtures: use the actual approved
        # position, never infer this value in the production service.
        locations=db.execute(
            "SELECT location_item_no FROM project_approval_work_locations "
            "WHERE approval_scope_version_id=?",
            (data["approval_scope_version_id"],)).fetchall()
        assert len(locations)==1, "fixture requires one unambiguous approved position"
        data["location_item_no"]=locations[0]["location_item_no"]
    if t=="settlement_review_events" and data.get("action")=="submit":
        # TEST FIXTURE ONLY: existing full-accounting fixtures predating
        # settlement_scope_results already had approved project demand scopes,
        # but recorded only billed fee items, not independent actual resolved
        # work. Seed exact scope results before formal submit for legacy fixture
        # setups. Production MUST receive actual resolved quantities from the
        # user, not infer them from price rows or approval quantities.
        ver=data["settlement_version_id"]
        is_void=db.execute(
            "SELECT change_type FROM settlement_versions WHERE id=?",
            (ver,)).fetchone()
        if is_void and is_void[0]!="void":
            scopes=db.execute(
                "SELECT DISTINCT i.project_scope_id AS scope_id, "
                "a.id AS approval_scope_id "
                "FROM settlement_item_versions iv "
                "JOIN settlement_items i ON i.id=iv.settlement_item_id "
                "JOIN settlement_versions v ON v.id=iv.settlement_version_id "
                "JOIN project_approval_scope_versions a ON "
                "a.project_scope_id=i.project_scope_id AND "
                "a.approval_version_id=v.approval_version_id "
                "WHERE v.id=? AND i.project_scope_id IS NOT NULL "
                "ORDER BY i.project_scope_id",(ver,)).fetchall()
            if not scopes:
                scopes=db.execute(
                    "SELECT a.project_scope_id AS scope_id, "
                    "a.id AS approval_scope_id "
                    "FROM project_approval_scope_versions a "
                    "JOIN settlement_versions v ON "
                    "v.approval_version_id=a.approval_version_id "
                    "WHERE v.id=? ORDER BY a.project_scope_id LIMIT 1",
                    (ver,)).fetchall()
            for i,scope in enumerate(scopes):
                positions=db.execute(
                    "SELECT location_item_no FROM project_approval_work_locations "
                    "WHERE approval_scope_version_id=? ORDER BY location_item_no",
                    (scope["approval_scope_id"],)).fetchall()
                for position in positions:
                    number=position["location_item_no"]
                    if not db.execute(
                        "SELECT 1 FROM settlement_scope_results "
                        "WHERE settlement_version_id=? AND project_scope_id=? "
                        "AND location_item_no=?",
                        (ver,scope["scope_id"],number)).fetchone():
                        insert_raw("settlement_scope_results",
                            id=f"fixture_scope_result_{ver}_{i}_{number}",
                            settlement_version_id=ver,
                            project_scope_id=scope["scope_id"],
                            approval_scope_version_id=scope["approval_scope_id"],
                            location_item_no=number,
                            resolved_quantity_scaled=10000,
                            evidence="仅测试样本的需求解决事实")
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
        ("name","model","specification","category_id","status","note")}
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

def blocked_reason(label, sql, expected_message, args=()):
    """Prove a specific guard blocked the write, not some unrelated FK."""
    db.execute('SAVEPOINT invalid_reason')
    try:
        db.execute(sql,args)
    except sqlite3.IntegrityError as error:
        ok(label,expected_message in str(error))
    else:
        raise AssertionError('Expected domain-specific reject: '+label)
    finally:
        db.execute('ROLLBACK TO invalid_reason')
        db.execute('RELEASE invalid_reason')

def approval(id, no, budget, change_id=None, status="draft", candidates=()):
    assert status=="draft"
    add("project_approval_versions", id=id, project_id="p",
        version_no=no,change_order_id=change_id,
        snapshot_json=json.dumps({"candidate_scopes":[{"demand_id":did} for did in candidates]}),
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
        object_position="body",attribution_unit="logical_tower",
        operation_id="op",operation_version=1,
        operation_snapshot="更换",work_object_id="obj",work_object_snapshot="绝缘子",
        target_object="A相",quantity_scaled=10000,unit_id="unit",
        unit_version=1,unit_snapshot="套",completion_standard="合格",
        problem_description="隐患",expected_on="2027-06-30",
        created_by="u",created_at="2026-11-07T00:00:00.000Z")

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
    add("settlement_versions",id=name,mode="itemized",amount_fen=amount,settlement_id="st",
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

add("users",id="u",username="admin",display_name="admin",role="admin",
    created_at="2026-11-07T00:00:00.000Z",updated_at="2026-11-07T00:00:00.000Z")
add("user_credentials",user_id="u",password_hash="x",
    changed_at="2026-11-07T00:00:00.000Z")
add("user_roles",user_id="u",role_code="admin",assigned_at="2026-11-07T00:00:00.000Z")
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
    name="绝缘子",object_position="body",attribution_unit="logical_tower",
    status="active",reason="首次发布",
    changed_by="u",recorded_at="2026-11-07T00:00:00.000Z")
add("operations",id="op",code="OP",created_at="2026-11-07T00:00:00.000Z")
add("operation_versions",id="ov",operation_id="op",version=1,
    name="更换",status="active",
    work_object_id="obj",work_object_version_no=1,
    default_unit_id="unit",default_unit_version=1,reason="首次定义",
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
add("project_demand_scopes",id="scope",project_id="p",demand_id="d",
    demand_version=1,proposed_quantity_scaled=10000,proposed_amount_fen=5000,
    created_at="2026-11-07T00:00:00.000Z",updated_at="2026-11-07T00:00:00.000Z")
approval("av1",1,5000)
blocked("incomplete approval cannot finalize",
    "UPDATE project_approval_versions SET status='approved',"
    "approved_by='u',approved_at='2026-11-07T00:00:00.000Z' WHERE id='av1'")
add("project_approval_scope_versions",id="scopev1",approval_version_id="av1",
    project_scope_id="scope",demand_id="d",demand_version=1,quantity_scaled=10000,
    approved_amount_fen=5000,snapshot_json="{}",created_at="2026-11-07T00:00:00.000Z")
add("project_scope_materials",id="mat",project_scope_id="scope",
    material_id="master1",created_at="2026-11-07T00:00:00.000Z")
add("project_approval_material_items",id="am1",approval_version_id="av1",
    project_scope_id="scope",project_material_id="mat",item_no=1,
    material_code_snapshot="MAT-001",material_name="绝缘子",
    material_model="A",approved_quantity_scaled=1000,
    unit_id="unit",unit_version=1,unit_snapshot="套")
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
    "material_code_snapshot,material_name,material_model,approved_quantity_scaled,unit_id,unit_version,unit_snapshot)"
    " VALUES('x','av1','scope','mat',2,'MAT-001','绝缘子','A',1,'unit',1,'套')")
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
    project_scope_id="scope",demand_id="d",demand_version=1,quantity_scaled=10000,
    approved_amount_fen=4000,snapshot_json="{}",created_at="2026-11-07T00:00:00.000Z")
add("project_approval_material_items",id="am2",approval_version_id="av2",
    project_scope_id="scope",project_material_id="mat",item_no=1,
    material_code_snapshot="MAT-001",material_name="绝缘子",
    material_model="A",approved_quantity_scaled=3000,
    unit_id="unit",unit_version=1,unit_snapshot="套")
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
    ==(10000,4000,8000))
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
approval("av3",3,20000,"chg2",candidates=("d2",))
blocked("incomplete later approval cannot hide current scope",
    "UPDATE project_approval_versions SET status='approved',"
    "approved_by='u',approved_at='2026-11-07T00:00:00.000Z' WHERE id='av3'")
ok("draft V3 does not mask officially approved V2",
    row("SELECT approved_budget_fen FROM v_project_current_approval "
        "WHERE project_id='p'")["approved_budget_fen"]==7000)
# New settlement version submitted but not yet approved does not change net.
add("settlement_versions",id="stv2",mode="itemized",amount_fen=10500,settlement_id="st",version_no=2,
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
# Scope removal is an early release and must fail until the original project
# formally closes. The next approved version retains every prior demand identity.
demand("d2")
activate_demand("d2")
add("project_demand_scopes",id="scope2",project_id="p",demand_id="d2",
    demand_version=1,proposed_quantity_scaled=10000,proposed_amount_fen=1000,
    created_at="2026-11-07T00:00:00.000Z",updated_at="2026-11-07T00:00:00.000Z")
add("project_approval_scope_versions",id="scopev3",approval_version_id="av3",
    project_scope_id="scope2",demand_id="d2",demand_version=1,quantity_scaled=10000,
    approved_amount_fen=1000,snapshot_json="{}",created_at="2026-11-07T00:00:00.000Z")
blocked("approved active project cannot remove scope before closure",
    "UPDATE project_approval_versions SET status='approved',"
    "approved_by='u',approved_at='2026-11-07T00:00:00.000Z' WHERE id='av3'")
add("project_approval_scope_versions",id="scopev3_original",approval_version_id="av3",
    project_scope_id="scope",demand_id="d",demand_version=1,quantity_scaled=10000,
    approved_amount_fen=4000,snapshot_json="{}",created_at="2026-11-07T00:00:00.000Z")
approve("av3")
ok("new approved version retains prior scope and adopts new demand",
    row("SELECT COUNT(*) n FROM v_approval_scope_current a "
        "JOIN project_approval_versions ap ON ap.id=a.approval_version_id "
        "WHERE ap.project_id='p'")["n"]==2
    and row("SELECT COUNT(*) n FROM v_approval_scope_current a "
        "JOIN project_approval_versions ap ON ap.id=a.approval_version_id "
        "WHERE ap.project_id='p' AND a.project_scope_id='scope'")["n"]==1)
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
blocked_reason("another project cannot even reserve an already linked demand",
    "INSERT INTO project_demand_scopes(id,project_id,demand_id,demand_version,"
    "proposed_quantity_scaled,created_by,created_at,updated_at)"
    " VALUES(?,?,?,?,?,?,?,?)",
    "需求已关联其他子项目，须先由原子项目显式解绑",
    ("invalid_other_scope","p_other","d",1,10000,"u",
     "2026-11-07T00:00:00.000Z","2026-11-07T00:00:00.000Z"))
demand("d_other")
activate_demand("d_other")
add("project_demand_scopes",id="other_scope",project_id="p_other",
    demand_id="d_other",demand_version=1,proposed_quantity_scaled=10000,
    proposed_amount_fen=500,created_at="2026-11-07T00:00:00.000Z",
    updated_at="2026-11-07T00:00:00.000Z")
blocked("un-stocked project cannot compile initial approval draft",
    "INSERT INTO project_approval_versions(id,project_id,version_no,approved_budget_fen,snapshot_json,created_at) "
    "VALUES('other_av','p_other',1,500,'{}','2026-11-07T00:00:00.000Z')")
stage("p_other","stocked")
add("project_approval_versions",id="other_av",project_id="p_other",
    version_no=1,approved_budget_fen=500,snapshot_json="{}",
    created_at="2026-11-07T00:00:00.000Z")
add("project_approval_scope_versions",id="other_ap_scope",
    approval_version_id="other_av",project_scope_id="other_scope",
    demand_id="d_other",demand_version=1,quantity_scaled=10000,
    approved_amount_fen=500,snapshot_json="{}",
    created_at="2026-11-07T00:00:00.000Z")
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
add("materials",id="no_reason_master",code="MAT-OPTIONAL",
    name="现场新增材料不写说明",unit_id="unit",
    created_at="2026-11-07T00:00:00.000Z")
add("project_scope_materials",id="unexplained_material",
    project_scope_id="scope",material_id="no_reason_master",
    created_at="2026-11-07T00:00:00.000Z")
ok("admin may add a real unplanned material with no explanatory reason",
    row("SELECT addition_reason FROM project_scope_materials "
        "WHERE id='unexplained_material'")["addition_reason"]=="")
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
add("project_demand_scopes",id="s3",project_id="p3",demand_id="d3",
    demand_version=1,proposed_quantity_scaled=10000,proposed_amount_fen=2000,
    created_at="2026-11-07T00:00:00.000Z",updated_at="2026-11-07T00:00:00.000Z")
add("project_approval_versions",id="avp3",project_id="p3",version_no=1,
    approved_budget_fen=2000,snapshot_json="{}",created_at="2026-11-07T00:00:00.000Z")
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
    unit_id="unit",unit_version=1,unit_snapshot="组")
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
    funding_version_id="fund2",status="active",title="真实发生的费用",
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

# Correct only the amount guard with a valid historic scope and funding fact.
audit_cost_node = row("SELECT cost_node_version_id FROM cost_versions WHERE id='audit_cv'")["cost_node_version_id"]
cost_revision_insert = (
    "INSERT INTO cost_versions(id,entry_id,cost_node_version_id,funding_version_id,"
    "version_no,status,title,occurred_on,amount_fen,evidence,reason,confirmed_by,"
    "confirmed_at,request_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
blocked("actual cost correction below its applied reconciliation is rejected",
    cost_revision_insert,
    ("audit_cv_low","audit_ce",audit_cost_node,"fund2",2,"active","金额下调",
     "2026-11-07",9500,"依据","更正","u","2026-11-07T16:00:00.000Z","audit_cv_low"))

# Existing cost's historical funding identity may not be silently nulled.
blocked("funded actual expense correction cannot erase historical agreement",
    cost_revision_insert,
    ("audit_cv_bad2","audit_ce",audit_cost_node,None,2,"active","费用复核",
     "2026-11-07",10500,"依据","更正","u","2026-11-07T16:00:00.000Z","audit_cv_bad2"))
add("cost_versions",id="audit_cv2",entry_id="audit_ce",
    version_no=2,funding_version_id="fund2",status="active",
    title="真实费用更正",occurred_on="2026-11-07",amount_fen=10500,
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
    approved_quantity_scaled=2000,unit_id="unit",unit_version=1,unit_snapshot="组")
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
stage("pclose","approved",time="2026-11-07T10:00:00.000Z")
add("settlements",id="stclose",project_id="pclose",number="SCLOSE",
    created_by="u",created_at="2026-11-07T10:00:00.000Z")
add("settlement_items",id="itclose",settlement_id="stclose",
    project_scope_id="sclose",created_at="2026-11-07T10:00:00.000Z")
add("settlement_versions",id="vclose",mode="itemized",amount_fen=1000,settlement_id="stclose",
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
    version_no=1,status="active",title="结项实际费用",
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
stage("pclose","closed",time="2026-11-07T12:01:00.000Z")
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
blocked("closed project rejects late ordinary actual cost identity",
    "INSERT INTO cost_entries(id,project_id,cost_node_id,created_by,created_at) "
    "VALUES('cost_after_close','pclose','fixture_fee_pclose','u','2026-11-08T10:00:00.000Z')")
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
    "line_kind,setup_status,actor_id,reason,recorded_at) "
    "VALUES('line',3,'假版本','vol','active','main','ready','u','伪造',"
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
add("users",id="view_governance",username="read-only",display_name="read-only",
    role="viewer",created_at="2026-11-07T17:00:00.000Z",
    updated_at="2026-11-07T17:00:00.000Z")
add("user_credentials",user_id="view_governance",password_hash="x",
    changed_at="2026-11-07T17:00:00.000Z")
add("user_roles",user_id="view_governance",role_code="viewer",
    assigned_at="2026-11-07T17:00:00.000Z")
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
blocked("second project draft cannot substitute an independently claimed demand",
    "UPDATE project_approval_scope_versions SET demand_id='d' WHERE id='other_ap_scope'")

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
stage("pnull","approved",time="2026-11-07T18:00:00.000Z")
ok("unknown approved scope amount stays NULL, independent of proposed amount",
    row("SELECT approved_amount_fen FROM v_approval_scope_current "
        "WHERE project_scope_id='snull'")["approved_amount_fen"] is None
    and row("SELECT proposed_amount_fen FROM project_demand_scopes "
        "WHERE id='snull'")["proposed_amount_fen"]==5000)
blocked_reason("approved demand cannot be unlinked before formal project scope change",
    "INSERT INTO project_demand_link_events("
    "id,project_scope_id,event_seq,action,actor_id,recorded_at)"
    " VALUES(?,?,?,?,?,?)",
    "最新版正式批准范围仍包含需求；只允许未完成需求在项目正式结项后释放",
    ("illegal_approved_release","snull",2,"released","u",
     "2026-11-07T18:20:00.000Z"))
add("project_closures",id="close_null",project_id="pnull",
    approval_version_id="avnull",reason="结项前审核",
    close_snapshot_json="{}",closed_by="u",
    closed_at="2026-11-07T18:30:00.000Z")
stage("pnull","closed",time="2026-11-07T18:32:00.000Z")
ok("project with no cost or settlement may close without fictional work completion",
    row("SELECT status FROM projects WHERE id='pnull'")["status"]=="closed")
# Formally closed project releases ONLY the unfinished demand, preserving
# its original scope, approval and immutable history.
add("project_demand_link_events",id="close_null_release",
    project_scope_id="snull",event_seq=2,action="released",
    actor_id="u",recorded_at="2026-11-07T18:33:00.000Z",
    reason="正式结项后释放未完成需求")
ok("closure release preserves historic project approval and removes current owner",
    row("SELECT COUNT(*) n FROM v_project_demand_binding_current "
        "WHERE demand_id='dnull'")["n"]==0
    and row("SELECT COUNT(*) n FROM project_approval_scope_versions "
            "WHERE project_scope_id='snull'")["n"]==1)
add("projects",id="pnext",code="PNEXT",name="续建项目",
    framework_id="f",created_by="u",created_at="2026-11-07T18:35:00.000Z")
add("project_demand_scopes",id="snext",project_id="pnext",
    demand_id="dnull",demand_version=1,proposed_quantity_scaled=10000,
    created_by="u",created_at="2026-11-07T18:35:00.000Z",
    updated_at="2026-11-07T18:35:00.000Z")
ok("follow-on project adopts same original demand after formal closure",
    row("SELECT project_id FROM v_project_demand_binding_current "
        "WHERE demand_id='dnull'")["project_id"]=="pnext")


# Money cannot point to funding recorded after its own ledger event.
add("settlements",id="st_future",project_id="p",number="FUND-TIME",
    created_by="u",created_at="2026-11-07T13:00:00.000Z")
blocked("settlement cannot use a future funding association version",
    "INSERT INTO settlement_versions(id,settlement_id,version_no,"
    "approval_version_id,funding_version_id,change_type,reason,mode,amount_fen,"
    "created_by,recorded_at) VALUES('futurev','st_future',1,'av3',"
    "'fund3','initial','穿越资金归属','project_total',100,'u',"
    "'2026-11-07T13:00:00.000Z')")

# Model metadata, organization hierarchy and source provenance are typed,
# without duplicating current values inside projects and external_ref.
add("organizational_units",id="ou",code="T-OPS",name="输电运检中心")
add("organizational_units",id="childou",code="T-OPS-1",
    name="输电班组",parent_id="ou")
blocked_reason("organization units cannot be their own ancestors",
    "INSERT INTO organizational_unit_versions(id,unit_id,version_no,name,"
    "parent_unit_id,status,reason,actor_id,recorded_at)"
    " VALUES('ou_bad_cycle','ou',2,'输电运检中心','childou','active',"
    "'非法倒挂','u','2026-11-07T00:00:01.000Z')",
    "组织单位层级历史不能建立当前父子循环")
add("project_management_versions",id="mgt1",project_id="p",
    version_no=2,owner_id="u",manager_id="u",managing_unit_id="ou",
    planned_start_on="2026-11-08",planned_end_on="2026-11-30",
    preliminary_estimate_fen=7000,preliminary_estimate_basis="初步估算",
    reason="首次计划",actor_id="u",recorded_at="2026-11-07T18:00:00.000Z")
add("project_management_versions",id="mgt2",project_id="p",
    version_no=3,owner_id="u",manager_id="u",managing_unit_id="ou",
    planned_start_on="2026-11-08",planned_end_on="2026-12-31",
    preliminary_estimate_fen=8000,preliminary_estimate_basis="范围核定后估算",
    reason="调整目标时间",actor_id="u",recorded_at="2026-11-07T19:00:00.000Z")
ok("responsibility and schedule are separate historical project facts",
    row("SELECT version_no,planned_end_on FROM v_project_management_current "
       "WHERE project_id='p'")["version_no"]==3
    and row("SELECT planned_end_on FROM project_management_versions "
       "WHERE id='mgt1'")["planned_end_on"]=="2026-11-30")
blocked("project management history cannot be overwritten",
    "UPDATE project_management_versions SET planned_end_on='2027-01-01' "
    "WHERE id='mgt1'")
add("source_records",id="clean_source",source_system="excel",
    external_record_id="CLEAN-DEV-100",
    description="一次性清洗导入的原始依据",created_by="u",
    created_at="2026-11-07T18:00:00.000Z")
blocked("one cleaned import source ID cannot be duplicated",
    "INSERT INTO source_records(id,source_system,external_record_id,"
    "description,created_by,created_at) VALUES('duplicate_source','excel',"
    "'CLEAN-DEV-100','重复','u','2026-11-07T18:01:00.000Z')")
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
    "proposed_unit_price_fen","created_by"}<=scope_columns
   and "proposal_status" not in scope_columns
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
ok("tax metadata is absent from the Schema113 business model", all(not {"tax_mode","tax_rate_basis_points"} & {r["name"] for r in db.execute("PRAGMA table_xinfo("+t+")")} for t in ("cost_versions","settlement_item_versions","reference_price_versions","project_demand_scopes")))

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
add("project_demand_scopes",id="s_pending",project_id="p_pending",
    demand_id="pending_gov",demand_version=1,
    proposed_quantity_scaled=10000,proposed_amount_fen=900,
    created_at="2026-11-07T21:01:00.000Z",
    updated_at="2026-11-07T21:01:00.000Z")
add("project_approval_versions",id="a_pending",project_id="p_pending",
    version_no=1,snapshot_json="{}",approved_budget_fen=900,
    created_at="2026-11-07T21:01:00.000Z")
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
                  {"attribution_unit":"physical_tower"})
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
    version_no=1,funding_version_id="fund2",status="active",title="另一笔实际费用",
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
add("demand_sources",demand_id="d",source_id="clean_source")
blocked("used raw source description cannot change without new source evidence",
    "UPDATE source_records SET description='篡改来源' WHERE id='clean_source'")
blocked("used raw source record cannot be deleted",
    "DELETE FROM source_records WHERE id='clean_source'")
blocked("confirmed demand cannot erase its original source association",
    "DELETE FROM demand_sources WHERE demand_id='d' AND source_id='clean_source'")
blocked("demand source may not be silently changed to another source",
    "UPDATE demand_sources SET source_id='missing' WHERE demand_id='d'")
add("demand_batches",id="batch_used",source_id="clean_source",
    status="submitted",draft_json="[]",created_by="u",
    created_at="2026-11-07T23:30:00.000Z",
    updated_at="2026-11-07T23:30:00.000Z")
blocked("submitted batch cannot silently replace origin source",
    "UPDATE demand_batches SET source_id=NULL WHERE id='batch_used'")
demand("imported_from_batch",batch_id="batch_used")
add("batch_demand_sources",batch_id="batch_used",
    demand_id="imported_from_batch",source_id="clean_source")
ok("raw import provenance remains a separate immutable assertion",
    row("SELECT COUNT(*) n FROM batch_demand_sources "
        "WHERE batch_id='batch_used' AND demand_id='imported_from_batch'")["n"]==1)
add("demand_batches",id="other_batch",source_id="clean_source",
    status="submitted",draft_json="[]",created_by="u",
    created_at="2026-11-07T23:30:00.000Z",
    updated_at="2026-11-07T23:30:00.000Z")
blocked("import provenance cannot claim an unrelated batch",
    "INSERT INTO batch_demand_sources(batch_id,demand_id,source_id) "
    "VALUES('other_batch','imported_from_batch','clean_source')")
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
    source_id="clean_source",created_by="u",
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
    row("SELECT COUNT(*) n FROM evidence_links WHERE id LIKE 'ev_%'")["n"]==8)
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
ok("no independent preapproval allocation table, projection or evidence FK",
    all(row("SELECT count(*) n FROM sqlite_master WHERE type='table' "
            "AND name=?",name)["n"]==0
        for name in ("cost_allocations","cost_allocation_versions"))
    and row("SELECT count(*) n FROM sqlite_master WHERE type='view' "
            "AND name='v_cost_allocation_current'")["n"]==0
    and not any(x["name"]=="cost_allocation_version_id"
                for x in db.execute("PRAGMA table_info(evidence_links)"))
    and not any(x["table"]=="cost_allocation_versions"
                for x in db.execute("PRAGMA foreign_key_list(evidence_links)")))
ok("only canonical effective-business-fact views remain",
    len(present)==28
    and {'v_demand_current_location_progress','v_demand_reference_quote_current',
         'v_project_approval_reference_basis_current',
         'v_project_demand_binding_current','v_effective_demand_resolutions',
         'v_organizational_unit_current','v_approval_scope_current',
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
ok("project closeout does not force 100-percent costs or demands",
    'v_effective_cost_reconciliations' not in closure_ddl
    and 'v_effective_settlement_items' not in closure_ddl
    and 'v_completion_current' not in closure_ddl
    and 'v_scope_progress' not in closure_ddl
    and 'v_settlement_workflow' not in closure_ddl)
# Actual expenses are project facts, NOT settlement documents. They must
# be accepted before a project even has a settlement number; later settlement
# reconciliation must match the same project and approved fee leaf.
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
blocked("independent cost cannot reconcile another project's settlement item",
    "INSERT INTO cost_reconciliation_versions(id,record_id,version_no,status,"
    "cost_version_id,settlement_item_id,settlement_item_version_id,"
    "reconciled_cost_fen,reconciled_settlement_fen,is_final,evidence,"
    "actor_id,created_at,request_key) VALUES('cross_project_reconcile',"
    "'cross_project_reconcile',1,'active','independent_project_cost_v1',"
    "'it','itemstv2',500,500,0,'真实凭据','u',"
    "'2026-11-07T20:04:00.000Z','cross_project_reconcile')")
ok("independent real costs keep their latest historical amount without duplicate writes",
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
    unit_id="unit",unit_version=1,unit_snapshot="套")
db.execute("UPDATE project_approval_versions SET status='approved',"
    "approved_by='u',approved_at='2026-11-07T20:33:00.000Z'"
    " WHERE id='end_to_end_ap'")
stage("end_to_end_p","approved",time="2026-11-07T20:34:00.000Z")
add("cost_entries",id="end_to_end_cost",project_id="end_to_end_p",
    created_by="u",created_at="2026-11-07T20:37:00.000Z")
add("cost_versions",id="end_to_end_cv",entry_id="end_to_end_cost",
    version_no=1,status="active",title="现场实际费用",occurred_on="2026-11-07",
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
add("settlement_versions",id="end_to_end_sv",mode="itemized",amount_fen=3000,
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
    version_no=2,status="active",title="现场实际费用追加",
    occurred_on="2026-11-07",amount_fen=3500,
    evidence="新增实际费用500分",reason="实际费用正式补录",
    confirmed_by="u",confirmed_at="2026-11-07T20:44:05.000Z",
    request_key="end_to_end_cv_v2")
add("settlements",id="end_to_end_st2",project_id="end_to_end_p",
    number="E2E-S2",created_by="u",created_at="2026-11-07T20:44:10.000Z")
add("settlement_items",id="end_to_end_item2",
    settlement_id="end_to_end_st2",project_scope_id="end_to_end_scope",
    created_at="2026-11-07T20:44:11.000Z")
add("settlement_versions",id="end_to_end_sv2",mode="itemized",amount_fen=500,
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
add("settlement_versions",id="end_to_end_sv_revision",mode="itemized",amount_fen=2500,
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
# An authorized closing decision can ACCEPT a residual after an approved
# revised settlement. The old matched cash entries are still preserved, but
# a 100-percent amount match must NOT be required as a project-closure gate.
def e2e_close_with_variance(label):
    version=row("SELECT version FROM projects WHERE id='end_to_end_p'")["version"]+1
    db.execute("SAVEPOINT allowed_e2e_close")
    try:
        add("project_stage_events",id="test_e2e_close",
            project_id="end_to_end_p",stage="closed",
            project_version=version,
            actor_id="u",created_at="2026-11-07T20:45:01.000Z")
        ok(label,row("SELECT status FROM projects "
            "WHERE id='end_to_end_p'")["status"]=="closed")
    finally:
        db.execute("ROLLBACK TO allowed_e2e_close")
        db.execute("RELEASE allowed_e2e_close")

e2e_close_with_variance(
    "explicit approval may close with un-reconciled revision and remaining expense")
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
add("settlement_versions",id="end_to_end_sv3",mode="itemized",amount_fen=450,
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
# A provisional reconciliation remains provisional; an explicit project
# close decision may still accept this known financial variance.
e2e_close_with_variance(
    "explicit approved closure accepts provisional cost reconciliation as unresolved")
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
# Additional approved statement without a current expense reconciliation
# is a REAL unresolved settlement, never silently counted as matched.
add("settlements",id="end_to_end_st_extra",project_id="end_to_end_p",
    number="E2E-EXTRA",created_by="u",
    created_at="2026-11-07T20:44:27.000Z")
add("settlement_items",id="end_to_end_extra_item",
    settlement_id="end_to_end_st_extra",project_scope_id="end_to_end_scope",
    created_at="2026-11-07T20:44:28.000Z")
add("settlement_versions",id="end_to_end_extra_v1",mode="itemized",amount_fen=25,
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
e2e_close_with_variance(
    "approved unmatched settlement is retained but does not prohibit acknowledged close")
# Explicit approved void supersedes only that extra statement. Nothing is
# silently erased from the audit history or earlier approved snapshots.
add("settlement_versions",id="end_to_end_extra_void",mode="itemized",amount_fen=0,
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
# After a one-time clean import there is no mapping to an external PMS
# material identifier. Local codes remain stable and descriptive revisions
# remain independently auditable.
add("materials",id="local_mat_a",code="LOCAL-A",name="绝缘子旧型号",
    unit_id="unit",model="A-v1",
    created_at="2026-11-07T12:00:00.000Z")
add("materials",id="local_mat_b",code="LOCAL-B",name="另一个材料",
    unit_id="unit",model="B",
    created_at="2026-11-07T12:00:00.000Z")
ok("cleaned material master has no external PMS synchronization fields",
    not {"pms_material_code","external_material_id"}&
    {x["name"] for x in db.execute("PRAGMA table_info(material_versions)")})
revise_material("local_mat_a",model="A-v2",
    recorded_at="2026-11-07T13:00:00.000Z",
    reason="正式更正规格型号")
ok("local material model change is versioned without external mapping",
    row("SELECT model FROM material_versions WHERE "
        "id='local_mat_a_v1'")["model"]=="A-v1"
    and row("SELECT model FROM v_material_current "
        "WHERE id='local_mat_a'")["model"]=="A-v2"
    and row("SELECT code FROM materials WHERE id='local_mat_a'")["code"]
       =="LOCAL-A")
blocked("distinct local material identities cannot reuse the same code",
    "INSERT INTO materials(id,code,unit_id,created_at)"
    " VALUES(?,?,?,?)",
    ("local_mat_duplicate","local-a","unit",
     "2026-11-07T13:05:00.000Z"))
# User-confirmed business model: one subproject can be settled in MANY
# independent installments. Each approved settlement item is its THIS-TIME
# amount, never a cumulative amount. Actual cost is settled progressively
# through sole real cost-to-statement reconciliation; never count old
# replaced statement versions twice.
db.execute("SAVEPOINT user_confirmed_installments")
try:
    add("cost_entries",id="installment_cost",project_id="p",
        created_by="u",created_at="2026-11-08T02:00:00.000Z")
    add("cost_versions",id="installment_cost_v1",
        entry_id="installment_cost",funding_version_id="fund2",
        version_no=1,status="active",title="待分期结算的真实费用",
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
        add("settlement_versions",id=version,mode="itemized",amount_fen=settled_amount,
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
    ok("online backup preserves latest local master and immutable old definitions",
        writer.execute("SELECT model FROM v_material_current "
            "WHERE id='local_mat_a'").fetchone()[0]=="A-v2"
        and writer.execute("SELECT model FROM material_versions "
            "WHERE id='local_mat_a_v1'").fetchone()[0]=="A-v1"
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
blocked("cleaned source must not pretend to support ongoing PMS synchronization",
    "INSERT INTO source_records("
    "id,source_system,description,created_by,created_at)"
    " VALUES(?,?,?,?,?)",
    ("invalid_external_sync","pms","不支持持续外部对接","u",
     "2026-11-08T02:00:00.000Z"))
# Separate physical and logical lifecycle: a shared physical tower may serve
# multiple circuits, each with an independently maintained retirement status.
# The physical asset may stop operating only after ALL active logical circuits
# are no longer in service, and the old per-circuit team name remains historical.
db.execute("SAVEPOINT full_shared_tower_retirement")
try:
    add("transmission_lines",id="shared_line_a",line_code="L-SHARED-A",
        name="共享物理塔第一回线路",voltage_level_id="vol",created_by="u",
        created_at="2026-11-08T03:00:00.000Z",
        updated_at="2026-11-08T03:00:00.000Z")
    add("transmission_lines",id="shared_line_b",line_code="L-SHARED-B",
        name="共享物理塔第二回线路",voltage_level_id="vol",created_by="u",
        created_at="2026-11-08T03:00:00.000Z",
        updated_at="2026-11-08T03:00:00.000Z")
    add("physical_towers",id="shared_physical",tower_code="PT-SHARED",
        created_by="u",created_at="2026-11-08T03:00:00.000Z",
        updated_at="2026-11-08T03:00:00.000Z")
    add("logical_towers",id="shared_circuit_a",logical_code="SHARED-A",
        line_id="shared_line_a",physical_tower_id="shared_physical",
        tower_no="SHARED-001",sort_rank=15,status="active",
        operations_team="输电运维一班",created_by="u",
        created_at="2026-11-08T03:00:00.000Z",
        updated_at="2026-11-08T03:00:00.000Z")
    add("logical_towers",id="shared_circuit_b",logical_code="SHARED-B",
        line_id="shared_line_b",physical_tower_id="shared_physical",
        tower_no="SHARED-002",sort_rank=15,status="active",
        operations_team="输电运维二班",created_by="u",
        created_at="2026-11-08T03:00:00.000Z",
        updated_at="2026-11-08T03:00:00.000Z")
    ok("shared physical tower has independent active logical circuits",
        row("SELECT COUNT(*) n FROM logical_towers "
            "WHERE physical_tower_id='shared_physical' AND status='active'")['n']==2)
    blocked("cannot retire a whole line with active logical circuit",
        "UPDATE transmission_lines SET status='retired',version=2,"
        "updated_by='u',change_reason='逻辑杆塔未退运',"
        "updated_at='2026-11-08T03:05:00.000Z'"
        " WHERE id='shared_line_a'")
    db.execute("UPDATE logical_towers SET status='retired',version=2,"
        "updated_by='u',change_reason='第一回线路独立退役',"
        "updated_at='2026-11-08T03:10:00.000Z'"
        " WHERE id='shared_circuit_a'")
    ok("retiring one shared circuit keeps other circuit and physical tower active",
        row("SELECT status FROM logical_towers WHERE id='shared_circuit_b'")['status']
        =='active' and
        row("SELECT status FROM physical_towers WHERE id='shared_physical'")['status']
        =='active' and
        row("SELECT operations_team,status FROM logical_tower_history "
            "WHERE logical_tower_id='shared_circuit_a' AND version=1")
            ['operations_team']=='输电运维一班' and
        row("SELECT status FROM logical_tower_history "
            "WHERE logical_tower_id='shared_circuit_a' AND version=2")['status']
            =='retired')
    db.execute("UPDATE transmission_lines SET status='retired',version=2,"
        "updated_by='u',change_reason='第一回线路正式退役',"
        "updated_at='2026-11-08T03:15:00.000Z'"
        " WHERE id='shared_line_a'")
    ok("one entire shared line may retire while the other line stays in service",
        row("SELECT status FROM transmission_lines WHERE id='shared_line_a'")
            ['status']=='retired'
        and row("SELECT status FROM transmission_lines WHERE id='shared_line_b'")
            ['status']=='active'
        and row("SELECT status FROM physical_towers WHERE id='shared_physical'")
            ['status']=='active'
        and row("SELECT status FROM line_history "
            "WHERE line_id='shared_line_a' AND version=2")['status']=='retired')
    blocked("retired line cannot accept an active new logical circuit",
        "INSERT INTO logical_towers("
        "id,logical_code,line_id,physical_tower_id,tower_no,sort_rank,"
        "status,created_by,created_at)"
        " VALUES(?,?,?,?,?,?,?,?,?)",
        ("invalid_retired_line","INVALID-RETIRED-LINE","shared_line_a",
         "shared_physical","BAD-RETIRED",60,"active","u",
         "2026-11-08T03:18:00.000Z"))
    blocked("physical tower cannot be marked inactive with an active other circuit",
        "UPDATE physical_towers SET status='inactive',version=2,"
        "updated_by='u',change_reason='错误停用实物',"
        "updated_at='2026-11-08T03:20:00.000Z'"
        " WHERE id='shared_physical'")
    db.execute("UPDATE logical_towers SET status='retired',version=2,"
        "updated_by='u',change_reason='第二回线路也正式退役',"
        "updated_at='2026-11-08T03:30:00.000Z'"
        " WHERE id='shared_circuit_b'")
    db.execute("UPDATE physical_towers SET status='retired',version=2,"
        "updated_by='u',change_reason='已无在运回路，物理资产正式退役',"
        "updated_at='2026-11-08T03:40:00.000Z'"
        " WHERE id='shared_physical'")
    ok("physical retirement follows both circuit retirements with exact history",
        row("SELECT status FROM physical_tower_history "
            "WHERE physical_tower_id='shared_physical' AND version=1")['status']
            =='active' and row("SELECT status FROM physical_tower_history "
            "WHERE physical_tower_id='shared_physical' AND version=2")['status']
            =='retired')
    blocked("new active logical circuit may not use a retired physical structure",
        "INSERT INTO logical_towers("
        "id,logical_code,line_id,physical_tower_id,tower_no,sort_rank,"
        "status,created_by,created_at)"
        " VALUES(?,?,?,?,?,?,?,?,?)",
        ("invalid_active_shared","INVALID-SHARED","shared_line_b",
         "shared_physical","BAD-001",50,"active","u",
         "2026-11-08T03:45:00.000Z"))
finally:
    db.execute("ROLLBACK TO full_shared_tower_retirement")
    db.execute("RELEASE full_shared_tower_retirement")

# Referential operation -> immutable operation-version -> rule conditions.
# The price is specific to voltage, tower type, work mode and immutable extra
# factors. No price is attached to mutable operation or physical tower labels.
db.execute("SAVEPOINT reference_price_contexts")
try:
    add("operations",id="context_op",code="CONTEXT-OP",created_at="2026-11-07T00:00:00.000Z")
    add("operation_versions",id="context_op_v1",operation_id="context_op",version=1,
        name="价格属性上下文",status="active",work_object_id="obj",work_object_version_no=1,
        default_unit_id="unit",default_unit_version=1,
    attributes_schema_json=json.dumps([
      {"key":"terrain","label":"地形","scope":"location","source":"manual","type":"select","enabled":True,"pricing":True},
      {"key":"height_mm","label":"高度","scope":"location","source":"manual","type":"integer","enabled":True,"pricing":True},
      {"key":"unpriced","label":"备注","scope":"location","source":"manual","type":"text","enabled":True,"pricing":False},
      {"key":"disabled","label":"停用属性","scope":"location","source":"manual","type":"integer","enabled":False,"pricing":True}]),
        changed_by="u",changed_at="2026-11-07T00:00:00.000Z")
    ok("unified operation attributes replace the independent price-factor dictionary",
        row("SELECT COUNT(*) n FROM dictionary_types WHERE id='price_factor'")['n']==0)
    add("voltage_levels",id="vol220",code="220",name="220kV")
    add("reference_price_catalog",id="price_angle",
        code="REF-PRICE-ANGLE",created_by="u",
        created_at="2026-11-08T03:00:00.000Z")
    add("reference_price_versions",id="price_angle_v1",
        catalog_id="price_angle",version_no=1,title="耐张塔山区参考价",
        operation_id="context_op",operation_version=1,unit_id="unit",
        unit_version=1,voltage_level_id="vol",tower_material="angle",
        work_mode="outage",additional_conditions_json=
        '{"terrain":{"context_op":"eq","value":"mountain"}}',
        status="active",unit_price_fen=250000,price_source="内部定额",
        price_date="2026-11-08",
        effective_on="2026-11-08",basis="电压塔型和山区条件",
        reason="首次价格规则",created_by="u",
        created_at="2026-11-08T03:01:00.000Z")
    add("reference_price_catalog",id="price_suspension",
        code="REF-PRICE-SUSPENSION",created_by="u",
        created_at="2026-11-08T03:00:00.000Z")
    add("reference_price_versions",id="price_suspension_v1",
        catalog_id="price_suspension",version_no=1,title="直线塔平原参考价",
        operation_id="context_op",operation_version=1,unit_id="unit",
        unit_version=1,voltage_level_id="vol220",tower_material="suspension",
        work_mode="outage",additional_conditions_json=
        '{"terrain":{"context_op":"eq","value":"plain"}}',
        status="active",unit_price_fen=160000,price_source="内部定额",
        price_date="2026-11-08",
        effective_on="2026-11-08",basis="电压塔型和平原条件",
        reason="首次价格规则",created_by="u",
        created_at="2026-11-08T03:01:00.000Z")
    ok("same operation and unit support independent voltage/tower/factor prices",
        row("SELECT COUNT(*) n FROM v_reference_price_current "
            "WHERE operation_id='context_op' AND operation_version=1 "
            "AND work_mode='outage'")['n']>=2
        and row("SELECT voltage_level_id,tower_material FROM reference_price_versions "
            "WHERE id='price_angle_v1'")['voltage_level_id']=='vol'
        and row("SELECT voltage_level_id,tower_material FROM reference_price_versions "
            "WHERE id='price_suspension_v1'")['voltage_level_id']=='vol220'
        and row("SELECT tower_material FROM reference_price_versions "
            "WHERE id='price_suspension_v1'")['tower_material']=='suspension'
        and row("SELECT additional_conditions_json FROM reference_price_versions "
            "WHERE id='price_angle_v1'")['additional_conditions_json']
            =='{"terrain":{"context_op":"eq","value":"mountain"}}')
    blocked("reference price factors must be a valid JSON object",
        'INSERT INTO reference_price_versions(id,catalog_id,version_no,title,operation_id,operation_version,unit_id,unit_version,status,unit_price_fen,price_source,price_date,effective_on,basis,reason,created_by,created_at,additional_conditions_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ("invalid_price_factor","price_angle",2,"条件非法","context_op",1,
         "unit",1,"active",250000,"内部定额","2026-11-08",
         "2026-11-08","非法数组","无效规则",
         "u","2026-11-08T03:02:00.000Z",'[]'))
    blocked("reference price tower type cannot contain padding",
        'INSERT INTO reference_price_versions(id,catalog_id,version_no,title,operation_id,operation_version,unit_id,unit_version,status,unit_price_fen,price_source,price_date,effective_on,basis,reason,created_by,created_at,tower_material) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ("invalid_price_tower","price_angle",2,"塔型非法","context_op",1,
         "unit",1,"active",250000,"内部定额","2026-11-08",
         "2026-11-08","非法塔型","无效规则",
         "u","2026-11-08T03:02:00.000Z",' angle '))
    blocked_reason("price factor code must exist in the active versioned dictionary",
        'INSERT INTO reference_price_versions(id,catalog_id,version_no,title,operation_id,operation_version,unit_id,unit_version,status,unit_price_fen,price_source,price_date,effective_on,basis,reason,created_by,created_at,additional_conditions_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        "价格条件须引用采用操作正式版本的有效计价属性",
        ("invalid_unknown_factor","price_angle",2,"无效因素","context_op",1,
         "unit",1,"active",250000,"内部定额","2026-11-08",
         "2026-11-08","不存在的因素","无效规则",
         "u","2026-11-08T03:02:00.000Z",
         '{"does_not_exist":{"context_op":"eq","value":"x"}}'))
    blocked_reason("unpriced attribute cannot be used as an applicability condition",
        'INSERT INTO reference_price_versions(id,catalog_id,version_no,title,operation_id,operation_version,unit_id,unit_version,status,unit_price_fen,price_source,price_date,effective_on,basis,reason,created_by,created_at,additional_conditions_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        "价格条件须引用采用操作正式版本的有效计价属性",
        ("invalid_factor_type","price_angle",2,"错误因素值类型","context_op",1,
         "unit",1,"active",250000,"内部定额","2026-11-08",
         "2026-11-08","因素类型不符","无效规则",
         "u","2026-11-08T03:02:00.000Z",
         '{"unpriced":{"context_op":"eq","value":"x"}}'))
    invalid_factor_sql=(
        'INSERT INTO reference_price_versions(id,catalog_id,version_no,title,operation_id,operation_version,unit_id,unit_version,status,unit_price_fen,price_source,price_date,effective_on,basis,reason,created_by,created_at,additional_conditions_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    def invalid_factor_args(label, value):
        return (label,"price_angle",2,"无效因素","context_op",1,"unit",1,"active",
                250000,"内部定额","2026-11-08","2026-11-08",
                "测试无效因素","无效规则","u","2026-11-08T03:03:00.000Z",value)
    blocked_reason("unknown attribute identity is rejected against adopted operation version",
        invalid_factor_sql,
        "价格条件须引用采用操作正式版本的有效计价属性",
        invalid_factor_args("unknown_price_factor_version",
            '{"unknown":{"context_op":"eq","value":"mountain"}}'))
    blocked_reason("disabled attributes cannot appear in new price versions",
        invalid_factor_sql,
        "价格条件须引用采用操作正式版本的有效计价属性",
        invalid_factor_args("invalid_numeric_factor_interval",
            '{"disabled":{"context_op":"range","min":30000,"max":60000}}'))
    blocked_reason("duplicate JSON factor keys cannot double-declare one factor",
        invalid_factor_sql,"价格条件属性身份不能重复",
        invalid_factor_args("duplicate_price_factor_keys",
            '{"terrain":{"context_op":"eq","value":"mountain"},'
            '"terrain":{"context_op":"eq","value":"plain"}}'))
    add("reference_price_versions",id="price_angle_v2",
        catalog_id="price_angle",version_no=2,title="耐张塔山区参考价",
        operation_id="context_op",operation_version=1,unit_id="unit",
        unit_version=1,voltage_level_id="vol",tower_material="angle",
        work_mode="outage",additional_conditions_json=
        '{"terrain":{"context_op":"eq","value":"mountain"},'
        '"height_mm":{"context_op":"range","min":30000,"max":50000}}',
        status="active",unit_price_fen=250000,price_source="内部定额",
        price_date="2026-11-08",
        effective_on="2026-11-08",basis="电压塔型和山区条件",
        reason="增加高度适用条件",created_by="u",
        created_at="2026-11-08T03:04:00.000Z")
    ok("applicability-only reference price revision is a full immutable version",
        row("SELECT additional_conditions_json FROM v_reference_price_current "
            "WHERE id='price_angle'")['additional_conditions_json']
            !=row("SELECT additional_conditions_json FROM reference_price_versions "
            "WHERE id='price_angle_v1'")['additional_conditions_json'])
    blocked_reason("unchanged price conditions cannot create another version",
        'INSERT INTO reference_price_versions(id,catalog_id,version_no,title,operation_id,operation_version,unit_id,unit_version,voltage_level_id,tower_material,work_mode,additional_conditions_json,status,unit_price_fen,price_source,price_date,effective_on,basis,reason,created_by,created_at) VALUES('+",".join("?" for _ in range(21))+")",
        "参考价正式版本没有真实价格或分类依据变化，不允许空改版",
        ("unchanged_price_conditions","price_angle",3,"耐张塔山区参考价",
         "context_op",1,"unit",1,"vol","angle","outage",
         '{"terrain":{"context_op":"eq","value":"mountain"},'
         '"height_mm":{"context_op":"range","min":30000,"max":50000}}',
         "active",250000,"内部定额","2026-11-08",
         "2026-11-08","电压塔型和山区条件","只改备注","u",
         "2026-11-08T03:05:00.000Z"))
finally:
    db.execute("ROLLBACK TO reference_price_contexts")
    db.execute("RELEASE reference_price_contexts")

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
            funding_version_id='fund2',status='active',
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
        add('settlement_versions',id=vid,mode="itemized",amount_fen=sum(amounts.values()),settlement_id=sid,version_no=1,
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
    add('settlement_versions',id='fee_doc_4_v1',mode="itemized",amount_fen=600,settlement_id='fee_doc_4',
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
    # A newer APPROVED full-statement revision supersedes old reconciliation
    # amounts. Old versions remain inspectable but are no longer effective.
    add('settlement_versions',id='fee_doc_3_v2',mode="itemized",amount_fen=1500,settlement_id='fee_doc_3',
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
    # A formally replaced statement invalidates the old reconciliation.
    # It must remain possible to append a VOID event to that historical
    # reconciliation even though its former statement is no longer effective.
    add('cost_reconciliation_versions',
        id='fee_doc_3_fee_material_void_v2',
        record_id='fee_doc_3_fee_material_recon',version_no=2,
        status='voided',cost_version_id='fee_material_cost_v1',
        settlement_item_id='fee_doc_3_fee_material',
        settlement_item_version_id='fee_doc_3_fee_material_v1',
        reconciled_cost_fen=2000,reconciled_settlement_fen=2000,
        is_final=0,evidence='旧批准结算已由新版替代，正式撤销原核对',
        actor_id='u',created_at=t,
        request_key='fee_doc_3_fee_material_void_v2')
    ok('superseded installment can preserve formal voided reconciliation history',
        row("SELECT status FROM v_cost_reconciliation_current "
            "WHERE record_id='fee_doc_3_fee_material_recon'")['status']=='voided'
        and effective_applied('fee_material_cost')==3000)
    blocked('cannot invent a first-version void without a financial record',
        'INSERT INTO cost_reconciliation_versions('
        'id,record_id,version_no,status,cost_version_id,'
        'settlement_item_id,settlement_item_version_id,'
        'reconciled_cost_fen,reconciled_settlement_fen,is_final,evidence,'
        'actor_id,created_at,request_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ('invented_void','invented_void',1,'voided',
         'fee_material_cost_v1','fee_doc_3_fee_material',
         'fee_doc_3_fee_material_v1',2000,2000,0,
         '不能伪造无原始核对的撤销','u',t,'invented_void'))
    blocked('voided reconciliation must preserve previous business amounts',
        'INSERT INTO cost_reconciliation_versions('
        'id,record_id,version_no,status,cost_version_id,'
        'settlement_item_id,settlement_item_version_id,'
        'reconciled_cost_fen,reconciled_settlement_fen,is_final,evidence,'
        'actor_id,created_at,request_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ('fake_void_amount','fee_doc_3_fee_material_recon',3,'voided',
         'fee_material_cost_v1','fee_doc_3_fee_material',
         'fee_doc_3_fee_material_v1',1999,2000,0,
         '不能借撤销改写原始金额','u',t,'fake_void_amount'))
    blocked('voided reconciliation cannot carry final approval flag',
        'INSERT INTO cost_reconciliation_versions('
        'id,record_id,version_no,status,cost_version_id,'
        'settlement_item_id,settlement_item_version_id,'
        'reconciled_cost_fen,reconciled_settlement_fen,is_final,evidence,'
        'actor_id,created_at,request_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ('fake_void_final','fee_doc_3_fee_material_recon',3,'voided',
         'fee_material_cost_v1','fee_doc_3_fee_material',
         'fee_doc_3_fee_material_v1',2000,2000,1,
         '撤销不能标记仍已最终核对','u',t,'fake_void_final'))
    blocked('cannot void a reconciliation that was already formally voided',
        'INSERT INTO cost_reconciliation_versions('
        'id,record_id,version_no,status,cost_version_id,'
        'settlement_item_id,settlement_item_version_id,'
        'reconciled_cost_fen,reconciled_settlement_fen,is_final,evidence,'
        'actor_id,created_at,request_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ('repeated_void','fee_doc_3_fee_material_recon',3,'voided',
         'fee_material_cost_v1','fee_doc_3_fee_material',
         'fee_doc_3_fee_material_v1',2000,2000,0,'不能重复撤销','u',
         '2026-11-08T03:00:00.100Z','repeated_void'))
    blocked('financial reconciliation revision cannot backdate formal history',
        'INSERT INTO cost_reconciliation_versions('
        'id,record_id,version_no,status,cost_version_id,'
        'settlement_item_id,settlement_item_version_id,'
        'reconciled_cost_fen,reconciled_settlement_fen,is_final,evidence,'
        'actor_id,created_at,request_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ('backdated_recon','fee_doc_1_fee_material_recon',2,'active',
         'fee_material_cost_v1','fee_doc_1_fee_material',
         'fee_doc_1_fee_material_v1',2000,2000,1,'不能倒签核对历史','u',
         '2026-11-07T03:00:00.000Z','backdated_recon'))
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
    # Review affected reconciliation before applying the lower actual amount.
    cost_node = row("SELECT cost_node_version_id FROM cost_versions WHERE id='fee_material_cost_v2'")["cost_node_version_id"]
    blocked('cost reduction must first correct already applied reconciliation',
        cost_revision_insert,
        ('blocked_fee_material_cost_v3','fee_material_cost',cost_node,'fund2',
         3,'active','材料费用核减','2026-11-08',4000,'核减单','实际费用更正','u',t,
         'blocked_fee_material_cost_v3'))
    add('cost_reconciliation_versions',id='revised_fee_doc_3_recon_v2',
        record_id='revised_fee_doc_3_recon',version_no=2,status='active',
        cost_version_id='fee_material_cost_v2',
        settlement_item_id='fee_doc_3_fee_material',
        settlement_item_version_id='fee_doc_3_fee_material_v2',
        reconciled_cost_fen=1000,reconciled_settlement_fen=1500,
        is_final=0,evidence='核减前调整实际费用份额',actor_id='u',
        created_at=t,request_key='revised_fee_doc_3_recon_v2')
    add('cost_versions',id='fee_material_cost_v3',
        entry_id='fee_material_cost',version_no=3,
        funding_version_id='fund2',status='active',
        title='材料退补后的最终实际费用',occurred_on='2026-11-08',
        amount_fen=4000,evidence='实际材料费用正式核减1500分',
        reason='更正应结金额',confirmed_by='u',
        confirmed_at=t,request_key='fee_material_cost_v3')
    ok('downward cost correction keeps historical facts after reconciliation is adjusted',
        row('SELECT amount_fen FROM v_cost_current '
            "WHERE entry_id='fee_material_cost'")['amount_fen']==4000
        and effective_applied('fee_material_cost')==4000
        and row("SELECT COUNT(*) n FROM cost_reconciliation_versions WHERE record_id='revised_fee_doc_3_recon'")['n']==2
        and row('SELECT COUNT(*) n FROM v_cost_reconciliation_current '
            "WHERE record_id='fee_doc_1_fee_material_recon'")['n']==1)
    blocked('cannot add more active reconciliation to a fully matched corrected cost',
        'INSERT INTO cost_reconciliation_versions(id,record_id,version_no,'
        'status,cost_version_id,settlement_item_id,settlement_item_version_id,'
        'reconciled_cost_fen,reconciled_settlement_fen,is_final,evidence,'
        'actor_id,created_at,request_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ('after_downward_overpay','after_downward_overpay',1,'active',
         'fee_material_cost_v3','fee_doc_4_item','fee_doc_4_item_v1',
         100,100,0,'不可再次核对超支历史','u',t,
         'after_downward_overpay'))
    # Fee-tree identity is the ONLY account taxonomy. No second category
    # can disagree with the leaf and its immutable definition version.
    cost_fields={c['name'] for c in db.execute('PRAGMA table_info(cost_versions)')}
    ok('actual expense has exactly one fee-tree category authority',
        {'entry_id','cost_node_version_id','title','amount_fen'}.issubset(cost_fields)
        and 'category_id' not in cost_fields
        and 'category_snapshot' not in cost_fields
        and row("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' "
                "AND name='idx_cost_versions_category'")['n']==0)
    blocked('identical fee-node content cannot create fake history version',
        'INSERT INTO project_cost_node_versions(id,node_id,version_no,name,'
        'status,reason,actor_id,recorded_at) VALUES(?,?,?,?,?,?,?,?)',
        ('fee_material_duplicate','fee_material',4,'设备材料费',
         'active','重复无意义版本','u','2026-11-09T03:00:00.000Z'))
    blocked('new fee-node definition cannot precede original fee identity',
        'INSERT INTO project_cost_node_versions(id,node_id,version_no,name,'
        'status,reason,actor_id,recorded_at) VALUES(?,?,?,?,?,?,?,?)',
        ('fee_material_backdated','fee_material',4,'修正材料费',
         'active','补写早期记录','u','2026-11-07T01:00:00.000Z'))
    add('project_cost_node_versions',id='fee_material_future_v4',
        node_id='fee_material',version_no=4,name='未来材料费',
        status='active',reason='未来正式改名',actor_id='u',
        recorded_at='2026-11-10T03:00:00.000Z')
    add('cost_entries',id='fee_future_cost',project_id='p',
        cost_node_id='fee_material',created_by='u',created_at=t)
    blocked('actual expense cannot pin a fee version published after confirmation',
        'INSERT INTO cost_versions(id,entry_id,cost_node_version_id,'
        'funding_version_id,version_no,status,title,occurred_on,amount_fen,'
        'evidence,reason,confirmed_by,confirmed_at,request_key) '
        'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ('fee_cost_future_invalid','fee_future_cost','fee_material_future_v4',
         'fund2',1,'active','材料费测试','2026-11-08',100,'合法凭据',
         '检验未来版本','u',t,'fee_cost_future_invalid'))
    add('settlements',id='fee_future_statement',project_id='p',
        number='FEE-FUTURE',created_by='u',created_at=t)
    add('settlement_items',id='fee_future_statement_item',
        settlement_id='fee_future_statement',cost_node_id='fee_material',
        project_scope_id=None,created_at=t)
    add('settlement_versions',id='fee_future_statement_v1',mode="itemized",amount_fen=100,
        settlement_id='fee_future_statement',version_no=1,
        approval_version_id='av2',funding_version_id='fund2',
        change_type='initial',reason='测试科目未来版本时间',
        created_by='u',recorded_at=t)
    blocked('settlement line cannot pin a fee version published after statement',
        'INSERT INTO settlement_item_versions('
        'id,settlement_version_id,settlement_item_id,cost_node_version_id,'
        'approval_scope_version_id,quantity_scaled,amount_fen,'
        'evidence,scope_snapshot_json) VALUES(?,?,?,?,?,?,?,?,?)',
        ('fee_future_item_invalid','fee_future_statement_v1',
         'fee_future_statement_item','fee_material_future_v4',
         None,0,100,'结算科目未来版本','{}'))
    blocked('cannot attach a fee child to an undefined parent',
        'INSERT INTO project_cost_nodes(id,project_id,parent_id,created_by,created_at)'
        ' VALUES(?,?,?,?,?)',
        ('invalid_child_undefined','p','fee_without_definition','u',t))
    add('project_cost_nodes',id='fee_inactive_group',project_id='p',
        parent_id=None,created_by='u',created_at=t)
    add('project_cost_node_versions',id='fee_inactive_group_v1',
        node_id='fee_inactive_group',version_no=1,name='待启停的费用分组',
        status='active',reason='建档',actor_id='u',recorded_at=t)
    add('project_cost_node_versions',id='fee_inactive_group_v2',
        node_id='fee_inactive_group',version_no=2,name='待启停的费用分组',
        status='inactive',reason='暂时停用',actor_id='u',
        recorded_at='2026-11-09T03:00:00.000Z')
    blocked('cannot create new child below an inactive fee group',
        'INSERT INTO project_cost_nodes(id,project_id,parent_id,created_by,created_at)'
        ' VALUES(?,?,?,?,?)',
        ('invalid_inactive_child','p','fee_inactive_group','u',
         '2026-11-10T03:00:00.000Z'))
    blocked('fee node history event time cannot move backwards',
        'INSERT INTO project_cost_node_versions(id,node_id,version_no,name,'
        'status,reason,actor_id,recorded_at) VALUES(?,?,?,?,?,?,?,?)',
        ('fee_inactive_backdated','fee_inactive_group',3,'可用费用分组',
         'active','错误倒序','u','2026-11-08T10:00:00.000Z'))
    add('project_cost_node_versions',id='fee_inactive_group_v3',
        node_id='fee_inactive_group',version_no=3,name='恢复可用费用分组',
        status='active',reason='审批恢复',actor_id='u',
        recorded_at='2026-11-10T03:00:00.000Z')
    add('project_cost_nodes',id='fee_reactivated_child',project_id='p',
        parent_id='fee_inactive_group',created_by='u',
        created_at='2026-11-10T03:01:00.000Z')
    ok('reactivation allows genuine new fee subtree without altering past versions',
        row('SELECT parent_id FROM project_cost_nodes '
            "WHERE id='fee_reactivated_child'")['parent_id']=='fee_inactive_group'
        and row('SELECT status FROM project_cost_node_versions '
            "WHERE id='fee_inactive_group_v2'")['status']=='inactive')
    add('project_cost_node_versions',id='fee_reactivated_child_v1',
        node_id='fee_reactivated_child',version_no=1,
        name='深层费用末级',status='active',reason='首次建档',
        actor_id='u',recorded_at='2026-11-10T03:01:00.000Z')
    add('project_cost_node_versions',id='fee_inactive_group_v4',
        node_id='fee_inactive_group',version_no=4,
        name='恢复可用费用分组',status='inactive',
        reason='再次停用整个分类分组',actor_id='u',
        recorded_at='2026-11-12T03:00:00.000Z')
    blocked('grandparent disable blocks new expense on otherwise active leaf',
        'INSERT INTO cost_entries(id,project_id,cost_node_id,created_by,created_at)'
        ' VALUES(?,?,?,?,?)',
        ('fee_under_disabled_ancestor_cost','p','fee_reactivated_child','u',
         '2026-11-12T03:01:00.000Z'))
    blocked('grandparent disable blocks new settlement on otherwise active leaf',
        'INSERT INTO settlement_items(id,settlement_id,cost_node_id,created_at)'
        ' VALUES(?,?,?,?)',
        ('fee_under_disabled_ancestor_item','st','fee_reactivated_child',
         '2026-11-12T03:01:00.000Z'))
    blocked('grandparent disable blocks nesting new child under active child',
        'INSERT INTO project_cost_nodes(id,project_id,parent_id,created_by,created_at)'
        ' VALUES(?,?,?,?,?)',
        ('fee_under_disabled_ancestor_grandchild','p','fee_reactivated_child',
         'u','2026-11-12T03:01:00.000Z'))
    add('project_cost_node_versions',id='fee_inactive_group_v5',
        node_id='fee_inactive_group',version_no=5,
        name='恢复可用费用分组',status='active',reason='正式恢复',
        actor_id='u',recorded_at='2026-11-13T03:00:00.000Z')
    add('cost_entries',id='fee_after_ancestor_restore',project_id='p',
        cost_node_id='fee_reactivated_child',created_by='u',
        created_at='2026-11-13T03:01:00.000Z')
    ok('ancestor reactivation restores valid new expense identity',
        row('SELECT cost_node_id FROM cost_entries '
            "WHERE id='fee_after_ancestor_restore'")['cost_node_id']
            =='fee_reactivated_child')
    add('project_cost_node_versions',id='fee_material_inactive_v5',
        node_id='fee_material',version_no=5,name='未来材料费',
        status='inactive',reason='停止新增材料费用',actor_id='u',
        recorded_at='2026-11-11T03:00:00.000Z')
    blocked('disabled fee leaf cannot accept a new actual expense identity',
        'INSERT INTO cost_entries(id,project_id,cost_node_id,created_by,created_at)'
        ' VALUES(?,?,?,?,?)',
        ('disabled_fee_cost','p','fee_material','u',
         '2026-11-11T03:01:00.000Z'))
    blocked('disabled fee leaf cannot accept a new settlement line identity',
        'INSERT INTO settlement_items(id,settlement_id,cost_node_id,created_at)'
        ' VALUES(?,?,?,?)',
        ('disabled_fee_statement','st','fee_material',
         '2026-11-11T03:01:00.000Z'))
    ok('disabled fee leaf preserves historical costs and accepted statement lines',
        row('SELECT COUNT(*) n FROM cost_entries '
            "WHERE id='fee_material_cost'")['n']==1
        and row('SELECT COUNT(*) n FROM settlement_item_versions '
            "WHERE id='fee_doc_1_fee_material_v1'")['n']==1)
    # Historic snapshots do not change even though the current label moved.
    ok('historical fee node snapshot survives later category rename',
        row('SELECT nv.name name FROM cost_versions cv '
            'JOIN project_cost_node_versions nv ON nv.id=cv.cost_node_version_id '
            "WHERE cv.id='fee_material_cost_v1'")['name']=='材料费'
        and row('SELECT nv.name name FROM settlement_item_versions iv '
            'JOIN project_cost_node_versions nv ON nv.id=iv.cost_node_version_id '
            "WHERE iv.id='fee_doc_1_fee_material_v1'")['name']=='施工材料费'
        and row('SELECT name,status FROM v_project_cost_node_current WHERE id=?',
            'fee_material')['status']=='inactive')
finally:
    db.execute('ROLLBACK TO hierarchical_fee_installments')
    db.execute('RELEASE hierarchical_fee_installments')

# Full-model financial history audit (isolated): financial baselines are soft,
# yet identity/version order cannot be forged or counted as duplicate authority.
db.execute('SAVEPOINT full_financial_history_audit')
try:
    add('frameworks',id='audit_framework',code='AUDIT-F-2026',
        fiscal_year=2026,created_at='2026-11-07T01:00:00.000Z')
    blocked('framework definition cannot predate framework identity',
        'INSERT INTO framework_versions(id,framework_id,version_no,name,'
        'limit_fen,status,reason,changed_by,recorded_at) '
        'VALUES(?,?,?,?,?,?,?,?,?)',
        ('audit_fw_bad_early','audit_framework',1,'初始框架',1000,
         'active','倒签','u','2026-11-07T00:59:59.000Z'))
    add('framework_versions',id='audit_fw_v1',framework_id='audit_framework',
        version_no=1,name='年度新框架',limit_fen=1000,status='active',
        reason='初始额度',changed_by='u',recorded_at='2026-11-07T01:00:00.000Z')
    blocked('framework version cannot be a false content-free revision',
        'INSERT INTO framework_versions(id,framework_id,version_no,name,'
        'limit_fen,status,reason,changed_by,recorded_at) '
        'VALUES(?,?,?,?,?,?,?,?,?)',
        ('audit_fw_bad_repeat','audit_framework',2,'年度新框架',1000,
         'active','只改备注','u','2026-11-07T02:00:00.000Z'))
    blocked('framework budget revision cannot backdate a formal version',
        'INSERT INTO framework_versions(id,framework_id,version_no,name,'
        'limit_fen,status,reason,changed_by,recorded_at) '
        'VALUES(?,?,?,?,?,?,?,?,?)',
        ('audit_fw_bad_time','audit_framework',2,'新年度框架',5000,
         'active','倒序','u','2026-11-07T00:59:59.000Z'))
    add('framework_versions',id='audit_fw_v2',framework_id='audit_framework',
        version_no=2,name='年度新框架',limit_fen=5000,status='active',
        reason='正式扩大软额度',changed_by='u',recorded_at='2026-11-07T02:00:00.000Z')
    add('agreements',id='audit_ag',code='AUDIT-AG-2026',
        framework_id='audit_framework',created_at='2026-11-07T01:30:00.000Z')
    blocked('agreement legal definition cannot predate agreement identity',
        'INSERT INTO agreement_versions(id,agreement_id,version_no,name,'
        'limit_fen,status,reason,changed_by,recorded_at) '
        'VALUES(?,?,?,?,?,?,?,?,?)',
        ('audit_ag_bad_early','audit_ag',1,'初始协议',1000,'active',
         '倒签','u','2026-11-07T01:00:00.000Z'))
    add('agreement_versions',id='audit_ag_v1',agreement_id='audit_ag',
        version_no=1,name='执行协议',limit_fen=3000,status='active',
        reason='首次确认',changed_by='u',recorded_at='2026-11-07T02:00:00.000Z')
    blocked('agreement version cannot repeat the same commercial facts',
        'INSERT INTO agreement_versions(id,agreement_id,version_no,name,'
        'limit_fen,status,reason,changed_by,recorded_at) '
        'VALUES(?,?,?,?,?,?,?,?,?)',
        ('audit_ag_bad_repeat','audit_ag',2,'执行协议',3000,'active',
         '仅重复内容','u','2026-11-07T03:00:00.000Z'))
    blocked('agreement terms revision cannot be inserted in reverse time',
        'INSERT INTO agreement_versions(id,agreement_id,version_no,name,'
        'limit_fen,status,reason,changed_by,recorded_at) '
        'VALUES(?,?,?,?,?,?,?,?,?)',
        ('audit_ag_bad_time','audit_ag',2,'执行协议',6000,'active',
         '倒序','u','2026-11-07T01:59:59.000Z'))
    add('agreement_versions',id='audit_ag_v2',agreement_id='audit_ag',
        version_no=2,name='执行协议',limit_fen=6000,status='active',
        reason='更新协议软额度',changed_by='u',recorded_at='2026-11-07T03:00:00.000Z')
    add('projects',id='audit_project',code='AUDIT-P2026',name='审计资金归属项目',
        framework_id='audit_framework',created_by='u',
        created_at='2026-11-07T04:00:00.000Z',
        updated_at='2026-11-07T04:00:00.000Z')
    blocked('funding relationship cannot predate owning project identity',
        'INSERT INTO project_funding_versions(id,project_id,version_no,'
        'agreement_id,reason,actor_id,recorded_at) VALUES(?,?,?,?,?,?,?)',
        ('audit_fund_bad_early','audit_project',1,'audit_ag',
         '倒签','u','2026-11-07T03:59:59.000Z'))
    add('project_funding_versions',id='audit_fund_v1',
        project_id='audit_project',version_no=1,agreement_id='audit_ag',
        reason='首次关联执行协议',actor_id='u',
        recorded_at='2026-11-07T04:00:00.000Z')
    blocked('funding association cannot produce a redundant no-op version',
        'INSERT INTO project_funding_versions(id,project_id,version_no,'
        'agreement_id,reason,actor_id,recorded_at) VALUES(?,?,?,?,?,?,?)',
        ('audit_fund_bad_noop','audit_project',2,'audit_ag',
         '重复选择相同协议','u','2026-11-07T05:00:00.000Z'))
    blocked('funding association cannot point to agreement in another framework',
        'INSERT INTO project_funding_versions(id,project_id,version_no,'
        'agreement_id,reason,actor_id,recorded_at) VALUES(?,?,?,?,?,?,?)',
        ('audit_fund_bad_cross','audit_project',2,'ag2',
         '其他框架协议','u','2026-11-07T05:00:00.000Z'))
    add('project_funding_versions',id='audit_fund_v2',
        project_id='audit_project',version_no=2,agreement_id=None,
        reason='正式调整为无协议关联',actor_id='u',
        recorded_at='2026-11-07T05:00:00.000Z')
    ok('framework, agreement and funding current views use one latest version only',
        row('SELECT limit_fen FROM v_framework_current WHERE id=?',
            'audit_framework')['limit_fen']==5000
        and row('SELECT limit_fen FROM v_agreement_current WHERE id=?',
                'audit_ag')['limit_fen']==6000
        and row('SELECT agreement_id FROM v_project_funding_current '
                'WHERE project_id=?','audit_project')['agreement_id'] is None)
finally:
    db.execute('ROLLBACK TO full_financial_history_audit')
    db.execute('RELEASE full_financial_history_audit')

# Full-model temporal audit: a corrected cost, project management fact,
# settlement snapshot or formal review event cannot precede its stable
# identity or prior formal history. All cases are isolated, no production DB.
db.execute('SAVEPOINT full_financial_temporal_audit')
try:
    tbase='2026-11-07T04:00:00.000Z'
    # The prior audit project exists only inside the earlier savepoint and
    # was rolled back. Reuse main approved p for version and settlement cases.
    add('projects',id='temporal_root_p',code='AUDIT-TEMP-P',
        name='结项前临时储备项目',framework_id='f',created_by='u',
        created_at='2026-11-07T20:00:00.000Z')
    stage('temporal_root_p','stocked',time='2026-11-07T20:00:00.000Z')
    blocked_reason('project approval identity cannot predate its project root',
        'INSERT INTO project_approval_versions('
        'id,project_id,version_no,snapshot_json,approved_budget_fen,created_at)'
        ' VALUES(?,?,?,?,?,?)',
        '项目批准草稿版本不能早于子项目创建或历史批准版本',
        ('temporal_bad_approval','temporal_root_p',1,'{}',500,
         '2026-11-07T19:59:59.000Z'))
    add('settlements',id='temporal_settle',project_id='p',number='TEMPORAL-S',
        created_by='u',created_at='2026-11-07T20:00:00.000Z')
    blocked('settlement version cannot predate its stable statement identity',
        'INSERT INTO settlement_versions(id,settlement_id,version_no,'
        'approval_version_id,funding_version_id,change_type,reason,mode,amount_fen,'
        'created_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        ('temporal_settle_v1_bad','temporal_settle',1,'av2','fund2',
         'initial','不能倒签正式结算','project_total',100,'u','2026-11-07T19:59:59.000Z'))
    add('settlement_versions',id='temporal_settle_v1',mode="itemized",amount_fen=100,
        settlement_id='temporal_settle',version_no=1,
        approval_version_id='av2',funding_version_id='fund2',
        change_type='initial',reason='核对结算时点',
        created_by='u',recorded_at='2026-11-07T20:00:00.000Z')
    add('settlement_items',id='temporal_settle_item',
        settlement_id='temporal_settle',project_scope_id=None,
        created_at='2026-11-07T20:00:00.000Z')
    add('settlement_item_versions',id='temporal_settle_itemv1',
        settlement_version_id='temporal_settle_v1',
        settlement_item_id='temporal_settle_item',
        approval_scope_version_id=None,quantity_scaled=0,amount_fen=100,
        evidence='真实费用核对',scope_snapshot_json='{}')
    blocked('settlement review event cannot predate submitted statement version',
        'INSERT INTO settlement_review_events(id,settlement_version_id,'
        'event_seq,action,reason,actor_id,recorded_at) '
        'VALUES(?,?,?,?,?,?,?)',
        ('temporal_review_early','temporal_settle_v1',1,'submit','',
         'u','2026-11-07T19:59:59.000Z'))
    add('settlement_review_events',id='temporal_review_submit',
        settlement_version_id='temporal_settle_v1',event_seq=1,
        action='submit',actor_id='u',
        recorded_at='2026-11-07T20:00:00.000Z')
    blocked('settlement review event cannot reverse prior review time',
        'INSERT INTO settlement_review_events(id,settlement_version_id,'
        'event_seq,action,reason,actor_id,recorded_at,effective_on) '
        'VALUES(?,?,?,?,?,?,?,?)',
        ('temporal_review_older','temporal_settle_v1',2,'approve','',
         'u','2026-11-07T19:59:59.000Z','2026-11-07'))
    blocked('cost correction cannot predate original cost identity',
        'INSERT INTO cost_versions(id,entry_id,cost_node_version_id,'
        'funding_version_id,version_no,status,title,occurred_on,'
        'amount_fen,evidence,reason,confirmed_by,confirmed_at,request_key) '
        'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ('temporal_cost_bad','audit_ce',
         row('SELECT cost_node_version_id FROM cost_versions WHERE id=?',
             'audit_cv2')['cost_node_version_id'],
         'fund2',3,'active','违规倒签费用','2026-11-07',10000,
         '真实凭据','倒签费用事实','u','2026-11-07T12:59:00.000Z',
         'temporal_cost_bad'))
    # Management definition V3 is otherwise valid, but cannot be backdated
    # before latest recorded project owner/manager history.
    prev=row('SELECT * FROM v_project_management_current WHERE project_id=?','p')
    blocked('project management version cannot backdate a formal owner change',
        'INSERT INTO project_management_versions('
        'id,project_id,version_no,owner_id,manager_id,managing_unit_id,'
        'preliminary_estimate_fen,reason,actor_id,recorded_at) '
        'VALUES(?,?,?,?,?,?,?,?,?,?)',
        ('temporal_management_bad','p',prev['version_no']+1,
         'u','u','ou',9000,'倒签责任和预估','u',
         '2026-11-07T00:00:00.000Z'))
finally:
    db.execute('ROLLBACK TO full_financial_temporal_audit')
    db.execute('RELEASE full_financial_temporal_audit')

# Complete project-profile identity audit: project name, category, owners
# and estimates are one full immutable version. The root never carries a
# second mutable display name, category or redundant stage timestamp.
db.execute('SAVEPOINT full_project_profile_audit')
try:
    add('dictionary_types',id='project_category',title='项目类别')
    add('dictionary_items',id='audit_project_cat',
        type_id='project_category',code='AUDIT-CAT',
        created_at='2026-11-07T22:00:00.000Z')
    add('dictionary_item_versions',id='audit_cat_v1',
        item_id='audit_project_cat',version=1,name='线路设备维护',
        status='active',reason='首次定义',changed_by='u',
        changed_at='2026-11-07T22:00:00.000Z')
    # Direct roots can only be persisted as short-lived transaction
    # participants; stage transition cannot accept a missing V1 profile.
    insert_raw('projects',id='profile_missing_v1',code='AUDIT-EMPTY-PROFILE',
        framework_id='f',created_by='u',
        created_at='2026-11-07T23:00:00.000Z')
    blocked_reason('project cannot advance to stocked without its V1 profile',
        'INSERT INTO project_stage_events('
        'id,project_id,stage,project_version,reason,actor_id,created_at)'
        ' VALUES(?,?,?,?,?,?,?)',
        '子项目必须具有完整的首版名称与类别档案',
        ('missing_profile_stage','profile_missing_v1','stocked',2,
         '尚未建档','u','2026-11-07T23:00:01.000Z'))
    blocked_reason('project stage event cannot predate project root creation',
        'INSERT INTO project_stage_events('
        'id,project_id,stage,project_version,reason,actor_id,created_at)'
        ' VALUES(?,?,?,?,?,?,?)',
        '子项目必须具有完整的首版名称与类别档案',
        ('invalid_phase_time_missing_profile','profile_missing_v1','stocked',2,
         '尚无档案','u','2026-11-07T22:59:59.000Z'))
    insert_raw('project_management_versions',
        id='profile_missing_v1_ver1',project_id='profile_missing_v1',
        version_no=1,name='补录正式项目初始名称',
        reason='补录第一版',actor_id='u',
        recorded_at='2026-11-07T23:00:00.000Z')
    blocked_reason('phase event must not predate project creation even with V1 profile',
        'INSERT INTO project_stage_events('
        'id,project_id,stage,project_version,reason,actor_id,created_at)'
        ' VALUES(?,?,?,?,?,?,?)',
        '子项目阶段事件不能早于项目建档或上一阶段事件',
        ('backdated_project_stage','profile_missing_v1','stocked',2,
         '倒签阶段','u','2026-11-07T22:59:59.000Z'))
    stage('profile_missing_v1','stocked',time='2026-11-07T23:00:01.000Z')
    ok('project enters stocked only after complete typed initial profile',
        row('SELECT status FROM projects WHERE id=?','profile_missing_v1')
         ['status']=='stocked')
    add('projects',id='audit_profile_p',code='AUDIT-PROFILE',
        name='首次建档的子项目名称',framework_id='f',
        category_id='audit_project_cat',created_by='u',
        created_at='2026-11-07T23:00:00.000Z')
    rootcols={x['name'] for x in db.execute('PRAGMA table_info(projects)')}
    ok('project root has no duplicated mutable name category or stage time',
        'name' not in rootcols and 'category_id' not in rootcols
        and 'updated_at' not in rootcols
        and 'code' in rootcols and 'framework_id' in rootcols)
    ok('project identity initial profile keeps typed category version and name',
        row('SELECT name,category_id,category_version,version_no '
            'FROM v_project_management_current WHERE project_id=?',
            'audit_profile_p')['name']=='首次建档的子项目名称'
        and row('SELECT category_version FROM v_project_management_current '
            "WHERE project_id='audit_profile_p'")['category_version']==1)
    blocked('project stable code cannot be silently changed after creation',
        'UPDATE projects SET code=? WHERE id=?',
        ('TEMP-ALTERED','audit_profile_p'))
    blocked('project root cannot be deleted without immutable business history',
        'DELETE FROM projects WHERE id=?',('audit_profile_p',))
    blocked('a project profile revision without changed facts is rejected',
        'INSERT INTO project_management_versions('
        'id,project_id,version_no,name,category_id,category_version,'
        'reason,actor_id,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)',
        ('audit_profile_repeat','audit_profile_p',2,
         '首次建档的子项目名称','audit_project_cat',1,'只换原因',
         'u','2026-11-07T23:05:00.000Z'))
    blocked('project category must be a real project-category dictionary type',
        'INSERT INTO project_management_versions('
        'id,project_id,version_no,name,category_id,category_version,'
        'reason,actor_id,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)',
        ('audit_profile_wrong_type','audit_profile_p',2,
         '新的项目名称','expense',1,'非法类别','u',
         '2026-11-07T23:05:00.000Z'))
    add('project_management_versions',id='audit_profile_v2',
        project_id='audit_profile_p',version_no=2,name='正式更名后的子项目',
        reason='业务名称核定',actor_id='u',
        recorded_at='2026-11-07T23:05:00.000Z')
    ok('project name changes use immutable full profile history',
        row('SELECT name FROM v_project_management_current WHERE project_id=?',
            'audit_profile_p')['name']=='正式更名后的子项目'
        and row('SELECT name FROM project_management_versions '
            "WHERE id='project_profile_audit_profile_p_v1'")['name']
            =='首次建档的子项目名称'
        and row('SELECT category_version FROM project_management_versions '
            "WHERE id='audit_profile_v2'")['category_version']==1)
    add('dictionary_item_versions',id='audit_cat_v2',
        item_id='audit_project_cat',version=2,name='输电设备维护',
        status='active',reason='类别名称修订',changed_by='u',
        changed_at='2026-11-07T23:06:00.000Z')
    blocked_reason('project cannot pin a category definition from the future',
        'INSERT INTO project_management_versions('
        'id,project_id,version_no,name,category_id,category_version,'
        'reason,actor_id,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)',
        '项目正式类别不能引用该版本登记之后才发布的字典名称',
        ('audit_profile_future_category','audit_profile_p',3,
         '正式更名后的子项目','audit_project_cat',2,
         '不能倒签字典版本','u','2026-11-07T23:05:30.000Z'))
    add('project_management_versions',id='audit_profile_v3',
        project_id='audit_profile_p',version_no=3,
        name='正式更名后的子项目',
        category_id='audit_project_cat',category_version=2,
        reason='采用新版类别名称',actor_id='u',
        recorded_at='2026-11-07T23:07:00.000Z')
    ok('category master redefinition never overwrites historic project choice',
        row('SELECT category_version FROM v_project_management_current '
            "WHERE project_id='audit_profile_p'")['category_version']==2
        and row('SELECT category_version FROM project_management_versions '
            "WHERE id='audit_profile_v2'")['category_version']==1
        and row('SELECT name FROM dictionary_item_versions '
            "WHERE id='audit_cat_v1'")['name']=='线路设备维护')
    blocked('published project identity version cannot be altered in place',
        'UPDATE project_management_versions SET name=? WHERE id=?',
        ('私自覆盖历史名称','audit_profile_v2'))
finally:
    db.execute('ROLLBACK TO full_project_profile_audit')
    db.execute('RELEASE full_project_profile_audit')

# Non-financial immutable factual audit: human duplicate-demand decisions,
# transactional idempotency receipts and canonical voltage classifications.
db.execute('SAVEPOINT full_import_security_audit')
try:
    add('demand_batches',id='audit_duplicate_batch',draft_json='[]',
        created_by='u',created_at='2026-11-07T23:00:00.000Z',
        updated_at='2026-11-07T23:00:00.000Z')
    add('demand_duplicate_reviews',id='audit_dup_decision',
        batch_id='audit_duplicate_batch',matched_demand_id='d',
        decision='separate',reason='同杆塔不同处理事项，经复核独立保留',
        actor_id='u',created_at='2026-11-07T23:01:00.000Z')
    blocked('human duplicate-demand decision is never silently overwritten',
        'UPDATE demand_duplicate_reviews SET decision=? WHERE id=?',
        ('link','audit_dup_decision'))
    blocked('human duplicate-demand decision history cannot be erased',
        'DELETE FROM demand_duplicate_reviews WHERE id=?',
        ('audit_dup_decision',))
    add('demand_duplicate_reviews',id='audit_dup_review_again',
        batch_id='audit_duplicate_batch',matched_demand_id='d',
        decision='link',reason='复核后追加新意见，不覆盖历史结论',
        actor_id='u',created_at='2026-11-07T23:02:00.000Z')
    ok('duplicate demand can be re-reviewed with a new auditable decision',
        row('SELECT COUNT(*) n FROM demand_duplicate_reviews '
            "WHERE batch_id='audit_duplicate_batch'")['n']==2)
    blocked('idempotency request cannot use nonexistent actor identity',
        'INSERT INTO ledger_requests(request_key,actor_id,request_hash,'
        'result_json,created_at) VALUES(?,?,?,?,?)',
        ('audit_ghost_receipt','ghost','a'*64,'{}',
         '2026-11-07T23:01:00.000Z'))
    blocked('idempotency receipt rejects unstructured response text',
        'INSERT INTO ledger_requests(request_key,actor_id,request_hash,'
        'result_json,created_at) VALUES(?,?,?,?,?)',
        ('audit_bad_json_receipt','u','a'*64,'garbled',
         '2026-11-07T23:01:00.000Z'))
    blocked('idempotency receipt rejects non-sha256 fingerprint',
        'INSERT INTO ledger_requests(request_key,actor_id,request_hash,'
        'result_json,created_at) VALUES(?,?,?,?,?)',
        ('audit_bad_hash_receipt','u','bad','{}',
         '2026-11-07T23:01:00.000Z'))
    add('ledger_requests',request_key='audit_receipt_valid',actor_id='u',
        request_hash='a'*64,result_json='{"result":"accepted"}',
        created_at='2026-11-07T23:02:00.000Z')
    blocked('confirmed idempotency result cannot be replayed with new answer',
        'UPDATE ledger_requests SET result_json=? WHERE request_key=?',
        ('{"result":"changed"}','audit_receipt_valid'))
    blocked('confirmed idempotency request cannot be removed',
        'DELETE FROM ledger_requests WHERE request_key=?',
        ('audit_receipt_valid',))
    blocked('voltage classification name cannot silently relabel old towers',
        'UPDATE voltage_levels SET name=? WHERE id=?',
        ('私自更名为错误电压','vol'))
    blocked('voltage classification code is stable despite label reorder',
        'UPDATE voltage_levels SET code=? WHERE id=?',
        ('220','vol'))
    db.execute('UPDATE voltage_levels SET sort_order=sort_order+1 WHERE id=?',
        ('vol',))
    ok('voltage display order can change without corrupting historical identity',
        row('SELECT code,name FROM voltage_levels WHERE id=?','vol')['code']
            =='110')
finally:
    db.execute('ROLLBACK TO full_import_security_audit')
    db.execute('RELEASE full_import_security_audit')

# Organizational history: a unit rename/reparent must not retroactively
# relabel a subproject managing unit used in an older profile.
db.execute('SAVEPOINT full_organization_history_audit')
try:
    ok('existing subproject managing unit pins one exact organization definition',
        row('SELECT managing_unit_version_id FROM project_management_versions '
            "WHERE id='mgt1'")['managing_unit_version_id']=='ou_v1')
    add('organizational_unit_versions',id='ou_v2',
        unit_id='ou',version_no=2,name='输电运检中心（正式更名）',
        parent_unit_id=None,status='active',reason='单位名称变更',
        actor_id='u',recorded_at='2026-11-08T02:00:00.000Z')
    ok('organizational rename retains old profile identity and original unit name',
        row('SELECT name FROM v_organizational_unit_current '
            "WHERE id='ou'")['name']=='输电运检中心（正式更名）'
        and row('SELECT name FROM organizational_unit_versions '
            "WHERE id='ou_v1'")['name']=='输电运检中心'
        and row('SELECT managing_unit_version_id FROM project_management_versions '
            "WHERE id='mgt2'")['managing_unit_version_id']=='ou_v1')
    blocked_reason('organization cannot create a content-free duplicate version',
        'INSERT INTO organizational_unit_versions('
        'id,unit_id,version_no,name,parent_unit_id,status,reason,actor_id,recorded_at)'
        ' VALUES(?,?,?,?,?,?,?,?,?)',
        '组织单位名称、上级和状态均未变动',
        ('ou_bad_duplicate','ou',3,'输电运检中心（正式更名）',
         None,'active','只有不同备注','u','2026-11-08T02:01:00.000Z'))
    blocked('organizational identity code is immutable',
        'UPDATE organizational_units SET code=? WHERE id=?',
        ('BAD-T-OPS','ou'))
    blocked('old unit definition cannot be silently overwritten',
        'UPDATE organizational_unit_versions SET name=? WHERE id=?',
        ('非法覆盖历史组织名','ou_v1'))
    blocked_reason('project managing unit cannot pin an organization version from the future',
        'INSERT INTO project_management_versions('
        'id,project_id,version_no,name,managing_unit_id,'
        'managing_unit_version_id,reason,actor_id,recorded_at)'
        ' VALUES(?,?,?,?,?,?,?,?,?)',
        '子项目归口单位历史不能引用未来才登记的组织定义版本',
        ('mgt_future_org','p',4,'无协议子项目','ou','ou_v2',
         '不能引用未来组织','u','2026-11-07T19:30:00.000Z'))
    blocked('project managing unit cannot pair different organization root and version',
        'INSERT INTO project_management_versions('
        'id,project_id,version_no,name,managing_unit_id,'
        'managing_unit_version_id,reason,actor_id,recorded_at)'
        ' VALUES(?,?,?,?,?,?,?,?,?)',
        ('mgt_cross_org','p',4,'无协议子项目','ou','childou_v1',
         '单位身份错配','u','2026-11-08T02:01:00.000Z'))
    add('project_management_versions',id='mgt_using_new_org',
        project_id='p',version_no=4,owner_id='u',manager_id='u',
        managing_unit_id='ou',managing_unit_version_id='ou_v2',
        planned_start_on='2026-11-08',planned_end_on='2026-12-31',
        preliminary_estimate_fen=8000,
        preliminary_estimate_basis='范围核定后估算',
        reason='正式确认新单位名称',actor_id='u',
        recorded_at='2026-11-08T02:02:00.000Z')
    ok('new project profile can explicitly select latest managing-unit definition',
        row('SELECT managing_unit_version_id FROM v_project_management_current '
            "WHERE project_id='p'")['managing_unit_version_id']=='ou_v2'
        and row('SELECT managing_unit_version_id FROM project_management_versions '
            "WHERE id='mgt1'")['managing_unit_version_id']=='ou_v1')
    add('organizational_unit_versions',id='childou_v2',
        unit_id='childou',version_no=2,name='输电班组',
        parent_unit_id=None,status='active',reason='班组正式调整为直属单位',
        actor_id='u',recorded_at='2026-11-08T03:00:00.000Z')
    ok('historic organization parent is preserved when its structure changes',
        row('SELECT parent_unit_id FROM organizational_unit_versions '
            "WHERE id='childou_v1'")['parent_unit_id']=='ou'
        and row('SELECT parent_unit_id FROM v_organizational_unit_current '
            "WHERE id='childou'")['parent_unit_id'] is None)

    # User's final terminology: managing unit is the subproject's
    # administrative owner/归口单位, NOT a performing/contracting/settling unit.
    profile_fields={x['name'] for x in db.execute(
        'PRAGMA table_info(project_management_versions)')}
    ok('subproject ownership uses exactly one optional managing-unit identity',
        {'managing_unit_id','managing_unit_version_id'}<=profile_fields
        and not {'responsible_unit_id','responsible_unit_version_id'}&profile_fields
        and row('SELECT managing_unit_id FROM project_management_versions '
                "WHERE id='project_profile_p_pending_v1'")['managing_unit_id']
            is None)
    add('project_management_versions',id='mgt_transfer_to_childou',
        project_id='p',version_no=5,owner_id='u',manager_id='u',
        managing_unit_id='childou',
        managing_unit_version_id='childou_v2',
        planned_start_on='2026-11-08',planned_end_on='2026-12-31',
        preliminary_estimate_fen=8000,
        preliminary_estimate_basis='范围核定后估算',
        reason='子项目归口从输电中心正式调整到班组',
        actor_id='u',recorded_at='2026-11-08T03:10:00.000Z')
    ok('transferring subproject managing unit preserves the former assignment',
        row('SELECT managing_unit_id FROM v_project_management_current '
            "WHERE project_id='p'")['managing_unit_id']=='childou'
        and row('SELECT managing_unit_id FROM project_management_versions '
            "WHERE id='mgt_using_new_org'")['managing_unit_id']=='ou')
    add('projects',id='another_project_same_managing_unit',
        code='AUDIT-ANOTHER-MANAGING-UNIT',name='另一归口同班组的子项目',
        framework_id='f',created_by='u',
        created_at='2026-11-08T03:11:00.000Z')
    add('project_management_versions',id='mgt_other_shared_unit',
        project_id='another_project_same_managing_unit',version_no=2,
        managing_unit_id='childou',
        managing_unit_version_id='childou_v2',
        reason='归口同一班组管理多个子项目',
        actor_id='u',recorded_at='2026-11-08T03:12:00.000Z')
    ok('same managing unit can own many subprojects without execution-unit facts',
        row('SELECT COUNT(DISTINCT project_id) n '
            'FROM v_project_management_current WHERE managing_unit_id=?',
            'childou')['n']>=2)
finally:
    db.execute('ROLLBACK TO full_organization_history_audit')
    db.execute('RELEASE full_organization_history_audit')

# Master reference catalogs are historical identities, not mutable
# lookups. All fresh versions must be no earlier than their object root.
db.execute('SAVEPOINT full_catalog_history_audit')
try:
    blocked_reason('dictionary history must never predate its dictionary root',
        'INSERT INTO dictionary_item_versions('
        'id,item_id,version,name,status,reason,changed_by,changed_at)'
        ' VALUES(?,?,?,?,?,?,?,?)',
        '字典正式定义不得早于根身份或上一历史版本',
        ('unit_bad_past','unit',3,'台', 'active','非法倒签','u',
         '2026-11-06T23:59:59.000Z'))
    blocked_reason('unchanged dictionary content cannot fake a new version',
        'INSERT INTO dictionary_item_versions('
        'id,item_id,version,name,status,reason,changed_by,changed_at)'
        ' VALUES(?,?,?,?,?,?,?,?)',
        '字典定义没有真实变化，不允许新增空版本',
        ('unit_bad_duplicate','unit',3,'组','active','空版本','u',
         '2026-11-07T00:05:00.000Z'))
    blocked_reason('work object historical version cannot predate root',
        'INSERT INTO work_object_versions('
        'id,work_object_id,version_no,name,object_position,attribution_unit,status,reason,'
        'changed_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        '作业对象正式版本不得倒签或早于根身份',
        ('obj_early','obj',2,'新绝缘子','body','logical_tower','active','倒签','u',
         '2026-11-06T23:59:59.000Z'))
    blocked_reason('same work object definition cannot create an empty version',
        'INSERT INTO work_object_versions('
        'id,work_object_id,version_no,name,object_position,attribution_unit,status,reason,'
        'changed_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        '作业对象定义无变化，不得新增空历史',
        ('obj_repeat','obj',2,'绝缘子','body','logical_tower','active','只改备注','u',
         '2026-11-07T00:01:00.000Z'))
    blocked_reason('operation version must change actual operation definition',
        'INSERT INTO operation_versions('
        'id,operation_id,version,name,status,work_object_id,work_object_version_no,'
        'default_unit_id,default_unit_version,reason,changed_by,changed_at)'
        ' VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        '操作类型正式版本没有真实定义变化，不允许空改版',
        ('op_duplicate','op',2,'更换','active','obj',1,'unit',1,
         '无实质定义变化','u','2026-11-07T23:10:00.000Z'))
    blocked_reason('operation definition cannot predate original template',
        'INSERT INTO operation_versions('
        'id,operation_id,version,name,status,work_object_id,work_object_version_no,'
        'default_unit_id,default_unit_version,reason,changed_by,changed_at)'
        ' VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        '操作类型完整定义不得早于根身份或上一正式版本',
        ('op_early','op',2,'拆除','active','obj',1,'unit',1,
         '倒签','u','2026-11-06T23:59:59.000Z'))
    add('reference_price_catalog',id='price_history_audit',
        code='AUDIT-PRICE',created_by='u',
        created_at='2026-11-07T23:10:00.000Z')
    blocked_reason('reference price history cannot predate catalog root',
        'INSERT INTO reference_price_versions(id,catalog_id,version_no,title,operation_id,operation_version,unit_id,unit_version,status,unit_price_fen,price_source,price_date,effective_on,basis,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        '参考价正式版本不能早于根目录或上一价格历史',
        ('price_bad_past','price_history_audit',1,'安装单价','op',1,
         'unit',1,'active',300,'标准参考','2026-11-07',
         '2026-11-07','历史价格依据','非法倒签','u',
         '2026-11-07T23:09:59.000Z'))
    add('reference_price_versions',id='price_v1',catalog_id='price_history_audit',
        version_no=1,title='单价依据',operation_id='op',operation_version=1,
        unit_id='unit',unit_version=1,status='active',unit_price_fen=300,
        price_source='标准参考',price_date='2026-11-07',
        effective_on='2026-11-07',basis='标准价格明细',reason='首次',
        created_by='u',created_at='2026-11-07T23:10:00.000Z')
    blocked_reason('reference price history needs real changed price or parameters',
        'INSERT INTO reference_price_versions(id,catalog_id,version_no,title,operation_id,operation_version,unit_id,unit_version,status,unit_price_fen,price_source,price_date,effective_on,basis,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        '参考价正式版本没有真实价格或分类依据变化，不允许空改版',
        ('price_repeat','price_history_audit',2,'单价依据','op',1,
         'unit',1,'active',300,'标准参考','2026-11-07',
         '2026-11-07','标准价格明细','只改原因','u',
         '2026-11-07T23:10:01.000Z'))
    blocked_reason('revised reference price cannot be backdated',
        'INSERT INTO reference_price_versions(id,catalog_id,version_no,title,operation_id,operation_version,unit_id,unit_version,status,unit_price_fen,price_source,price_date,effective_on,basis,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        '参考价正式版本不能早于根目录或上一价格历史',
        ('price_v2_bad','price_history_audit',2,'新单价','op',1,
         'unit',1,'active',450,'标准参考','2026-11-07',
         '2026-11-07','标准价格明细','倒签','u',
         '2026-11-07T23:09:59.000Z'))
finally:
    db.execute('ROLLBACK TO full_catalog_history_audit')
    db.execute('RELEASE full_catalog_history_audit')

# Complete append-only-history sweep: a formally published operation
# definition or voltage identity must remain even if no downstream record
# currently cites it.
db.execute('SAVEPOINT published_reference_delete_audit')
try:
    add('operations',id='op_delete_guard',code='OP-DELETE-CHECK',
        created_at='2026-11-07T23:10:00.000Z')
    add('operation_versions',id='op_delete_guard_v1',
        operation_id='op_delete_guard',version=1,
        name='独立正式操作定义',status='active',
        work_object_id='obj',work_object_version_no=1,
        default_unit_id='unit',default_unit_version=1,
        reason='正式发布',changed_by='u',
        changed_at='2026-11-07T23:10:00.000Z')
    blocked_reason('unreferenced published operation version remains immutable',
        'DELETE FROM operation_versions WHERE id=?',
        '操作类型正式历史不可删除',('op_delete_guard_v1',))
    add('voltage_levels',id='vol_delete_guard',code='AUDIT-35',
        name='35kV')
    blocked_reason('unreferenced voltage identity remains stable master data',
        'DELETE FROM voltage_levels WHERE id=?',
        '电压等级稳定身份不可删除',('vol_delete_guard',))
finally:
    db.execute('ROLLBACK TO published_reference_delete_audit')
    db.execute('RELEASE published_reference_delete_audit')

# Round 14 / user decisions: multi-device pricing per physical tower,
# exact per-settlement resolved-demand facts, actual scope over/under-runs,
# acknowledged closure with nonzero residuals, and zero-required-reason admin.
db.execute("SAVEPOINT user_round14_price_and_completion")
try:
    import json
    # Setup: fitting N anti-bird devices to ONE physical tower is an operation
    # on that tower, with unit "套". There is no extra tower multiplier.
    add("work_objects",id="bird_object",code="BIRD-DEVICE",
        created_at="2026-11-08T03:00:00.000Z")
    add("work_object_versions",id="bird_object_v1",
        work_object_id="bird_object",version_no=1,name="防鸟装置",
        object_position="body",attribution_unit="physical_tower",
        status="active",changed_by="u",
        recorded_at="2026-11-08T03:00:00.000Z")
    add("operations",id="bird_op",code="INSTALL-BIRD",
        created_at="2026-11-08T03:00:00.000Z")
    add("operation_versions",id="bird_op_v1",operation_id="bird_op",
        version=1,name="安装防鸟装置",status="active",
        work_object_id="bird_object",work_object_version_no=1,
        default_unit_id="unit",default_unit_version=1,
        changed_by="u",changed_at="2026-11-08T03:00:00.000Z")
    for kind,mode,base,unit,brackets in (
        ("unit","per_unit",0,200,[]),
        ("base","base_plus_unit",500,120,[]),
        ("bands","quantity_bracket",0,0,[
            {"min_quantity_scaled":10000,"max_quantity_scaled":10000,
             "base_fee_fen":500,"unit_price_fen":200},
            {"min_quantity_scaled":20000,"max_quantity_scaled":30000,
             "base_fee_fen":600,"unit_price_fen":150},
            {"min_quantity_scaled":40000,"max_quantity_scaled":None,
             "base_fee_fen":700,"unit_price_fen":120}])):
        add("reference_price_catalog",id="bird_catalog_"+kind,
            code="BIRD-"+kind.upper(),created_by="u",
            created_at="2026-11-08T03:00:00.000Z")
        add("reference_price_versions",id="bird_price_"+kind,
            catalog_id="bird_catalog_"+kind,version_no=1,
            title="防鸟装置试算"+kind,operation_id="bird_op",
            operation_version=1,unit_id="unit",unit_version=1,
            pricing_mode=mode,base_fee_fen=base,
            unit_price_fen=unit,quantity_brackets_json=json.dumps(brackets),
            status="active",price_source="仅测试示例",price_date="2026-11-08",
            effective_on="2026-11-08",
            basis="一基物理杆塔上本次安装数量",
            created_by="u",created_at="2026-11-08T03:01:00.000Z")
    def bird_rule_calc(rule_id, count):
        price=row("SELECT * FROM reference_price_versions WHERE id=?",rule_id)
        mode=price["pricing_mode"]
        if mode!="quantity_bracket":
            return price["base_fee_fen"]+count*price["unit_price_fen"]
        scaled=count*10000
        bands=json.loads(price["quantity_brackets_json"])
        match=[x for x in bands if scaled>=x["min_quantity_scaled"]
               and (x["max_quantity_scaled"] is None
                    or scaled<=x["max_quantity_scaled"])]
        assert len(match)==1,(count,bands)
        return match[0]["base_fee_fen"]+count*match[0]["unit_price_fen"]
    ok("one physical tower / 1,2,3,5 bird devices has linear per-unit prices",
        [bird_rule_calc("bird_price_unit",n) for n in (1,2,3,5)]
        ==[200,400,600,1000])
    ok("one physical tower base fee applies once, not once per device",
        [bird_rule_calc("bird_price_base",n) for n in (1,2,3,5)]
        ==[620,740,860,1100])
    ok("versioned quantity bands support 1,2,3 or arbitrarily many devices",
        [bird_rule_calc("bird_price_bands",n) for n in (1,2,3,5)]
        ==[700,900,1050,1300])
    def invalid_bird_bands(label, bands, expected):
        blocked_reason(label,
            'INSERT INTO reference_price_versions(id,catalog_id,version_no,title,operation_id,operation_version,unit_id,unit_version,pricing_mode,base_fee_fen,unit_price_fen,quantity_brackets_json,status,price_source,price_date,effective_on,basis,created_by,created_at) VALUES('+",".join("?" for _ in range(19))+")",
            expected,
            ("invalid_bird_"+label,"bird_catalog_bands",2,"错误分档",
             "bird_op",1,"unit",1,"quantity_bracket",0,0,
             json.dumps(bands),"active","测试","2026-11-08",
             "2026-11-08","测试","u","2026-11-08T03:02:00.000Z"))
    invalid_bird_bands(
        "overlap",[
            {"min_quantity_scaled":10000,"max_quantity_scaled":30000,
             "base_fee_fen":0,"unit_price_fen":100},
            {"min_quantity_scaled":20000,"max_quantity_scaled":None,
             "base_fee_fen":0,"unit_price_fen":100}],
        "计价分档范围必须按数量递增且互不重叠")
    invalid_bird_bands(
        "bad_interval",[
            {"min_quantity_scaled":30000,"max_quantity_scaled":20000,
             "base_fee_fen":0,"unit_price_fen":100}],
        "计价分档须包含有效数量上下限及非负的基位费/件单价")
    invalid_bird_bands(
        "negative_fee",[
            {"min_quantity_scaled":10000,"max_quantity_scaled":None,
             "base_fee_fen":-10,"unit_price_fen":100}],
        "计价分档须包含有效数量上下限及非负的基位费/件单价")
    invalid_bird_bands(
        "missing_upper",[
            {"min_quantity_scaled":10000,"base_fee_fen":0,
             "unit_price_fen":100}],
        "计价分档须包含有效数量上下限及非负的基位费/件单价")

    # Two real professional demands to resolve; approved scopes are soft.
    demand("r14_demand_a")
    demand("r14_demand_b")
    activate_demand("r14_demand_a")
    activate_demand("r14_demand_b")
    add("projects",id="r14_project",code="R14-P",name="需求量与费用可有差异",
        framework_id="f",created_by="u",
        created_at="2026-11-08T03:00:00.000Z")
    add("project_stage_events",id="r14_stock",project_id="r14_project",
        stage="stocked",project_version=2,actor_id="u",
        created_at="2026-11-08T03:01:00.000Z")
    for suffix,did,qty in (
        ("a","r14_demand_a",10000),("b","r14_demand_b",10000)):
        add("project_demand_scopes",id="r14_scope_"+suffix,
            project_id="r14_project",demand_id=did,demand_version=1,
            proposed_quantity_scaled=qty,proposed_amount_fen=1500,
            created_at="2026-11-08T03:01:00.000Z",
            updated_at="2026-11-08T03:01:00.000Z")
    add("project_approval_versions",id="r14_approval",
        project_id="r14_project",version_no=1,
        approved_budget_fen=200,snapshot_json="{}",
        created_at="2026-11-08T03:02:00.000Z")
    for suffix,did,qty in (
        ("a","r14_demand_a",10000),("b","r14_demand_b",10000)):
        add("project_approval_scope_versions",id="r14_aps_"+suffix,
            approval_version_id="r14_approval",project_scope_id="r14_scope_"+suffix,
            demand_id=did,demand_version=1,quantity_scaled=qty,
            approved_amount_fen=1500,snapshot_json="{}",
            created_at="2026-11-08T03:02:00.000Z")
    db.execute("UPDATE project_approval_versions SET status='approved',"
        "approved_by='u',approved_at='2026-11-08T03:03:00.000Z'"
        " WHERE id='r14_approval'")
    add("project_stage_events",id="r14_approved",project_id="r14_project",
        stage="approved",project_version=3,actor_id="u",
        created_at="2026-11-08T03:04:00.000Z")
    ok("formal project approval must own explicit demand scopes",
        row("SELECT COUNT(*) n FROM project_approval_scope_versions "
            "WHERE approval_version_id='r14_approval'")["n"]==2)

    for kind,name in (("labor","人工"),("material","材料")):
        add("project_cost_nodes",id="r14_fee_"+kind,
            project_id="r14_project",created_by="u",
            created_at="2026-11-08T03:05:00.000Z")
        add("project_cost_node_versions",id="r14_fee_"+kind+"_v1",
            node_id="r14_fee_"+kind,version_no=1,name=name,
            status="active",actor_id="u",recorded_at="2026-11-08T03:05:00.000Z")
    add("settlements",id="r14_st",project_id="r14_project",number="R14-ST",
        created_by="u",created_at="2026-11-08T03:06:00.000Z")
    add("settlement_items",id="r14_item_a_labor",settlement_id="r14_st",
        project_scope_id="r14_scope_a",cost_node_id="r14_fee_labor",
        created_at="2026-11-08T03:06:00.000Z")
    add("settlement_items",id="r14_item_a_material",settlement_id="r14_st",
        project_scope_id="r14_scope_a",cost_node_id="r14_fee_material",
        created_at="2026-11-08T03:06:00.000Z")
    add("settlement_items",id="r14_item_b_labor",settlement_id="r14_st",
        project_scope_id="r14_scope_b",cost_node_id="r14_fee_labor",
        created_at="2026-11-08T03:06:00.000Z")
    db.execute("SAVEPOINT project_total_checks")
    try:
        add("settlements", id="r14_total", project_id="r14_project", number="R14-TOTAL",
            created_by="u", created_at="2026-11-08T03:06:00.000Z")
        add("settlement_versions", id="r14_total_v1", settlement_id="r14_total",
            version_no=1, approval_version_id="r14_approval", change_type="initial",
            mode="project_total", amount_fen=999, created_by="u", recorded_at="2026-11-08T03:07:00.000Z")
        insert_raw("settlement_review_events", id="r14_total_submit", settlement_version_id="r14_total_v1",
            event_seq=1, action="submit", actor_id="u", recorded_at="2026-11-08T03:08:00.000Z")
        insert_raw("settlement_review_events", id="r14_total_approve", settlement_version_id="r14_total_v1",
            event_seq=2, action="approve", actor_id="u", recorded_at="2026-11-08T03:09:00.000Z",
            effective_on="2026-11-08")
        ok("project total can be approved with no detailed fee or demand resolution",
            row("SELECT amount_fen FROM v_settlement_effective_versions WHERE settlement_id='r14_total'")["amount_fen"] == 999
            and row("SELECT count(*) n FROM v_effective_settlement_items WHERE settlement_version_id='r14_total_v1'")["n"] == 0)
    finally:
        db.execute("ROLLBACK TO project_total_checks")
        db.execute("RELEASE project_total_checks")
    def r14_version(vid,number,action,at,qty_a,qty_b):
        add("settlement_versions",id=vid,mode="itemized",amount_fen=450,settlement_id="r14_st",
            version_no=number,
            previous_version_id=None if number==1 else "r14_sv1",
            approval_version_id="r14_approval",change_type=action,
            created_by="u",recorded_at=at)
        for i,(item,scope,amount) in enumerate((
            ("r14_item_a_labor","a",100),
            ("r14_item_a_material","a",150),
            ("r14_item_b_labor","b",200))):
            add("settlement_item_versions",id=vid+"_item_"+str(i),
                settlement_item_id=item,settlement_version_id=vid,
                approval_scope_version_id="r14_aps_"+scope,
                quantity_scaled=10000,amount_fen=amount,
                evidence="财务账证",scope_snapshot_json="{}")
        return vid
    r14_version("r14_sv1",1,"initial","2026-11-08T03:07:00.000Z",30000,5000)
    db.execute("SAVEPOINT optional_resolution")
    try:
        insert_raw("settlement_review_events", id="r14_no_resolution", settlement_version_id="r14_sv1",
            event_seq=1, action="submit", actor_id="u", recorded_at="2026-11-08T03:08:00.000Z")
        ok("itemized statement can be submitted without new demand resolutions",
            row("SELECT count(*) n FROM settlement_scope_results WHERE settlement_version_id='r14_sv1'")["n"]==0)
    finally:
        db.execute("ROLLBACK TO optional_resolution")
        db.execute("RELEASE optional_resolution")
    blocked_reason("cross-project or unmatched approval scope cannot be a demand result",
        "INSERT INTO settlement_scope_results("
        "id,settlement_version_id,project_scope_id,approval_scope_version_id,"
        "location_item_no,resolved_quantity_scaled)"
        " VALUES(?,?,?,?,?,?)",
        "本次结算需求解决结果须关联同项目当次批准的需求范围",
        ("r14_bad_scope","r14_sv1","scope","scopev1",1,10000))
    add("settlement_scope_results",id="r14_resolved_a1",
        settlement_version_id="r14_sv1",project_scope_id="r14_scope_a",
        approval_scope_version_id="r14_aps_a",
        resolved_quantity_scaled=30000)
    add("settlement_scope_results",id="r14_resolved_b1",
        settlement_version_id="r14_sv1",project_scope_id="r14_scope_b",
        approval_scope_version_id="r14_aps_b",
        resolved_quantity_scaled=5000)
    add("settlement_review_events",id="r14_submit1",
        settlement_version_id="r14_sv1",event_seq=1,action="submit",
        actor_id="u",recorded_at="2026-11-08T03:08:00.000Z")
    add("settlement_review_events",id="r14_approve1",
        settlement_version_id="r14_sv1",event_seq=2,action="approve",
        actor_id="u",recorded_at="2026-11-08T03:09:00.000Z",
        effective_on="2026-11-08")
    ok("one demand result per scope is counted once across labor and materials",
        row("SELECT COUNT(*) n FROM v_effective_demand_resolutions "
            "WHERE project_scope_id='r14_scope_a'")["n"]==1
        and row("SELECT resolved_quantity_scaled n "
            "FROM v_effective_demand_resolutions "
            "WHERE project_scope_id='r14_scope_a'")["n"]==30000
        and row("SELECT COUNT(*) n FROM v_effective_settlement_items "
            "WHERE project_scope_id='r14_scope_a'")["n"]==2)
    ok("one installment supports over-completed and under-completed approved demands",
        row("SELECT SUM(resolved_quantity_scaled) n "
            "FROM v_effective_demand_resolutions "
            "WHERE project_scope_id='r14_scope_a'")["n"]==30000
        and row("SELECT SUM(resolved_quantity_scaled) n "
            "FROM v_effective_demand_resolutions "
            "WHERE project_scope_id='r14_scope_b'")["n"]==5000)
    blocked_reason("published demand result history cannot be changed",
        "UPDATE settlement_scope_results SET resolved_quantity_scaled=1 "
        "WHERE id='r14_resolved_a1'",
        "需求解决结果不可原地修改")
    blocked_reason("demand-result record cannot be inserted after submission",
        "INSERT INTO settlement_scope_results("
        "id,settlement_version_id,project_scope_id,approval_scope_version_id,"
        "location_item_no,resolved_quantity_scaled)"
        " VALUES(?,?,?,?,?,?)",
        "本次结算需求解决结果须关联同项目当次批准的需求范围",
        ("r14_late_result","r14_sv1","r14_scope_a","r14_aps_a",1,10000))
    blocked_reason("published demand resolution cannot be deleted",
        "DELETE FROM settlement_scope_results WHERE id='r14_resolved_b1'",
        "需求解决结果历史不可删除")
    # The revised statement is a NEW COMPLETE version of both money and
    # the work actually resolved. Current progress replaces the old snapshot.
    r14_version("r14_sv2",2,"revision","2026-11-08T03:10:00.000Z",40000,5000)
    add("settlement_scope_results",id="r14_resolved_a2",
        settlement_version_id="r14_sv2",project_scope_id="r14_scope_a",
        approval_scope_version_id="r14_aps_a",resolved_quantity_scaled=40000)
    add("settlement_scope_results",id="r14_resolved_b2",
        settlement_version_id="r14_sv2",project_scope_id="r14_scope_b",
        approval_scope_version_id="r14_aps_b",resolved_quantity_scaled=5000)
    add("settlement_review_events",id="r14_submit2",
        settlement_version_id="r14_sv2",event_seq=1,action="submit",
        actor_id="u",recorded_at="2026-11-08T03:11:00.000Z")
    add("settlement_review_events",id="r14_approve2",
        settlement_version_id="r14_sv2",event_seq=2,action="approve",
        actor_id="u",recorded_at="2026-11-08T03:12:00.000Z",
        effective_on="2026-11-08")
    ok("revised settlement replaces rather than doubles prior resolved demand work",
        row("SELECT COUNT(*) n FROM v_effective_demand_resolutions "
            "WHERE project_scope_id='r14_scope_a'")["n"]==1
        and row("SELECT SUM(resolved_quantity_scaled) n "
            "FROM v_effective_demand_resolutions "
            "WHERE project_scope_id='r14_scope_a'")["n"]==40000
        and row("SELECT COUNT(*) n FROM settlement_scope_results "
            "WHERE project_scope_id='r14_scope_a'")["n"]==2)
    # A second INDEPENDENT settlement resolves another 1.0 unit of demand B.
    # Only its own accepted result is added; old settlement V1/V2 are not
    # double-counted.
    add("settlements",id="r14_st_second",project_id="r14_project",
        number="R14-ST-SECOND",created_by="u",
        created_at="2026-11-08T03:12:10.000Z")
    add("settlement_items",id="r14_second_item",
        settlement_id="r14_st_second",project_scope_id="r14_scope_b",
        cost_node_id="r14_fee_material",
        created_at="2026-11-08T03:12:11.000Z")
    add("settlement_versions",id="r14_sv_second",mode="itemized",amount_fen=250,
        settlement_id="r14_st_second",version_no=1,
        approval_version_id="r14_approval",change_type="initial",
        created_by="u",recorded_at="2026-11-08T03:12:12.000Z")
    add("settlement_item_versions",id="r14_second_itemv",
        settlement_item_id="r14_second_item",
        settlement_version_id="r14_sv_second",
        approval_scope_version_id="r14_aps_b",
        quantity_scaled=10000,amount_fen=250,
        evidence="第二次需求解决结算",scope_snapshot_json="{}")
    add("settlement_scope_results",id="r14_resolved_b_second",
        settlement_version_id="r14_sv_second",
        project_scope_id="r14_scope_b",
        approval_scope_version_id="r14_aps_b",
        resolved_quantity_scaled=10000)
    add("settlement_review_events",id="r14_submit_second",
        settlement_version_id="r14_sv_second",
        event_seq=1,action="submit",actor_id="u",
        recorded_at="2026-11-08T03:12:13.000Z")
    add("settlement_review_events",id="r14_approve_second",
        settlement_version_id="r14_sv_second",
        event_seq=2,action="approve",actor_id="u",
        recorded_at="2026-11-08T03:12:14.000Z",
        effective_on="2026-11-08")
    ok("two independently approved settlements sum actual resolved demand quantities",
        row("SELECT COUNT(*) n FROM v_effective_demand_resolutions "
            "WHERE project_scope_id='r14_scope_b'")["n"]==2
        and row("SELECT SUM(resolved_quantity_scaled) n "
            "FROM v_effective_demand_resolutions "
            "WHERE project_scope_id='r14_scope_b'")["n"]==15000
        and row("SELECT SUM(quantity_scaled) n "
            "FROM v_approval_scope_current "
            "WHERE project_scope_id='r14_scope_b'")["n"]==10000)
    # A privileged human can approve a legitimate change without a comment,
    # while the actor/time and formal decisions remain undeniable records.
    db.execute("SAVEPOINT r14_admin_optional_change_reason")
    try:
        add("project_change_orders",id="r14_no_reason_change",
            project_id="r14_project",code="R14-NO-REASON",
            base_approval_version_id="r14_approval",
            proposal_json="{}",created_by="u",
            created_at="2026-11-08T03:12:30.000Z")
        db.execute("UPDATE project_change_orders SET status='approved',"
            "decided_by='u',decided_at='2026-11-08T03:12:31.000Z'"
            " WHERE id='r14_no_reason_change'")
        ok("admin change approval needs true approver/time but no written reason",
            row("SELECT status,decision_reason FROM project_change_orders "
                "WHERE id='r14_no_reason_change'")["status"]=="approved"
            and row("SELECT decision_reason FROM project_change_orders "
                "WHERE id='r14_no_reason_change'")["decision_reason"] is None)
    finally:
        db.execute("ROLLBACK TO r14_admin_optional_change_reason")
        db.execute("RELEASE r14_admin_optional_change_reason")
    add("project_management_versions",id="r14_profile_change",
        project_id="r14_project",version_no=2,
        name="需求及费用允许结余和超额的子项目",
        actor_id="u",recorded_at="2026-11-08T03:12:31.000Z")
    ok("admin project profile change is versioned with blank reason",
        row("SELECT reason FROM project_management_versions "
            "WHERE id='r14_profile_change'")["reason"]==""
        and row("SELECT name FROM v_project_management_current "
            "WHERE project_id='r14_project'")["name"]
            =="需求及费用允许结余和超额的子项目")
    # A later installment may reconcile earlier resolved work without
    # recording any NEW completed quantity. The exact related demand is still
    # mandatory; zero is an explicit fact, not NULL or fake extra work.
    add("settlements",id="r14_prior_work_settle",project_id="r14_project",
        number="R14-PRIOR-WORK-COST",
        created_by="u",created_at="2026-11-08T03:12:15.000Z")
    add("settlement_items",id="r14_prior_work_item",
        settlement_id="r14_prior_work_settle",
        project_scope_id="r14_scope_a",cost_node_id="r14_fee_labor",
        created_at="2026-11-08T03:12:16.000Z")
    add("settlement_versions",id="r14_prior_work_sv",mode="itemized",amount_fen=80,
        settlement_id="r14_prior_work_settle",version_no=1,
        approval_version_id="r14_approval",change_type="initial",
        created_by="u",recorded_at="2026-11-08T03:12:17.000Z")
    add("settlement_item_versions",id="r14_prior_work_itemv",
        settlement_item_id="r14_prior_work_item",
        settlement_version_id="r14_prior_work_sv",
        approval_scope_version_id="r14_aps_a",
        quantity_scaled=0,amount_fen=80,
        evidence="此前已解决需求的费用补结",scope_snapshot_json="{}")
    add("settlement_scope_results",id="r14_prior_work_scope",
        settlement_version_id="r14_prior_work_sv",
        project_scope_id="r14_scope_a",
        approval_scope_version_id="r14_aps_a",
        resolved_quantity_scaled=0,
        evidence="本次不新增解决数量，只结算此前工作")
    add("settlement_review_events",id="r14_prior_work_submit",
        settlement_version_id="r14_prior_work_sv",
        event_seq=1,action="submit",actor_id="u",
        recorded_at="2026-11-08T03:12:18.000Z")
    add("settlement_review_events",id="r14_prior_work_approve",
        settlement_version_id="r14_prior_work_sv",
        event_seq=2,action="approve",actor_id="u",
        recorded_at="2026-11-08T03:12:19.000Z",effective_on="2026-11-08")
    ok("financial-only installment associates its demand without inventing additional work",
        row("SELECT SUM(resolved_quantity_scaled) n "
            "FROM v_effective_demand_resolutions "
            "WHERE project_scope_id='r14_scope_a'")["n"]==40000
        and row("SELECT COUNT(*) n FROM v_effective_demand_resolutions "
            "WHERE project_scope_id='r14_scope_a'")["n"]==2
        and row("SELECT SUM(amount_fen) n "
            "FROM v_effective_settlement_items "
            "WHERE project_scope_id='r14_scope_a'")["n"]==330)
    # A new actual expense above the tiny project budget remains truthful,
    # and incomplete demand B plus unmatched costs are no close-out barrier.
    add("cost_entries",id="r14_real_cost",project_id="r14_project",
        cost_node_id="r14_fee_labor",created_by="u",
        created_at="2026-11-08T03:13:00.000Z")
    add("cost_versions",id="r14_real_cost_v1",entry_id="r14_real_cost",
        cost_node_version_id="r14_fee_labor_v1",version_no=1,
        status="active",title="实际费用超过批准预算",
        occurred_on="2026-11-08",amount_fen=2000,
        evidence="真实发生账证",confirmed_by="u",
        confirmed_at="2026-11-08T03:14:00.000Z",
        request_key="r14_cost")
    ok("real costs may exceed budget with no mandatory reason",
        row("SELECT amount_fen FROM v_cost_current "
            "WHERE entry_id='r14_real_cost'")["amount_fen"]==2000
        and row("SELECT reason FROM cost_versions "
            "WHERE id='r14_real_cost_v1'")["reason"]=="")
    add("physical_towers",id="r14_admin_physical",tower_code="R14-PT",
        created_by="u",created_at="2026-11-08T03:13:00.000Z",
        updated_at="2026-11-08T03:13:00.000Z")
    db.execute("UPDATE physical_towers SET model='运维塔型测试',"
        "version=2,updated_by='u',"
        "updated_at='2026-11-08T03:14:00.000Z' "
        "WHERE id='r14_admin_physical'")
    ok("administrator may update equipment without entering a reason",
        row("SELECT change_reason FROM physical_towers "
            "WHERE id='r14_admin_physical'")["change_reason"]==""
        and row("SELECT reason FROM physical_tower_history "
            "WHERE physical_tower_id='r14_admin_physical' AND version=2")
            ["reason"]=="")
    add("project_closures",id="r14_close",
        project_id="r14_project",approval_version_id="r14_approval",
        close_snapshot_json='{"demand_reviewed":true,"finance_reviewed":true}',
        closed_by="u",closed_at="2026-11-08T03:15:00.000Z")
    add("project_stage_events",id="r14_close_stage",
        project_id="r14_project",stage="closed",project_version=4,
        actor_id="u",created_at="2026-11-08T03:16:00.000Z")
    ok("explicit closure accepts demand surplus, shortage and unsettled excess cost",
        row("SELECT status FROM projects WHERE id='r14_project'")["status"]
        =="closed"
        and row("SELECT reason FROM project_closures "
            "WHERE id='r14_close'")["reason"]==""
        and row("SELECT amount_fen FROM v_cost_current "
            "WHERE entry_id='r14_real_cost'")["amount_fen"]==2000
        and row("SELECT SUM(resolved_quantity_scaled) n "
            "FROM v_effective_demand_resolutions "
            "WHERE project_scope_id='r14_scope_b'")["n"]==15000)
finally:
    db.execute("ROLLBACK TO user_round14_price_and_completion")
    db.execute("RELEASE user_round14_price_and_completion")

# Round 15: a professional demand is reserved EXCLUSIVELY at project
# association time, not at a later formal approval. Release is explicit,
# audited and followed by a new valid link (old histories never rewritten).
db.execute("SAVEPOINT r15_demand_link_exclusivity")
try:
    demand("r15_d")
    activate_demand("r15_d")
    for suffix in ("a","b","c"):
        add("projects",id="r15_p_"+suffix,code="R15-P-"+suffix,
            name="需求互斥关联项目"+suffix,framework_id="f",
            created_by="u",created_at="2026-11-08T04:00:00.000Z")
    add("project_demand_scopes",id="r15_scope_a",project_id="r15_p_a",
        demand_id="r15_d",demand_version=1,
        proposed_quantity_scaled=10000,
        created_at="2026-11-08T04:00:01.000Z",
        updated_at="2026-11-08T04:00:01.000Z")
    ok("first project immediately and exclusively holds a professional demand",
        row("SELECT project_id FROM v_project_demand_binding_current "
            "WHERE demand_id='r15_d'")["project_id"]=="r15_p_a"
        and row("SELECT action,actor_id,event_seq FROM project_demand_link_events "
            "WHERE project_scope_id='r15_scope_a'")["action"]=="linked"
        and row("SELECT actor_id FROM project_demand_link_events "
            "WHERE project_scope_id='r15_scope_a'")["actor_id"]=="u")
    blocked_reason("second reserved project cannot link demand before approval",
        "INSERT INTO project_demand_scopes("
        "id,project_id,demand_id,demand_version,proposed_quantity_scaled,"
        "created_by,created_at,updated_at)"
        " VALUES(?,?,?,?,?,?,?,?)",
        "需求已关联其他子项目，须先由原子项目显式解绑",
        ("r15_illegal_b","r15_p_b","r15_d",1,20000,"u",
         "2026-11-08T04:00:02.000Z","2026-11-08T04:00:02.000Z"))
    blocked_reason("linked demand cannot be cancelled even before project approval",
        "INSERT INTO demand_lifecycle_events("
        "id,demand_id,event_seq,from_status,to_status,actor_id,recorded_at)"
        " VALUES(?,?,?,?,?,?,?)",
        "需求尚关联子项目，须先完成明确解绑",
        ("r15_cancel_held","r15_d",3,"active","cancelled","u",
         "2026-11-08T04:00:02.000Z"))
    blocked_reason("project identity cannot be reassigned by editing a linked scope",
        "UPDATE project_demand_scopes SET project_id=? WHERE id=?",
        "需求关联的稳定项目/需求身份与创建人不可直接改写",
        ("r15_p_b","r15_scope_a"))
    blocked_reason("wrong link action cannot skip an event sequence",
        "INSERT INTO project_demand_link_events("
        "id,project_scope_id,event_seq,action,actor_id,recorded_at)"
        " VALUES(?,?,?,?,?,?)",
        "项目需求关联事件版本必须连续",
        ("r15_bad_sequence","r15_scope_a",3,"released","u",
         "2026-11-08T04:00:03.000Z"))
    blocked_reason("same project cannot link an already linked scope twice",
        "INSERT INTO project_demand_link_events("
        "id,project_scope_id,event_seq,action,actor_id,recorded_at)"
        " VALUES(?,?,?,?,?,?)",
        "需求关联与解绑必须按当前状态交替",
        ("r15_double_link","r15_scope_a",2,"linked","u",
         "2026-11-08T04:00:03.000Z"))
    blocked_reason("backdated link-release history is rejected",
        "INSERT INTO project_demand_link_events("
        "id,project_scope_id,event_seq,action,actor_id,recorded_at)"
        " VALUES(?,?,?,?,?,?)",
        "需求关联解绑操作不能早于建档或上一事件",
        ("r15_backdated_release","r15_scope_a",2,"released","u",
         "2026-11-07T04:00:03.000Z"))
    blocked("unknown releasing actor has no authenticated user FK",
        "INSERT INTO project_demand_link_events("
        "id,project_scope_id,event_seq,action,actor_id,recorded_at)"
        " VALUES('r15_unknown','r15_scope_a',2,'released','ghost',"
        "'2026-11-08T04:00:03.000Z')")
    add("project_demand_link_events",id="r15_release_a",
        project_scope_id="r15_scope_a",event_seq=2,
        action="released",actor_id="u",
        recorded_at="2026-11-08T04:00:04.000Z")
    ok("explicit unlink releases the demand with exact immutable history",
        row("SELECT COUNT(*) n FROM v_project_demand_binding_current "
            "WHERE demand_id='r15_d'")["n"]==0
        and row("SELECT GROUP_CONCAT(action,',') a "
            "FROM project_demand_link_events "
            "WHERE project_scope_id='r15_scope_a' ORDER BY event_seq")["a"]
            =="linked,released")
    blocked_reason("duplicate release must not create a false history event",
        "INSERT INTO project_demand_link_events("
        "id,project_scope_id,event_seq,action,actor_id,recorded_at)"
        " VALUES('r15_double_release','r15_scope_a',3,'released','u',"
        "'2026-11-08T04:00:05.000Z')",
        "需求关联与解绑必须按当前状态交替")
    blocked_reason("project link cannot reserve only part of a demand",
        "INSERT INTO project_demand_scopes("
        "id,project_id,demand_id,demand_version,proposed_quantity_scaled,"
        "created_by,created_at,updated_at)"
        " VALUES(?,?,?,?,?,?,?,?)",
        "项目必须完整承接原需求当前所有未解决位置及剩余数量",
        ("r15_partial_link","r15_p_b","r15_d",1,20000,"u",
         "2026-11-08T04:00:05.500Z","2026-11-08T04:00:05.500Z"))
    add("project_demand_scopes",id="r15_scope_b",
        project_id="r15_p_b",demand_id="r15_d",
        demand_version=1,proposed_quantity_scaled=10000,
        created_at="2026-11-08T04:00:06.000Z",
        updated_at="2026-11-08T04:00:06.000Z")
    ok("second project successfully binds after first project's explicit release",
        row("SELECT project_id FROM v_project_demand_binding_current "
            "WHERE demand_id='r15_d'")["project_id"]=="r15_p_b"
        and row("SELECT COUNT(*) n FROM project_demand_scopes "
            "WHERE demand_id='r15_d'")["n"]==2)
    blocked_reason("former project cannot regrab demand while new project holds it",
        "INSERT INTO project_demand_link_events("
        "id,project_scope_id,event_seq,action,actor_id,recorded_at)"
        " VALUES('r15_regrab','r15_scope_a',3,'linked','u',"
        "'2026-11-08T04:00:07.000Z')",
        "需求仍由另一子项目关联，必须先显式解绑")
    blocked_reason("third project also cannot grab the same currently linked demand",
        "INSERT INTO project_demand_scopes("
        "id,project_id,demand_id,demand_version,proposed_quantity_scaled,"
        "created_by,created_at,updated_at)"
        " VALUES(?,?,?,?,?,?,?,?)",
        "需求已关联其他子项目，须先由原子项目显式解绑",
        ("r15_illegal_c","r15_p_c","r15_d",1,10000,"u",
         "2026-11-08T04:00:07.000Z","2026-11-08T04:00:07.000Z"))
    blocked_reason("historical linked/released events can never be rewritten",
        "UPDATE project_demand_link_events SET action='linked' "
        "WHERE id='r15_release_a'",
        "已记录需求关联/解绑历史不得修改")
    blocked_reason("linked/released audit history cannot be deleted",
        "DELETE FROM project_demand_link_events WHERE id='r15_release_a'",
        "已记录需求关联/解绑历史不得删除")
    blocked_reason("project-demand root with history cannot be deleted",
        "DELETE FROM project_demand_scopes WHERE id='r15_scope_a'",
        "已建立的需求关联及解绑历史不可删除")
    add("project_demand_link_events",id="r15_release_b",
        project_scope_id="r15_scope_b",event_seq=2,
        action="released",actor_id="u",
        recorded_at="2026-11-08T04:00:08.000Z")
    add("project_demand_link_events",id="r15_relink_a",
        project_scope_id="r15_scope_a",event_seq=3,
        action="linked",actor_id="u",
        recorded_at="2026-11-08T04:00:09.000Z")
    ok("same first project can explicitly relink its stable historical scope",
        row("SELECT project_id FROM v_project_demand_binding_current "
            "WHERE demand_id='r15_d'")["project_id"]=="r15_p_a"
        and row("SELECT MAX(event_seq) n FROM project_demand_link_events "
            "WHERE project_scope_id='r15_scope_a'")["n"]==3)
    demand("r15_cancelled")
    add("demand_lifecycle_events",id="r15_cancelled_event",
        demand_id="r15_cancelled",event_seq=2,from_status="pending",
        to_status="cancelled",actor_id="u",
        recorded_at="2026-11-08T04:01:00.000Z")
    blocked_reason("cancelled professional demand cannot be newly linked",
        "INSERT INTO project_demand_scopes("
        "id,project_id,demand_id,demand_version,proposed_quantity_scaled,"
        "created_by,created_at,updated_at)"
        " VALUES(?,?,?,?,?,?,?,?)",
        "已取消需求不能再关联子项目",
        ("r15_cancelled_scope","r15_p_c","r15_cancelled",1,10000,
         "u","2026-11-08T04:02:00.000Z",
         "2026-11-08T04:02:00.000Z"))
    demand("r15_release_then_cancel")
    add("project_demand_scopes",id="r15_cancel_scope",
        project_id="r15_p_c",demand_id="r15_release_then_cancel",
        demand_version=1,proposed_quantity_scaled=10000,
        created_at="2026-11-08T04:02:00.000Z",
        updated_at="2026-11-08T04:02:00.000Z")
    add("project_demand_link_events",id="r15_free_cancel_scope",
        project_scope_id="r15_cancel_scope",event_seq=2,action="released",
        actor_id="u",recorded_at="2026-11-08T04:02:01.000Z")
    add("demand_lifecycle_events",id="r15_cancel_lifecycle",
        demand_id="r15_release_then_cancel",event_seq=2,
        from_status="pending",to_status="cancelled",actor_id="u",
        recorded_at="2026-11-08T04:02:02.000Z")
    blocked_reason("historically linked scope cannot rebind cancelled demand",
        "INSERT INTO project_demand_link_events("
        "id,project_scope_id,event_seq,action,actor_id,recorded_at)"
        " VALUES('r15_illegal_cancel_rebind','r15_cancel_scope',3,"
        "'linked','u','2026-11-08T04:02:03.000Z')",
        "已取消需求不得再次建立关联")
    demand("r15_draft_reference")
    add("project_demand_scopes",id="r15_draft_scope",
        project_id="r15_p_c",demand_id="r15_draft_reference",
        demand_version=1,proposed_quantity_scaled=10000,
        created_at="2026-11-08T04:03:00.000Z",
        updated_at="2026-11-08T04:03:00.000Z")
    stage("r15_p_c","stocked",time="2026-11-08T04:03:00.000Z")
    add("project_approval_versions",id="r15_draft_ap",
        project_id="r15_p_c",version_no=1,snapshot_json="{}",
        approved_budget_fen=1000,
        created_at="2026-11-08T04:03:00.000Z")
    add("project_approval_scope_versions",id="r15_draft_aps",
        approval_version_id="r15_draft_ap",
        project_scope_id="r15_draft_scope",
        demand_id="r15_draft_reference",demand_version=1,
        quantity_scaled=10000,snapshot_json="{}",
        created_at="2026-11-08T04:03:00.000Z")
    blocked_reason("demand cannot be unlinked while still in an unfinished approval draft",
        "INSERT INTO project_demand_link_events("
        "id,project_scope_id,event_seq,action,actor_id,recorded_at)"
        " VALUES('r15_bad_draft_release','r15_draft_scope',2,"
        "'released','u','2026-11-08T04:03:01.000Z')",
        "仍有立项或变更草稿引用需求")
    db.execute("DELETE FROM project_approval_scope_versions "
        "WHERE id='r15_draft_aps'")
    add("project_demand_link_events",id="r15_valid_draft_release",
        project_scope_id="r15_draft_scope",event_seq=2,
        action="released",actor_id="u",
        recorded_at="2026-11-08T04:03:02.000Z")
    ok("removing unapproved scope draft permits explicit release without deleting history",
        row("SELECT COUNT(*) n FROM v_project_demand_binding_current "
            "WHERE demand_id='r15_draft_reference'")["n"]==0
        and row("SELECT action FROM project_demand_link_events "
            "WHERE id='r15_valid_draft_release'")["action"]=="released")
finally:
    db.execute("ROLLBACK TO r15_demand_link_exclusivity")
    db.execute("RELEASE r15_demand_link_exclusivity")

# A formally approved active project retains exclusive demand ownership.
# A completed project's historical approved scopes remain immutable, but
# unfinished demand ownership may be released upon formal closeout.
db.execute("SAVEPOINT r15_formal_reassignment")
try:
    for scope_id,label in (("scope2","newly approved scope"),("scope","original retained scope")):
        blocked_reason("active project may not release "+label,
            "INSERT INTO project_demand_link_events("
            "id,project_scope_id,event_seq,action,actor_id,recorded_at)"
            " VALUES(?,?,?,?,?,?)",
            "最新版正式批准范围仍包含需求；只允许未完成需求在项目正式结项后释放",
            ("r15_illegal_"+scope_id,scope_id,2,"released","u",
             "2026-11-08T04:03:00.000Z"))
    ok("closure released unfinished demand while preserving approved history",
        row("SELECT project_id FROM v_project_demand_binding_current "
            "WHERE demand_id='dnull'")["project_id"]=="pnext"
        and row("SELECT COUNT(*) n FROM project_approval_scope_versions "
                "WHERE project_scope_id='snull'")["n"]==1)
    blocked_reason("closed project's release cannot be repeated",
        "INSERT INTO project_demand_link_events("
        "id,project_scope_id,event_seq,action,actor_id,recorded_at)"
        " VALUES('r15_duplicate_close_release','snull',3,'released','u',"
        "'2026-11-08T04:07:00.000Z')",
        "需求关联与解绑必须按当前状态交替")
finally:
    db.execute("ROLLBACK TO r15_formal_reassignment")
    db.execute("RELEASE r15_formal_reassignment")


# Round 16: actual work object vs physical target vs material, standard
# versioned work factors, per-location work, immutable reference rules and
# price evaluations, partial project scope, historic quote freeze, NO silent
# zero totals or duplicate project charges. All amounts are illustrative.
db.execute("SAVEPOINT r16_full_price_architecture")
try:
    import json
    from decimal import Decimal

    def r16_price(name, *, mode="base_plus_unit", op="r16_op",
                  op_version=1, base=0, unit=0, scope="work_location",
                  params=None, components=None, brackets=None, work_mode="both",
                  conditions=None, created_at="2026-11-08T04:42:00.000Z"):
        add("reference_price_catalog",id="r16_cat_"+name,
            code="R16-"+name.upper(),created_by="u",
            created_at="2026-11-08T04:40:00.000Z")
        add("reference_price_versions",id="r16_price_"+name,
            catalog_id="r16_cat_"+name,version_no=1,
            title="第十六轮参考价 "+name,operation_id=op,
            operation_version=op_version,unit_id="unit",unit_version=1,
            pricing_mode=mode,pricing_scope=scope,work_mode=work_mode,
            additional_conditions_json=json.dumps(conditions or {}),
            calculation_params_json=json.dumps(params or {},ensure_ascii=False),
            fee_components_json=json.dumps(components or [],ensure_ascii=False),
            quantity_brackets_json=json.dumps(brackets or [],ensure_ascii=False),
            base_fee_fen=base,unit_price_fen=unit,
            status="active",price_source="仅用于隔离契约测试的假设价格",
            price_date="2026-11-08",
            effective_on="2026-11-08",basis="计价规则测试",
            created_by="u",created_at=created_at)
        return "r16_price_"+name

    def r16_eval(name, *, did, ver, scope_id=None):
        add("reference_price_evaluations",id=name,demand_id=did,
            demand_version=ver,approval_scope_version_id=scope_id,
            pricing_date="2026-11-08",engine_version="r16-demo-v1",
            input_basis_json='{"confirmed_source":"site-survey"}',
            created_by="u",created_at="2026-11-08T04:50:00.000Z")
        return name

    def r16_line(name, ev, item, q, money, price="r16_price_base"):
        add("reference_price_evaluation_lines",id=name,evaluation_id=ev,
            location_item_no=item,coverage_key="main",
            reference_price_version_id=price,quantity_scaled=q,
            amount_fen=money,
            calculation_inputs_json=json.dumps(
                {"quantity_scaled":q,"pricing_scope":"work_location",
                 "rounding":"half-up"}),
            calculation_trace_json=json.dumps(
                {"base_fee_fen":10000,"unit_price_fen":2000,
                 "computed_amount_fen":money}))

    def r16_final(ev):
        db.execute("UPDATE reference_price_evaluations SET status='final',"
            "finalized_by='u',finalized_at='2026-11-08T05:00:00.000Z'"
            " WHERE id=?",(ev,))

    add("work_objects",id="r16_object",code="R16-BIRD",
        created_at="2026-11-08T04:20:00.000Z")
    add("work_object_versions",id="r16_object_v1",
        work_object_id="r16_object",version_no=1,
        name="杆塔基础",object_position="body",attribution_unit="physical_tower",
        status="active",
        changed_by="u",recorded_at="2026-11-08T04:21:00.000Z")
    add("operations",id="r16_op",code="R16-INSTALL-BIRD",
        created_at="2026-11-08T04:21:00.000Z")
    feature_config=json.dumps([{"key":"r16_terrain","label":"地形","scope":"location","source":"manual","type":"select",
        "enabled":True,"pricing":True,"requirement":"pricing"}])
    add("operation_versions",id="r16_op_v1",operation_id="r16_op",
        version=1,name="基础修理",status="active",
        work_object_id="r16_object",work_object_version_no=1,
        default_unit_id="unit",default_unit_version=1,
        attributes_schema_json=feature_config,
        changed_by="u",changed_at="2026-11-08T04:22:00.000Z")
    blocked_reason("operation feature must have a real official factor version",
        "INSERT INTO operation_versions(id,operation_id,version,name,"
        "status,work_object_id,work_object_version_no,default_unit_id,"
        "default_unit_version,attributes_schema_json,changed_by,changed_at)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        "操作属性须包含稳定身份及明确层级",
        ("r16_bad_operation_feature","r16_op",2,"非法作业特征",
         "active","r16_object",1,"unit",1,
         '[{"factor_id":"ghost","source":"asset","required":true}]',
         "u","2026-11-08T04:30:00.000Z"))
    add("dictionary_types",id="tower_material",title="杆塔材质")
    for identity,label in [("angle","角钢塔"),("pipe","钢管杆")]:
        add("dictionary_items",id=identity,type_id="tower_material",
            code="TOWER_MATERIAL_"+identity.upper(),created_at="2026-11-08T04:22:00.000Z")
        add("dictionary_item_versions",id=identity+"_v1",item_id=identity,version=1,
            name=label,status="active",sort_order=100,fields_json="[]",
            changed_by="u",changed_at="2026-11-08T04:22:00.000Z")
    add("physical_towers",id="r16_pt16",tower_code="R16-PT16",
        tower_material="angle",created_by="u",created_at="2026-11-08T04:22:00.000Z")
    add("physical_towers",id="r16_pt17",tower_code="R16-PT17",
        tower_material="pipe",created_by="u",created_at="2026-11-08T04:22:00.000Z")
    def r16_locations(qs=(30000,20000,40000)):
        return [{
            "location_kind":"physical_tower","physical_tower_id":tower,
            "quantity_scaled":qty,
            "attributes":{"r16_terrain":"mountain"},
            "location_snapshot_json":{"label":label}}
            for tower,qty,label in zip(("pt","r16_pt16","r16_pt17"),
                qs,("#15塔","#16塔","#17塔"))]
    add("demands",id="r16_d",demand_no="R16-D-001",
        physical_tower_id="pt",context_line_id="line",
        line_name_snapshot="220kV现场某线路",tower_no_snapshot="#15",
        object_position="body",attribution_unit="physical_tower",
        operation_id="r16_op",operation_version=1,
        operation_snapshot="基础修理",
        work_object_id="r16_object",work_object_snapshot="杆塔基础",
        target_object="各塔防鸟装置",quantity_scaled=90000,
        unit_id="unit",unit_version=1,unit_snapshot="套",
        completion_standard="安装验收合格",problem_description="鸟害隐患",
        expected_on="2027-06-30",
        initial_work_locations_json=json.dumps(
            r16_locations(),ensure_ascii=False),
        created_by="u",created_at="2026-11-08T04:30:00.000Z")
    add("demand_lifecycle_events",id="activate_r16_d",
        demand_id="r16_d",event_seq=2,from_status="pending",
        to_status="active",actor_id="u",
        recorded_at="2026-11-08T04:31:00.000Z")
    facts=list(db.execute(
        "SELECT location_item_no,physical_tower_id,quantity_scaled "
        "FROM (SELECT item_no AS location_item_no,physical_tower_id,quantity_scaled "
        "FROM demand_version_work_locations WHERE demand_id='r16_d' "
        "AND demand_version=1) ORDER BY location_item_no"))
    ok("one demand holds 3 real independent physical towers with 3,2,4 units",
        [(x["physical_tower_id"],x["quantity_scaled"]) for x in facts]
        ==[("pt",30000),("r16_pt16",20000),("r16_pt17",40000)]
        and sum(x["quantity_scaled"] for x in facts)==90000)
    ok("standard work object and specific material master remain independent",
        row("SELECT COUNT(*) n FROM sqlite_master WHERE name='r16_object'")["n"]==0
        and row("SELECT work_object_id FROM operation_versions "
            "WHERE id='r16_op_v1'")["work_object_id"]=="r16_object"
        and len(db.execute("SELECT 1 FROM demand_material_version_items "
            "WHERE demand_id='r16_d'").fetchall())==0)
    blocked_reason("published demand cannot accept forged extra work location",
        "INSERT INTO demand_version_work_locations("
        "demand_id,demand_version,item_no,location_kind,physical_tower_id,"
        "quantity_scaled) VALUES(?,?,?,?,?,?)",
        "需求逐位置明细只能从不可变正式需求版本完整快照原子投影",
        ("r16_d",1,4,"physical_tower","r16_pt17",10000))
    blocked_reason("published work location cannot have its site or quantity overwritten",
        "UPDATE demand_version_work_locations SET quantity_scaled=50000 "
        "WHERE demand_id='r16_d' AND demand_version=1 AND item_no=1",
        "需求正式版本的逐位置工作量和现场特征不可覆盖")
    blocked_reason("root total cannot disagree with multi-location sum",
        "INSERT INTO demands(id,demand_no,physical_tower_id,context_line_id,"
        "line_name_snapshot,tower_no_snapshot,object_position,attribution_unit,"
        "operation_id,operation_version,operation_snapshot,work_object_id,"
        "work_object_snapshot,target_object,quantity_scaled,unit_id,unit_version,"
        "unit_snapshot,completion_standard,problem_description,created_by,"
        "created_at,initial_work_locations_json) VALUES("
        +",".join("?" for _ in range(23))+")",
        "正式需求版本总工作量必须等于全部作业位置数量之和",
        ("r16_wrong_sum","R16-WRONG-SUM","pt","line","某线路","#15",
        "body","physical_tower","r16_op",1,"基础修理","r16_object",
        "杆塔基础","杆塔基础",10000,"unit",1,"套","合格","隐患",
        "u","2026-11-08T04:31:00.000Z",json.dumps(r16_locations())))

    # Fixed, whole-tier, progressive, group, rate, composite and min/max
    # are defined by immutable concrete parameters. Math stays in Python/app.
    r16_price("base",base=10000,unit=2000)
    r16_price("per",mode="per_unit",unit=2000)
    r16_price("fixed",mode="fixed",unit=20000)
    r16_price("whole",mode="quantity_bracket",brackets=[
        {"min_quantity_scaled":10000,"max_quantity_scaled":30000,
         "base_fee_fen":10000,"unit_price_fen":2000},
        {"min_quantity_scaled":40000,"max_quantity_scaled":None,
         "base_fee_fen":12000,"unit_price_fen":1500}])
    r16_price("progressive",mode="progressive_bracket",params={
        "tiers":[{"up_to_quantity_scaled":30000,"unit_price_fen":10000},
                 {"up_to_quantity_scaled":None,"unit_price_fen":8000}]})
    r16_price("group",mode="group",params={
        "group_size_scaled":30000,"group_fee_fen":10000,
        "min_amount_fen":10000,"max_amount_fen":50000})
    r16_price("rate",mode="rate",params={
        "rate_basis_points":500,"rate_basis":"labor"})
    r16_price("composite",mode="composite",components=[
        {"coverage_key":"labor","formula_mode":"per_unit",
         "parameters":{"unit_price_fen":2000}},
        {"coverage_key":"machinery","formula_mode":"fixed",
         "parameters":{"unit_price_fen":10000}}])
    ok("all 8 named calculation models are versioned; no code is stored as a formula",
        row("SELECT COUNT(DISTINCT pricing_mode) n FROM reference_price_versions "
            "WHERE id LIKE 'r16_price_%'")["n"]==8
        and row("SELECT COUNT(*) n FROM reference_price_versions "
            "WHERE id LIKE 'r16_price_%'")["n"]==8)
    def bad_rule(label,mode,params,components,reason):
        blocked_reason(label,
            'INSERT INTO reference_price_versions(id,catalog_id,version_no,title,operation_id,operation_version,unit_id,unit_version,status,pricing_mode,base_fee_fen,unit_price_fen,calculation_params_json,fee_components_json,price_source,price_date,effective_on,basis,created_by,created_at) VALUES('+",".join("?" for _ in range(20))+")",
            reason,
            ("r16_bad_rule_"+label,"r16_cat_base",2,"无效正式价格规则",
             "r16_op",1,"unit",1,"active",mode,0,0,
             json.dumps(params),json.dumps(components),"测试","2026-11-08",
             "2026-11-08","测试","u","2026-11-08T04:43:00.000Z"))
    bad_rule("group_zero_size","group",{
        "group_size_scaled":0,"group_fee_fen":100},[],
        "成组计价需要有效的每组数量及收费金额")
    bad_rule("invalid_min_max","per_unit",{
        "min_amount_fen":900,"max_amount_fen":800},[],
        "参考价最低收费和最高封顶须为非负金额且区间合法")
    bad_rule("rate_no_basis","rate",{
        "rate_basis_points":500},[],
        "费率计价必须给出合法费率及明确计费基数")
    bad_rule("progressive_reversed","progressive_bracket",{
        "tiers":[{"up_to_quantity_scaled":30000,"unit_price_fen":100},
                 {"up_to_quantity_scaled":20000,"unit_price_fen":80}]},[],
        "累进计价必须采用依次升高的边际数量阈值")
    bad_rule("composite_same_coverage","composite",{},[
        {"coverage_key":"labor","formula_mode":"fixed",
         "parameters":{"unit_price_fen":100}},
        {"coverage_key":"labor","formula_mode":"fixed",
         "parameters":{"unit_price_fen":50}}],
        "组合参考价的费用覆盖编码必须唯一")

    add("demands",id="r16_missing_factor",demand_no="R16-MISSING-FACTOR",
        physical_tower_id="pt",context_line_id="line",
        line_name_snapshot="价格因素缺失测试",tower_no_snapshot="#15",
        object_position="body",attribution_unit="physical_tower",
        operation_id="r16_op",operation_version=1,operation_snapshot="基础修理",
        work_object_id="r16_object",work_object_snapshot="杆塔基础",
        target_object="防鸟装置",quantity_scaled=10000,
        unit_id="unit",unit_version=1,unit_snapshot="套",
        completion_standard="合格",problem_description="条件待核实",
        created_by="u",created_at="2026-11-08T04:33:00.000Z")
    r16_eval("r16_missing_factor_quote",did="r16_missing_factor",ver=1)
    blocked_reason("mandatory price feature absent at real tower cannot produce formal quote",
        "INSERT INTO reference_price_evaluation_lines(id,evaluation_id,"
        "location_item_no,coverage_key,reference_price_version_id,"
        "quantity_scaled,amount_fen,calculation_inputs_json,calculation_trace_json)"
        " VALUES('r16_missing_factor_line','r16_missing_factor_quote',1,"
        "'main','r16_price_base',10000,12000,'{}','{}')",
        "正式计价缺少操作类型要求的统一属性")
    # The correct per-tower base is counted for EACH work location.
    r16_eval("r16_full_quote",did="r16_d",ver=1)
    r16_price("outage_only",work_mode="outage",base=10000,unit=2000)
    blocked_reason("outage-only rule cannot price a site with unspecified outage conditions",
        "INSERT INTO reference_price_evaluation_lines(id,evaluation_id,"
        "location_item_no,coverage_key,reference_price_version_id,"
        "quantity_scaled,amount_fen,calculation_inputs_json,calculation_trace_json)"
        " VALUES('r16_bad_mode','r16_full_quote',1,'main',"
        "'r16_price_outage_only',30000,16000,'{}','{}')",
        "参考价逐位置结果必须匹配正式操作版本")
    r16_line("r16_quote15","r16_full_quote",1,30000,16000)
    blocked_reason("incomplete 3-location quote cannot be finalized as if total price known",
        "UPDATE reference_price_evaluations SET status='final',"
        "finalized_by='u',finalized_at='2026-11-08T05:00:00.000Z'"
        " WHERE id='r16_full_quote'",
        "需求参考价必须覆盖全部正式作业位置")
    r16_line("r16_quote16","r16_full_quote",2,20000,14000)
    r16_line("r16_quote17","r16_full_quote",3,40000,18000)
    blocked_reason("comprehensive reference price cannot double-charge additional labor",
        "INSERT INTO reference_price_evaluation_lines("
        "id,evaluation_id,location_item_no,coverage_key,"
        "reference_price_version_id,quantity_scaled,amount_fen,"
        "calculation_inputs_json,calculation_trace_json)"
        " VALUES('r16_double_labor','r16_full_quote',1,'labor',"
        "'r16_price_per',30000,6000,'{}','{}')",
        "综合参考价与分项费用不得在同一作业位置叠加重复计价")
    blocked("same priced location and coverage cannot be billed twice",
        "INSERT INTO reference_price_evaluation_lines("
        "id,evaluation_id,location_item_no,coverage_key,"
        "reference_price_version_id,quantity_scaled,amount_fen,"
        "calculation_inputs_json,calculation_trace_json)"
        " VALUES('r16_duplicate_main','r16_full_quote',1,'main',"
        "'r16_price_base',30000,16000,'{}','{}')")
    r16_final("r16_full_quote")
    full_quote=sum(x["amount_fen"] for x in db.execute(
        "SELECT amount_fen FROM reference_price_evaluation_lines "
        "WHERE evaluation_id='r16_full_quote'"))
    ok("3+2+4 devices per THREE towers quote 480 yuan, not 280 yuan",
       full_quote==48000)
    ok("standalone demand reference quote exposes latest explicit full official version",
        row("SELECT id FROM v_demand_reference_quote_current "
            "WHERE demand_id='r16_d'")["id"]=="r16_full_quote")
    blocked_reason("approved original quote's per-location money cannot be edited",
        "UPDATE reference_price_evaluation_lines SET amount_fen=0 "
        "WHERE id='r16_quote15'",
        "参考价计算明细不允许覆盖")
    blocked_reason("finalized quote cannot be deleted",
        "DELETE FROM reference_price_evaluations WHERE id='r16_full_quote'",
        "正式参考价计算结果历史不可删除")
    blocked_reason("finalized quote cannot change demand or data",
        "UPDATE reference_price_evaluations SET demand_version=2 "
        "WHERE id='r16_full_quote'",
        "已正式确认的参考价历史不可修改")

    # Formal approval adopts all three locations with exact demand quantities.
    # Project-level reference fees are charged independently.
    add("projects",id="r16_p",code="R16-P",name="多基塔完整承接参考价",
        framework_id="f",created_by="u",created_at="2026-11-08T04:40:00.000Z")
    stage("r16_p","stocked",time="2026-11-08T04:41:00.000Z")
    add("project_demand_scopes",id="r16_scope",
        project_id="r16_p",demand_id="r16_d",demand_version=1,
        proposed_quantity_scaled=90000,
        created_at="2026-11-08T04:42:00.000Z",
        updated_at="2026-11-08T04:42:00.000Z")
    demand("r16_other_d")
    activate_demand("r16_other_d")
    add("project_demand_scopes",id="r16_other_scope",
        project_id="r16_p",demand_id="r16_other_d",demand_version=1,
        proposed_quantity_scaled=10000,
        created_at="2026-11-08T04:42:00.000Z",
        updated_at="2026-11-08T04:42:00.000Z")
    add("project_approval_versions",id="r16_av",
        project_id="r16_p",version_no=1,approved_budget_fen=120000,
        snapshot_json="{}",created_at="2026-11-08T04:43:00.000Z")
    add("project_approval_scope_versions",id="r16_ap_scope",
        approval_version_id="r16_av",project_scope_id="r16_scope",
        demand_id="r16_d",demand_version=1,quantity_scaled=90000,
        approved_amount_fen=100000,snapshot_json="{}",
        created_at="2026-11-08T04:44:00.000Z")
    blocked_reason("multi-location approval cannot pretend unallocated quantity is complete",
        "UPDATE project_approval_versions SET status='approved',"
        "approved_by='u',approved_at='2026-11-08T04:45:00.000Z'"
        " WHERE id='r16_av'",
        "正式项目批准需求的逐位置工作量必须完整")
    add("project_approval_work_locations",
        approval_scope_version_id="r16_ap_scope",demand_id="r16_d",
        demand_version=1,location_item_no=1,approved_quantity_scaled=30000)
    add("project_approval_work_locations",
        approval_scope_version_id="r16_ap_scope",demand_id="r16_d",
        demand_version=1,location_item_no=2,approved_quantity_scaled=20000)
    add("project_approval_work_locations",
        approval_scope_version_id="r16_ap_scope",demand_id="r16_d",
        demand_version=1,location_item_no=3,approved_quantity_scaled=40000)
    add("project_approval_scope_versions",id="r16_ap_other",
        approval_version_id="r16_av",project_scope_id="r16_other_scope",
        demand_id="r16_other_d",demand_version=1,quantity_scaled=10000,
        approved_amount_fen=20000,snapshot_json="{}",
        created_at="2026-11-08T04:44:00.000Z")
    ok("one-location formal scope seeds a single checked per-location quantity",
        row("SELECT approved_quantity_scaled FROM project_approval_work_locations "
            "WHERE approval_scope_version_id='r16_ap_other'")["approved_quantity_scaled"]==10000)
    r16_eval("r16_project_quote",did="r16_d",ver=1,
        scope_id="r16_ap_scope")
    r16_line("r16_p15","r16_project_quote",1,30000,16000)
    blocked_reason("partial project quote must cover EVERY committed tower",
        "UPDATE reference_price_evaluations SET status='final',"
        "finalized_by='u',finalized_at='2026-11-08T05:00:00.000Z' "
        "WHERE id='r16_project_quote'",
        "项目承接参考价必须覆盖本次批准的全部作业位置")
    r16_line("r16_p16","r16_project_quote",2,20000,14000)
    blocked_reason("all three committed towers must have priced lines",
        "UPDATE reference_price_evaluations SET status='final',"
        "finalized_by='u',finalized_at='2026-11-08T05:00:00.000Z' "
        "WHERE id='r16_project_quote'",
        "项目承接参考价必须覆盖本次批准的全部作业位置")
    r16_line("r16_p17","r16_project_quote",3,40000,18000)
    r16_final("r16_project_quote")
    add("project_approval_scope_prices",
        approval_scope_version_id="r16_ap_scope",
        evaluation_id="r16_project_quote")
    ok("complete 3+2+4 site quote is 480 yuan",
        sum(r["amount_fen"] for r in db.execute(
            "SELECT amount_fen FROM reference_price_evaluation_lines "
            "WHERE evaluation_id='r16_project_quote'"))==48000)
    blocked_reason("chosen final quote prevents adding another position",
        "INSERT INTO project_approval_work_locations("
        "approval_scope_version_id,demand_id,demand_version,"
        "location_item_no,approved_quantity_scaled)"
        " VALUES('r16_ap_scope','r16_d',1,3,10000)",
        "已选用的正式报价锁定项目逐位置数量")

    # Another different operation type and its own reference price; same
    # project total aggregates both approved demand-scopes, not a mutable total.
    r16_price("other_fixed",mode="fixed",op="op",unit=20000)
    invalid_rule=dict(row("SELECT * FROM reference_price_versions WHERE id='r16_price_other_fixed'"))
    invalid_rule.update(id="r16_undeclared_rule",version_no=2,
        additional_conditions_json='{"r16_terrain":{"op":"eq","value":"mountain"}}')
    blocked_reason("price condition identity must be declared by its adopted operation version",
        "INSERT INTO reference_price_versions("+",".join(invalid_rule)+") VALUES("+
        ",".join("?" for _ in invalid_rule)+")",
        "价格条件须引用采用操作正式版本的有效计价属性",tuple(invalid_rule.values()))
    r16_eval("r16_other_quote",did="r16_other_d",ver=1,scope_id="r16_ap_other")
    r16_line("r16_other_line","r16_other_quote",1,10000,20000,
        price="r16_price_other_fixed")
    r16_final("r16_other_quote")
    add("project_approval_scope_prices",
        approval_scope_version_id="r16_ap_other",
        evaluation_id="r16_other_quote")

    # Whole-project independent fee, once per declared unique charge key.
    r16_price("trip_fee",mode="fixed",op="r16_op",unit=5000,scope="project")
    add("project_reference_price_charges",id="r16_trip",
        approval_version_id="r16_av",
        reference_price_version_id="r16_price_trip_fee",
        charge_scope_key="transport:one-trip",amount_fen=5000,
        pricing_inputs_json='{"one_trip":true}',
        calculation_trace_json='{"fixed_fee_fen":5000}',
        created_by="u",created_at="2026-11-08T04:50:00.000Z")
    blocked_reason("same project-level charge key cannot be repeated",
        "INSERT INTO project_reference_price_charges("
        "id,approval_version_id,reference_price_version_id,charge_scope_key,"
        "amount_fen,pricing_inputs_json,calculation_trace_json,created_by,created_at)"
        " VALUES('r16_duplicate_trip','r16_av','r16_price_trip_fee',"
        "'transport:one-trip',5000,'{}','{}','u','2026-11-08T04:51:00.000Z')",
        "UNIQUE constraint failed")
    db.execute("SAVEPOINT r16_outdated_quote")
    try:
        # Draft users MAY detach a selected price, change quantities, and
        # reselect it. Formal approval MUST reject stale qty/price amounts.
        db.execute("DELETE FROM project_approval_scope_prices "
                   "WHERE approval_scope_version_id='r16_ap_scope'")
        db.execute("DELETE FROM project_approval_work_locations "
                   "WHERE approval_scope_version_id='r16_ap_scope' "
                   "AND location_item_no=2")
        add("project_approval_work_locations",
            approval_scope_version_id="r16_ap_scope",demand_id="r16_d",
            demand_version=1,location_item_no=2,
            approved_quantity_scaled=10000)
        db.execute("UPDATE project_approval_scope_versions "
                   "SET quantity_scaled=80000 WHERE id='r16_ap_scope'")
        add("project_approval_scope_prices",
            approval_scope_version_id="r16_ap_scope",
            evaluation_id="r16_project_quote")
        blocked_reason("formal approval rejects a reselected reference quote priced for stale tower quantities",
            "UPDATE project_approval_versions SET status='approved',"
            "approved_by='u',approved_at='2026-11-08T05:02:00.000Z'"
            " WHERE id='r16_av'",
            "本次项目需求范围已调整，选用的正式参考价过期，请重新核价")
    finally:
        db.execute("ROLLBACK TO r16_outdated_quote")
        db.execute("RELEASE r16_outdated_quote")
    db.execute("UPDATE project_approval_versions SET status='approved',"
        "approved_by='u',approved_at='2026-11-08T05:02:00.000Z'"
        " WHERE id='r16_av'")
    stage("r16_p","approved",time="2026-11-08T05:03:00.000Z")
    approved_basis=list(db.execute(
        "SELECT * FROM v_project_approval_reference_basis_current "
        "WHERE approval_version_id='r16_av'"))
    ok("formal project version pins exactly two independently finalized scopes",
        len(approved_basis)==2
        and {r["evaluation_id"] for r in approved_basis}==
          {"r16_project_quote","r16_other_quote"})
    # Application-side total calculation; SQLite stores only immutable lines
    # and approved project-level fee facts, not a second mutable total.
    project_reference=sum(
        z["amount_fen"] for z in db.execute(
        "SELECT l.amount_fen FROM project_approval_scope_prices src "
        "JOIN project_approval_scope_versions sc "
        "ON sc.id=src.approval_scope_version_id "
        "JOIN reference_price_evaluation_lines l ON l.evaluation_id=src.evaluation_id "
        "WHERE sc.approval_version_id='r16_av'"))
    project_fees=sum(z["amount_fen"] for z in db.execute(
        "SELECT amount_fen FROM project_reference_price_charges "
        "WHERE approval_version_id='r16_av'"))
    ok("approved full-demand reference 730 yuan = 480+200+50, not project budget",
        project_reference==68000 and project_fees==5000
        and project_reference+project_fees==73000
        and row("SELECT approved_budget_fen FROM project_approval_versions "
                "WHERE id='r16_av'")["approved_budget_fen"]==120000)
    blocked_reason("approved reference basis cannot be detached",
        "DELETE FROM project_approval_scope_prices "
        "WHERE approval_scope_version_id='r16_ap_scope'",
        "已批准项目的正式参考价依据不可删除")
    blocked_reason("approved project charge cannot be removed",
        "DELETE FROM project_reference_price_charges WHERE id='r16_trip'",
        "已批准项目独立参考费用不得删除")
    blocked_reason("approved per-tower commitment cannot be deleted",
        "DELETE FROM project_approval_work_locations "
        "WHERE approval_scope_version_id='r16_ap_scope' AND location_item_no=1",
        "已批准或已完成正式计价的作业位置和工作量不可删除")
    blocked_reason("cannot append new quote selection after approval",
        "INSERT INTO project_approval_scope_prices("
        "approval_scope_version_id,evaluation_id)"
        " VALUES('r16_ap_scope','r16_full_quote')",
        "批准参考价只可引用同一正式需求范围已确认且不可变的计价结果")
    # Missing formal quote stays NULL, never interpreted as a priced 0.
    ok("unpriced older project scopes remain explicitly NULL, not fake zero price",
        row("SELECT COUNT(*) n FROM v_project_approval_reference_basis_current "
            "WHERE evaluation_id IS NULL")["n"]>0)
    # Original standalone reference quote survives a demand revision;
    # later current-demand projection must not pretend old quote is current.
    revision_locations=r16_locations((30000,40000,40000))
    add("demand_revisions",id="r16_d_rev2",demand_id="r16_d",
        version=2,snapshot_json=json.dumps({
            "quantity_scaled":110000,
            "work_locations":revision_locations},ensure_ascii=False),
        changed_by="u",changed_at="2026-11-08T05:10:00.000Z")
    ok("multi-tower work quantities revise by NEW immutable demand version",
        row("SELECT SUM(quantity_scaled) n "
            "FROM demand_version_work_locations "
            "WHERE demand_id='r16_d' AND demand_version=2")["n"]==110000
        and row("SELECT SUM(quantity_scaled) n "
            "FROM demand_version_work_locations "
            "WHERE demand_id='r16_d' AND demand_version=1")["n"]==90000)
    ok("new demand version is unpriced until recalculated; previously approved historical quote stays fixed",
        row("SELECT COUNT(*) n FROM v_demand_reference_quote_current "
            "WHERE demand_id='r16_d'")["n"]==0
        and row("SELECT COUNT(*) n FROM reference_price_evaluation_lines "
            "WHERE evaluation_id='r16_full_quote'")["n"]==3
        and row("SELECT evaluation_id FROM project_approval_scope_prices "
            "WHERE approval_scope_version_id='r16_ap_scope'")["evaluation_id"]==
            "r16_project_quote")
finally:
    db.execute("ROLLBACK TO r16_full_price_architecture")
    db.execute("RELEASE r16_full_price_architecture")

ok("retired line attribute is absent from both current and history definitions",
   "erection_type" not in {item[1] for item in db.execute("PRAGMA table_info(transmission_lines)")}
   and "erection_type" not in {item[1] for item in db.execute("PRAGMA table_info(line_history)")})
add("dictionary_types",id="tower_nature",title="杆塔性质")
for identity,label in [("straight","直线"),("tension","耐张")]:
    add("dictionary_items",id=identity,type_id="tower_nature",
        code="TOWER_NATURE_"+identity.upper(),created_at="2026-11-08T04:22:00.000Z")
    add("dictionary_item_versions",id=identity+"_v1",item_id=identity,version=1,
        name=label,status="active",sort_order=100,fields_json="[]",
        changed_by="u",changed_at="2026-11-08T04:22:00.000Z")
add("physical_towers",id="nature_contract",tower_code="NATURE-CONTRACT",tower_nature="straight",created_by="u")
db.execute("UPDATE physical_towers SET tower_nature='tension',version=2,updated_by='u',"
    "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day') WHERE id='nature_contract'")
ok("tower nature change keeps both immutable physical definitions",
   [item[0] for item in db.execute("SELECT tower_nature FROM physical_tower_history WHERE physical_tower_id='nature_contract' ORDER BY version")]==["straight","tension"])
blocked("tower nature rejects undeclared values",
    "INSERT INTO physical_towers(id,tower_code,tower_nature,created_by) VALUES('invalid_nature','INVALID-NATURE','other','u')")

ok("current SQLite integrity",row("PRAGMA integrity_check")[0]=="ok")
ok("current SQLite FK integrity",not db.execute("PRAGMA foreign_key_check").fetchall())
print(f"\\n{len(checks)} database design contract checks passed. "
      "No production database or application files were used.")
