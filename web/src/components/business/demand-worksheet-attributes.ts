import type { AttributeValues, OperationAttribute } from "../../../../server/shared/types/operation-attributes";
import { validateAttributeValue } from "../../../../server/shared/operation-attributes";
import { exactScaledDecimalText } from "@/utils/business/fixed-scale";

export function attributeOptions(field:OperationAttribute):string[]|undefined{
  if(field.type==="boolean")return ["是","否"];
  if(field.type==="select"||field.type==="multiselect")return field.options.map(option=>option.label);
}
export function worksheetAttribute(field:OperationAttribute){
  if(field.source!=="manual")return false;
  const labels=attributeOptions(field);
  // Ambiguous labels or labels containing native list delimiters use the original
  // per-position Element Plus form, not an unsafe composite label.
  return !labels||(new Set(labels).size===labels.length&&labels.every(label=>!label.includes(",")&&(field.type!=="multiselect"||!label.includes("/"))));
}
export function attributeText(field:OperationAttribute,value:AttributeValues[string]|undefined):string{
  if(value===undefined)return "";
  if(field.type==="boolean")return value===true?"是":value===false?"否":String(value);
  if(field.type==="select"||field.type==="multiselect"){
    const label=(v:unknown)=>field.options.find(option=>option.value===v)?.label??String(v);
    return Array.isArray(value)?value.map(label).join("/"):label(value);
  }
  return String(value);
}
export function attributeInput(field:OperationAttribute,raw:string):AttributeValues[string]{
  if(field.type==="integer")return validateAttributeValue(field,exactScaledDecimalText(raw,0));
  if(field.type==="boolean")return validateAttributeValue(field,raw==="是"?true:raw==="否"?false:raw);
  if(field.type==="select"||field.type==="multiselect"){
    const code=(label:string)=>{
      const matches=field.options.filter(option=>option.label===label);
      if(matches.length!==1)throw Error(field.label+"不在正式选项中");
      return matches[0].value;
    };
    return validateAttributeValue(field,field.type==="select"?code(raw):raw.split("/").map(code));
  }
  return validateAttributeValue(field,raw);
}
