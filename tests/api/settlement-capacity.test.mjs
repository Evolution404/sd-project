import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {approvedFixture} from "../helpers.mjs";
import {httpServer} from "../../dist/server/platform/http/server.js";

function input(f, qty, position=1) {
  return { approval_version_id:f.approval.id, mode:"project_total", amount_fen:10000, basis:"现场结算",
    resolutions:[{project_scope_id:f.scope.id,location_item_no:position,resolved_quantity_scaled:qty,evidence:"已复核"}] };
}
const over = e => e.status===422 && /超出批准余量/.test(e.message);
const approve = (f,b) => f.s.finance.review(f.user,b.id,{expected_version:b.version.version_no,expected_event_seq:b.review.event_seq,action:"approve"});

test("per-position capacity applies to drafts, submit, review, resubmit and revision excluding own effective version",t=>{
  const f=approvedFixture(t), {s,user,project}=f;
  assert.throws(()=>s.finance.saveDraft(user,project.id,input(f,40000)),over);
  assert.throws(()=>s.finance.saveAndSubmit(user,project.id,input(f,40000)),over);
  assert.equal(s.finance.allSettlements().length,0);
  const a=s.finance.saveAndSubmit(user,project.id,input(f,20000));
  const b=s.finance.saveAndSubmit(user,project.id,input(f,20000));
  const stale=s.finance.saveDraft(user,project.id,input(f,20000));
  approve(f,a);
  assert.throws(()=>approve(f,b),over);
  assert.equal(s.finance.settlement(b.id).review.action,"submit");
  assert.throws(()=>s.finance.submit(user,stale.id,{expected_version:0,expected_edit_version:1}),over);
  assert.equal(s.finance.settlement(stale.id).draft.edit_version,1);
  s.finance.review(user,b.id,{expected_version:1,expected_event_seq:1,action:"return",reason:"余额不足"});
  assert.throws(()=>s.finance.resubmit(user,b.id,{expected_version:1,expected_event_seq:2}),over);
  const revised=s.finance.saveAndSubmit(user,project.id,{...input(f,30000),expected_version:1,expected_edit_version:0},a.id);
  assert.equal(revised.version.previous_version_id,a.version.id);
  assert.equal(revised.effective_amount_fen,10000);
  approve(f,revised);
  assert.equal(s.finance.summary(project.id).demands[0].resolved_quantity_scaled,30000);
  assert.throws(()=>s.finance.saveAndSubmit(user,project.id,input(f,10000)),over);
  assert.doesNotThrow(()=>s.finance.saveDraft(user,project.id,input(f,10000,2)));
});

test("direct submit HTTP uses one atomic command, rejects invalid input and idempotent replay does not duplicate settlement",async t=>{
  const f=approvedFixture(t);
  const server=httpServer(f.s);
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.shutdown(resolve)));
  const base="http://127.0.0.1:"+server.address().port;
  const login=await fetch(base+"/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"Schema113-test-password"})});
  assert.equal(login.status,200);
  const cookie=login.headers.get("set-cookie").split(";")[0];
  const key=randomUUID();
  const path=base+"/api/projects/"+f.project.id+"/settlements";
  async function send(body,id=randomUUID(),url=path) {
    return fetch(url,{method:"POST",headers:{"Content-Type":"application/json",Cookie:cookie,"Idempotency-Key":id},body:JSON.stringify(body)});
  }
  const rejected=await send({...input(f,40000),submit_now:true});
  assert.equal(rejected.status,422);
  assert.equal(f.s.finance.allSettlements().length,0);
  const body={...input(f,30000),submit_now:true};
  const result=await send(body,key);
  assert.equal(result.status,200);
  const bill=await result.json();
  assert.equal(bill.review.action,"submit");
  assert.equal(bill.draft,null);
  const retry=await send(body,key);
  assert.equal(retry.status,200);
  assert.equal((await retry.json()).id,bill.id);
  assert.equal(f.s.finance.allSettlements().length,1);
  const blocked=await send({...input(f,10000),expected_version:1,expected_edit_version:0,submit_now:true},randomUUID(),path+"/"+bill.id);
  assert.equal(blocked.status,409);
  assert.equal(f.s.finance.settlement(bill.id).version.id,bill.version.id);
});
