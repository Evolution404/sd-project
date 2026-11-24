/** Presentation-only projection of frozen work locations. Never rewrites historical facts. */
export function locationDisplayFields(kind: unknown, value: unknown) {
  const record=(input:unknown):Record<string,unknown>=>input!==null&&typeof input==="object"&&!Array.isArray(input)?input as Record<string,unknown>:{};
  const snapshot=record(value), span=record(snapshot.span);
  const text=(input:unknown)=>typeof input==="string"?input:"";
  const tower=text(snapshot.tower_no);
  const asset=text(snapshot.asset_no),physical=text(snapshot.physical_code);
  const start=text(snapshot.start_tower_no)||text(span.start_tower_no),end=text(snapshot.end_tower_no)||text(span.end_tower_no);
  const label=kind==="span"?"档距":kind==="physical_tower"?asset||physical:tower;
  return {location_label:label||"未记载",line_name:text(snapshot.line_name),tower_no:kind==="logical_tower"?tower:"",asset_no:asset,physical_code:physical,start_tower_no:start,end_tower_no:end};
}
