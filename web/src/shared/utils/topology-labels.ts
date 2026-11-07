/**
 * Presentation-only label for a tower on the topology canvas.
 * Never use this value as an identifier or persist it in the ledger.
 */
export function topologyTowerLabel(towerNo:unknown,lineName:unknown):string {
 const full=String(towerNo??'').trim();
 const line=String(lineName??'').trim();
 let label=full;
 if(line){
  const index=full.indexOf(line);
  // Imported PMS records may repeat '500kV + line name + tower number'.
  // Only remove the line name when it is near the beginning and leaves an identifier.
  if(index>=0&&index<=12){
   const after=full.slice(index+line.length).replace(/^[\s#＃·:：—_-]+/u,'').trim();
   if(after)label=after;
  }
 }
 if(label===full && (/[^\x00-\x7f]/u.test(full)||[...full].length>12)){
  // A suffix like 001A, 001+1 or 015# can identify a tower without its
  // verbose line prefix; leave ambiguous identifiers intact for tooltip.
  const match=full.match(/(?:^|[^\d])([#＃]?\d{1,5}(?:\+\d{1,3})?[A-Za-z]?(?:号|#)?)$/u);
  if(match)label=match[1];
 }
 const chars=[...label];
 return chars.length>12?chars.slice(0,11).join('')+'…':label;
}
export function estimateTowerLabelWidth(label:string):number {
 // Conservative width for the 12px font in Mac/Windows CJK fallback.
 return [...label].reduce((total,char)=>total+(/[^\x00-\x7f]/u.test(char)?13:8),10);
}
