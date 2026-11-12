import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, attribute } from "../helpers.mjs";

test("operation attributes reject invalid definitions and pin numeric unit precision", (t) => {
  const {s,user,operation,unit}=fixture(t);
  const save=fields=>s.standards.saveOperation(user,{expected_version:1,attributes_schema_json:fields},operation.id);
  assert.throws(()=>save([attribute({options:[]})]),error=>/至少配置/.test(error.fields.attributes_schema_json));
  assert.throws(()=>save([attribute({options:[{value:"a",label:"甲"},{value:"a",label:"乙"}]})]),/不能重复/);
  assert.throws(()=>save([attribute({type:"integer",precision:0,min:"8",max:"2"})]),/最小值/);
  assert.throws(()=>save([attribute({label:"塔型"})]),/台账引用/);
  assert.throws(()=>save([attribute({type:"integer",precision:0,unit_id:"missing",unit_version:1})]),/不存在/);
  const changed=save([attribute({type:"integer",precision:0,unit_id:unit.id,unit_version:1,min:"0",max:"200"})]);
  assert.equal(changed.version,2);
  s.standards.saveOperation(user,{expected_version:2,attributes_schema_json:[attribute({type:"integer",precision:0,unit_id:unit.id,unit_version:1,label:"高度",min:"0",max:"200"})]},operation.id);
  assert.equal(s.standards.operationAttributes(operation.id,2).items[0].label,"施工难度");
  assert.equal(s.standards.operationAttributes(operation.id,3).items[0].label,"高度");
});
test("unified site facts defer registration, validate both scopes and price exact decimal ranges",(t)=>{
  const {s,user,save,operation,demandInput}=fixture(t);
  const fields=[attribute(),attribute({key:"height",label:"吊装高度",type:"decimal",precision:2,min:"0",max:"100",requirement:"optional"}),
    attribute({key:"reason",label:"治理分类",scope:"demand",requirement:"save"}),
    attribute({key:"note",label:"位置备注",type:"textarea",pricing:false,requirement:"optional"})];
  s.standards.saveOperation(user,{expected_version:1,attributes_schema_json:fields},operation.id);
  const common={...demandInput,attributes:{reason:"普通"},work_locations:[demandInput.work_locations[0]]};
  const missing=s.demands.save(user,common);
  assert.match(s.pricing.quote(user,missing.id,{expected_version:1}).missing[0].reason,/施工难度/);
  assert.throws(()=>s.pricing.quote(user,missing.id,{expected_version:1,confirm:true}),/未完整计价/);
  assert.throws(()=>s.demands.save(user,{...common,work_locations:[{...demandInput.work_locations[1],attributes:{difficulty:"未知"}}]}),/正式选项/);
  assert.throws(()=>s.demands.save(user,{...common,work_locations:[{...demandInput.work_locations[1],attributes:{difficulty:"困难",height:"100.01"}}]}),/范围/);
  assert.throws(()=>save("prices",{title:"未启用计价属性",operation_id:operation.id,pricing_mode:"fixed",unit_price_fen:100,price_source:"测试",price_date:"2026-01-01",effective_on:"2026-01-01",basis:"测试",additional_conditions_json:{note:{op:"eq",value:"文本"}}}),/未启用计价/);
  const price=save("prices",{title:"困难施工",operation_id:operation.id,pricing_mode:"per_unit",unit_price_fen:1000,
    additional_conditions_json:{difficulty:{op:"eq",value:"困难"},height:{op:"range",min:"0.25",max:"15.50"},reason:{op:"eq",value:"普通"}},price_source:"测试",price_date:"2026-01-01",effective_on:"2026-01-01",basis:"测试"});
  assert.equal(price.warnings,undefined);
  const demand=s.demands.save(user,{...common,work_locations:[{...demandInput.work_locations[1],attributes:{difficulty:"困难",height:"0.25",note:"现场记录"}}]});
  assert.equal(s.pricing.quote(user,demand.id,{expected_version:1,confirm:true}).total_fen,2000);
  const overlap=save("prices",{title:"重叠规则",operation_id:operation.id,pricing_mode:"fixed",unit_price_fen:10000,additional_conditions_json:{difficulty:{op:"eq",value:"困难"}},price_source:"测试",price_date:"2026-01-01",effective_on:"2026-01-01",basis:"测试"});
  assert.match(overlap.warnings[0],/困难施工/);
  assert.match(s.pricing.quote(user,demand.id,{expected_version:1}).missing[0].reason,/重叠/);
  s.standards.saveOperation(user,{expected_version:2,attributes_schema_json:fields.map(field=>({...field,enabled:false}))},operation.id);
  const revised=s.demands.save(user,{expected_version:1,problem_description:"原定义下修订"},demand.id);
  assert.equal(revised.operation_version,2);
  assert.equal(revised.work_locations[0].attributes.height,"0.25");
  assert.equal(s.demands.history(demand.id).reference_quotes.length,1);
});
test("price rule edit preserves adopted operation version until explicit upgrade and explains mismatches", (t) => {
  const { s, user, operation, price, demandInput } = fixture(t);
  const changed = s.catalog.save(user, "operations", {
    name: "安装防鸟装置 · 新验收定义",
    expected_version: 1,
  }, operation.id);
  assert.equal(changed.version, 2);

  const previous = s.catalog.get("prices", price.id);
  const preview = s.catalog.previewPrice(user, {
    ...previous, existing_id: price.id,
  });
  assert.equal(preview.operation_version, 1);
  const edited = s.catalog.save(user, "prices", {
    title: "仅修订价格来源说明",
    expected_version: 1,
  }, price.id);
  assert.equal(edited.operation_version, 1);
  assert.equal(edited.version_no, 2);
  assert.equal(s.catalog.history("prices", price.id).length, 2);

  const newer = s.catalog.previewPrice(user, {
    ...s.catalog.get("prices", price.id),
    existing_id: price.id,
    adopt_latest_operation_version: true,
  });
  assert.equal(newer.operation_version, 2);
  const adopted = s.catalog.save(user, "prices", {
    expected_version: 2, adopt_latest_operation_version: true,
  }, price.id);
  assert.equal(adopted.operation_version, 2);

  const demand = s.demands.save(user, demandInput);
  const quote = s.pricing.quote(user, demand.id, {
    expected_version: 1, pricing_date: "2026-11-09",
  });
  assert.equal(quote.complete, true);
  assert.equal(quote.lines[0].rule_title, adopted.title);
  assert.equal(quote.lines[0].rule_version_no, 3);
  assert.match(JSON.stringify(quote.lines[0].calculation_trace_json), /mode/);

  // Changing the current price version to a different operation version
  // produces a specific, user-facing diagnostic instead of opaque "no price".
  s.catalog.save(user, "operations", {
    name: "安装防鸟装置 · 第三版", expected_version: 2,
  }, operation.id);
  const alternativeTower = s.catalog.save(user, "physical", {
    asset_no: "DIA-T18", tower_material: "angle",
  });
  const newerDemand = s.demands.save(user, {
    ...demandInput,
    demand_no: "DIAGNOSTIC-ALT",
    work_locations: [{
      location_kind: "physical_tower",
      physical_tower_id: alternativeTower.id, quantity_scaled: 10000,
    }],
  });
  const missing = s.pricing.quote(user, newerDemand.id, {
    expected_version: 1, pricing_date: "2026-11-09",
  });
  assert.equal(missing.complete, false);
  assert.match(JSON.stringify(missing.missing[0].diagnostics),
    /正式版本不同/);
});
test('boolean demand facts, integer location ranges and frozen asset facts price from one adopted schema', t => {
  const {s,user,save,operation,demandInput}=fixture(t);
  const fields=[attribute({key:'special',label:'特殊治理',scope:'demand',type:'boolean',requirement:'save'}),
    attribute({key:'count',label:'安装层数',type:'integer',precision:0,min:'1',max:'10',requirement:'save'}),
    attribute({key:'tower',label:'塔型',source:'asset',asset_field:'tower_material',options:[],requirement:'pricing'})];
  s.standards.saveOperation(user,{expected_version:1,attributes_schema_json:fields},operation.id);
  save('prices',{title:'统一事实计价',operation_id:operation.id,pricing_mode:'per_unit',unit_price_fen:1200,
    additional_conditions_json:{special:{op:'eq',value:true},count:{op:'range',min:1,max:3},tower:{op:'eq',value:'angle'}},
    price_source:'正式测试依据',price_date:'2026-01-01',effective_on:'2026-01-01',basis:'引用统一属性'});
  const demand=s.demands.save(user,{...demandInput,attributes:{special:true},work_locations:[{...demandInput.work_locations[0],attributes:{count:2}}]});
  const result=s.pricing.quote(user,demand.id,{expected_version:1,confirm:true});
  assert.equal(result.complete,true);
  assert.equal(result.total_fen,3600);
  assert.match(JSON.stringify(s.demands.history(demand.id).reference_quotes),/special/);
  assert.equal(s.demands.get(demand.id).work_locations[0].attributes.tower,'angle');
});
