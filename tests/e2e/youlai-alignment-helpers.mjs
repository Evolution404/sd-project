// Shared desktop geometry audit. Group visible interactive controls in
// explicitly horizontal layout regions, not arbitrary neighbouring text.
export async function alignmentAudit(page, scope=".layout-content,.layout-toolbar,.el-dialog,.el-drawer") {
  return page.evaluate(scope=>{
    const groups=[
      ".el-form--inline",".business-control-row",".page-heading-actions",".page-toolbar__left",".page-toolbar__right",
      ".toolbar-left",".toolbar-right",".el-dialog__footer",".el-drawer__footer",".el-pagination",
      ".el-space",".layout-toolbar",".layout-user",".el-form-item__content",".el-table__body .cell",".el-table__header .cell",
    ].join(",");
    const candidates=[
      ".el-button",".el-input",".el-select",".el-date-editor",".el-input-number",".el-cascader",
      ".el-checkbox",".el-radio",".el-switch",".el-pagination__total",".el-pagination__jump",
      ".el-pager",".btn-prev",".btn-next",".layout-toolbar__item",".layout-user__avatar",".layout-user__name",
      ".caret-wrapper",".el-table__column-filter-trigger",
    ].join(",");
    const roots=[...document.querySelectorAll(scope)];
    const measured=[],violations=[];
    const visible=el=>{
      const r=el.getBoundingClientRect(),css=getComputedStyle(el);
      return r.width>0&&r.height>0&&css.visibility!=="hidden"&&css.display!=="none"&&
        r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth&&el.checkVisibility?.({checkOpacity:true,checkVisibilityCSS:true})!==false;
    };
    const name=el=>[(el.getAttribute("aria-label")||el.textContent||el.getAttribute("placeholder")||"").trim().replace(/\s+/g," ").slice(0,36),typeof el.className==="string"?el.className.split(" ")[0]:el.tagName].filter(Boolean).join(" ");
    for(const group of [...new Set(roots.flatMap(root=>[...(root.matches(groups)?[root]:[]),...root.querySelectorAll(groups)]))]){
      if(!visible(group))continue;
      const style=getComputedStyle(group);
      if(style.flexDirection==="column")continue;
      const controls=[...group.querySelectorAll(candidates)].filter(el=>visible(el)&&
        (!el.closest(".el-table__body-wrapper")||group.matches(".el-table__body .cell"))&&
        !el.querySelector("textarea"));
      const outer=controls.filter(el=>!controls.some(other=>other!==el&&other.contains(el)));
      const boxes=outer.map(el=>{const r=el.getBoundingClientRect();return {name:name(el),top:r.top,bottom:r.bottom,center:r.top+r.height/2,left:r.left,right:r.right,height:r.height}}).sort((a,b)=>a.top-b.top);
      const rows=[];
      for(const box of boxes){
        let row=rows.find(r=>r.every(b=>Math.min(b.bottom,box.bottom)-Math.max(b.top,box.top)>=Math.min(b.height,box.height)*0.45)&&r.every(b=>box.right<=b.left+1||box.left>=b.right-1));
        if(!row){row=[];rows.push(row)}
        row.push(box);
      }
      for(const row of rows.filter(r=>r.length>1)){
        const deviation=Math.max(...row.map(b=>b.center))-Math.min(...row.map(b=>b.center));
        const info={group:name(group).slice(0,100),deviation:Math.round(deviation*100)/100,controls:row.map(b=>b.name)};
        measured.push(info);
        if(deviation>1.01)violations.push(info);
      }
    }
    return {measured,violations};
  },scope);
}
