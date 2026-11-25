import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTowerList } from "../../web/src/utils/business/tower-number-list.ts";

const existing=["999+1","1786","1786+1","1786-1","1786+10","1786+2","1787","1787-1","2000+1","2001-1","1786A"];
test("ascending interval includes both kinds of inserted towers strictly below upper endpoint",()=>{
  const expanded=parseTowerList("1000-2000",existing);
  assert.equal(expanded[0],"1000");
  assert.equal(expanded.at(-1),"2000");
  for(const no of ["1786+1","1786-1","1786+10","1786+2","1787-1"]) assert.ok(expanded.includes(no),no);
  for(const no of ["999+1","2000+1","2001-1","1786A"]) assert.ok(!expanded.includes(no),no);
  for(const no of ["1786+1","1786-1"]) {
    assert.ok(!parseTowerList("1000-1786",existing).includes(no));
    assert.ok(parseTowerList("1000-1787",existing).includes(no));
    assert.ok(expanded.indexOf("1786")<expanded.indexOf(no));
    assert.ok(expanded.indexOf(no)<expanded.indexOf("1787"));
  }
  assert.deepEqual(parseTowerList("1786-1786",existing),["1786"]);
});
test("literal insertions, gaps, repeated entries, zero-padded ranges and order are preserved",()=>{
  assert.deepEqual(parseTowerList("1786+1、1786-1、1786、999",existing),["1786+1","1786-1","1786","999"]);
  const expanded=parseTowerList("1786-1787、1786-1",existing);
  assert.equal(expanded.filter(no=>no==="1786-1").length,2);
  assert.ok(expanded.indexOf("1786+2")<expanded.indexOf("1786+10"));
  assert.deepEqual(parseTowerList("001-003",["001+1"]),["001","001+1","002","003"]);
  assert.deepEqual(parseTowerList("15-17、15、999"),["15","16","17","15","999"]);
});
test("range expansion respects 5000-item budget including actual insertions",()=>{
  assert.equal(parseTowerList("1-5000").length,5000);
  assert.throws(()=>parseTowerList("1-5000",["1+1"]),/5000/);
  assert.throws(()=>parseTowerList("1-5001"),/5000/);
  assert.throws(()=>parseTowerList("1-9007199254740992"),/有效整数/);
  assert.deepEqual(parseTowerList("9007199254740991-9007199254740991"),["9007199254740991"]);
});
