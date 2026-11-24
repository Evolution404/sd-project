import {test} from "node:test";
import assert from "node:assert/strict";
import {listStateKey,readListState,writeListState,readColumnPreferences,writeColumnPreferences,listRouteIdentity,encodeListUrl,decodeListUrl} from "../../web/src/components/Crud/utils/list-state.ts";
function memory(){const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}}
test("list preferences are account/list isolated, validated, and do not contain business rows",()=>{
 const storage=memory(), key=listStateKey("user1","equipment:lines");
 const state={query:{keywords:"测试"},sort:{prop:"name",order:"ascending"},filters:{header_status:["active"]},page:2,size:30,scroll:{top:100,left:200}};
 writeListState(storage,key,state);
 assert.deepEqual(readListState(storage,key),state);
 for(const other of [listStateKey("user2","equipment:lines"),listStateKey("user1","equipment:towers")]){
   assert.equal(readListState(storage,other).page,1);
   assert.deepEqual(readListState(storage,other).query,{});
 }
 writeColumnPreferences(storage,key,{name:{visible:false,width:240},other:{visible:true,width:99999}});
 assert.deepEqual(readColumnPreferences(storage,key),{name:{visible:false,width:240},other:{visible:true,width:undefined}});
 storage.setItem(key,JSON.stringify({page:0,size:9999,sort:{prop:7,order:"bad"},filters:{header_status:[{}]},scroll:{top:-10,left:9}}));
 assert.deepEqual(readListState(storage,key),{query:{},sort:undefined,filters:{},page:1,size:20,scroll:{top:0,left:9}});
});

test("shareable query metadata keeps project context and excludes scroll, rows and cross-list state",()=>{
 const state={query:{keywords:"复核"},sort:{prop:"name",order:"ascending"},filters:{status:["active"]},page:2,size:30,scroll:{top:100,left:200}};
 const encoded=encodeListUrl("projects",state);
 assert.equal(listRouteIdentity("/business/projects?project=abc&_list="+encodeURIComponent(encoded)+"&fromDemand=xyz"),"/business/projects?project=abc&fromDemand=xyz");
 assert.deepEqual(decodeListUrl(encoded,"projects"),{...state,scroll:{top:0,left:0}});
 assert.equal(decodeListUrl(encoded,"materials"),undefined);
 assert.equal(decodeListUrl("invalid","projects"),undefined);
 assert.equal(decodeListUrl("x".repeat(4001),"projects"),undefined);
});
