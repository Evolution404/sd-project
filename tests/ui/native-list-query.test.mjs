import {test} from "node:test";
import assert from "node:assert/strict";
import {applyNativeListQuery,nativeColumnFilter,nativeListQuery} from "../../web/src/utils/business/native-list-query.ts";
test("native CRUD query preserves remote order, search and exact multi-select filters",()=>{
  const opts=nativeListQuery({sort:["name,asc"],header_status:["active","inactive","active"],header_invalid:["x"]},["status"]);
  assert.deepEqual(opts,{sort:"name",direction:"asc",gridFilters:{status:["active","inactive"]}});
  const p=applyNativeListQuery(new URLSearchParams({q:"防鸟",sort:"created_at",direction:"desc",filters:'{"status":"active"}'}),opts);
  assert.equal(p.get("q"),"防鸟");assert.equal(p.get("sort"),"name");assert.equal(p.get("direction"),"asc");
  assert.deepEqual(JSON.parse(p.get("filters")),{status:"active"});
  assert.deepEqual(JSON.parse(p.get("grid_filters")),{status:["active","inactive"]});
  assert.deepEqual(nativeListQuery({sort:[],header_status:[]},["status"]),{});
  assert.deepEqual(nativeListQuery({sort:["name;drop,asc"]},[]),{});
});
test("bounded single filters and native header keys do not shadow search controls",()=>{
  const config=nativeColumnFilter("status",[{text:"在运",value:"active"}],true);
  assert.equal(config.columnKey,"header_status");assert.equal(config.filterMultiple,false);
  const options=nativeListQuery({status:"inactive",header_status:["active"]},["status"],true);
  assert.deepEqual(options,{filters:{status:"active"}});
  const q=applyNativeListQuery(new URLSearchParams({filters:'{"line_kind":"main"}'}),options);
  assert.deepEqual(JSON.parse(q.get("filters")),{line_kind:"main",status:"active"});
});

test("history scope is explicit, defaults to live records, and composes with remote filters",()=>{
  assert.equal(applyNativeListQuery(new URLSearchParams(),nativeListQuery({})).has("deleted"),false);
  assert.equal(applyNativeListQuery(new URLSearchParams(),nativeListQuery({include_deleted:"false"})).has("deleted"),false);
  const q=applyNativeListQuery(new URLSearchParams({q:"历史",deleted:"false"}),nativeListQuery({include_deleted:"true",sort:["name,asc"],header_status:["inactive"]},["status"]));
  assert.equal(q.get("deleted"),"true");
  assert.equal(q.get("q"),"历史");
  assert.equal(q.get("sort"),"name");
  assert.deepEqual(JSON.parse(q.get("grid_filters")),{status:["inactive"]});
});
