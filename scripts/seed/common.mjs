// Initial reference definitions only. Never overwrite existing user-maintained entries.
export const COMMON_UNITS = [
  ["套",0],["串",0],["处",0],["片",0],["个",0],["只",0],["根",0],["基",0],["档",0],["组",0],["台",0],["件",0],["项",0],["次",0],["米",2],["千米",3],["平方米",2],["立方米",3],["千克",3],["吨",3],["工日",2],["台班",2]
];
export const COMMON_VOLTAGES = ["35kV","110kV","220kV","500kV","1000kV","±200kV","±500kV","±800kV"];
export function seedCommonDefinitions(system,actor){
  const definitions={
    units:COMMON_UNITS.map(([name,quantity_precision])=>({name,quantity_precision})),
    voltages:COMMON_VOLTAGES.map(name=>({name})),
    priorities:["一般","重要","紧急"].map(name=>({name})),
    categories:["线路日常检修","线路专项整治"].map(name=>({name})),
    tower_natures:["耐张","直线"].map(name=>({name})),
    tower_materials:["角钢塔","钢管杆","钢管塔","水泥杆","铁杆"].map(name=>({name})),
  };
  return system.database.transaction(()=>{
    const result={};
    for(const [kind,items] of Object.entries(definitions)){
      const existing=new Map(system.catalog.list(kind,true).map(row=>[row.name,row]));
      result[kind]=0;
      for(const item of items){
        if(existing.has(item.name))continue;
        existing.set(item.name,system.catalog.save(actor,kind,item));result[kind]++;
      }
    }
    return result;
  });
}
