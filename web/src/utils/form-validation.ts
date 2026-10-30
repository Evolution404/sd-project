import {nextTick,ref,type ObjectDirective} from 'vue';

type Field=HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement;
type FieldError={node:HTMLSpanElement,fromServer:boolean};
type FormState={form:HTMLFormElement,errors:Map<Field,FieldError>,observer:MutationObserver,refresh:()=>void,dispose:()=>void};
const states=new WeakMap<HTMLFormElement,FormState>();
let activeForm:HTMLFormElement|null=null;
let nextId=0;
// The originating error is rendered locally; other errors can still use the page banner.
export const inlineErrorMessage=ref('');
const fields=(form:HTMLFormElement)=>Array.from(form.querySelectorAll<Field>('input,select,textarea')).filter(field=>!field.disabled&&!(field instanceof HTMLInputElement&&['hidden','submit','button'].includes(field.type)));
function fieldLabel(field:Field):HTMLElement|null{
 return field.closest('label')||field.closest('.field-label-group')?.querySelector<HTMLElement>('.field-title')||null;
}
function fieldName(field:Field){
 if(field.getAttribute('aria-label'))return field.getAttribute('aria-label')!;
 const label=fieldLabel(field)?.cloneNode(true) as HTMLElement|undefined;
 label?.querySelectorAll('input,select,textarea,button,.field-error,.required-star,.field-hint').forEach(node=>node.remove());
 return label?.textContent?.trim().replace(/\s*\*\s*$/,'')||field.name||'此项';
}
function clearField(state:FormState,field:Field){
 const error=state.errors.get(field);if(!error)return;
 const described=(field.getAttribute('aria-describedby')||'').split(' ').filter(id=>id&&id!==error.node.id);
 if(described.length)field.setAttribute('aria-describedby',described.join(' '));else field.removeAttribute('aria-describedby');
 field.removeAttribute('aria-invalid');error.node.remove();state.errors.delete(field);
}
function showField(state:FormState,field:Field,message:string,fromServer=false){
 let error=state.errors.get(field);
 if(!error){
  const node=document.createElement('span');node.className='field-error';node.id='field-error-'+(++nextId);node.setAttribute('role','alert');
  // Keep errors outside flex rows containing a quantity and its unit.
  const quantityRow=field.closest('.quantity-inputs');
  if(quantityRow)quantityRow.after(node);else field.after(node);
  error={node,fromServer};state.errors.set(field,error);
  field.setAttribute('aria-describedby',((field.getAttribute('aria-describedby')||'')+' '+node.id).trim());
 }
 error.node.textContent=message;error.fromServer=fromServer;field.setAttribute('aria-invalid','true');
}
function errorFor(field:Field){
 const name=fieldName(field),value=field.value;
 const checkbox=field instanceof HTMLInputElement&&['checkbox','radio'].includes(field.type);
 if(field.required&&(!value||(!checkbox&&field.getAttribute('type')!=='password'&&!value.trim())||(checkbox&&!(field as HTMLInputElement).checked)))return '请'+(field.tagName==='SELECT'?'选择':'填写')+name;
 if(field.validity.badInput)return name+'格式不正确';
 if(!value)return '';
 const rule=field.dataset.validate;
 if(rule==='quantity'&&(!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,4})?$/.test(value.trim())||Number(value)<=0))return name+'须大于0，最多四位小数';
 if(rule==='money'&&!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value.trim()))return name+'应为非负金额，最多两位小数';
 if(rule==='json'){try{if(!Array.isArray(JSON.parse(value)))return '字段模板应为 JSON 数组'}catch{return '字段模板 JSON 格式不正确'}}
 const validity=field.validity;
 if(validity.badInput||validity.typeMismatch)return name+'格式不正确';
 if(validity.rangeUnderflow)return name+'不能小于'+field.getAttribute('min');
 if(validity.rangeOverflow)return name+'不能大于'+field.getAttribute('max');
 if(validity.stepMismatch)return name+'不符合允许的数值精度';
 if(validity.patternMismatch)return field.dataset.formatMessage||name+'格式不正确';
 return '';
}
function reveal(field:Field){
 let parent=field.parentElement;
 while(parent){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement}
 field.focus({preventScroll:true});field.scrollIntoView({block:'nearest'});
}
export function clearFormErrors(form:HTMLFormElement){
 const state=states.get(form);if(!state)return;
 for(const field of state.errors.keys())clearField(state,field);
 form.querySelector('[data-form-submit-error]')?.remove();
 if(activeForm===form)inlineErrorMessage.value='';
}
/** Map server failures to the submitted field, with a local form message for non-field failures. */
export function presentFormError(message:string,details?:{row?:number,message:string}[],target?:Field){
 inlineErrorMessage.value='';
 const form=target?.closest('form')||activeForm,state=form&&states.get(form);
 if(!form?.isConnected||!state||!form.getClientRects().length)return;
 clearFormErrors(form);
 const available=fields(form);
 if(target){showField(state,target,message,true);inlineErrorMessage.value=message;reveal(target);return}
 const messages=details?.length?details:[{message}];
 for(const item of messages){
  const row=item.row?form.querySelector(`[data-row-index="${item.row-1}"]`):null;
  const candidates=row?available.filter(field=>row.contains(field)):available;
  const normalize=(s:string)=>s.replace(/[\s*：/（）()]/g,'');
  const ranked=candidates.map(field=>{
   const label=normalize(fieldName(field));const text=normalize(item.message);
   const aliases=(field.dataset.errorMatch||'').split('|').filter(Boolean);
   aliases.push(fieldName(field).replace(/\s+\d+$/,''));
   if(field.dataset.validate==='quantity')aliases.push('工作量','数量','长度');
   if(label.includes('编码'))aliases.push('编码');
   if(/工作量|数量|确认量/.test(label))aliases.push('工作量','数量','确认量');
   if(label.includes('原因')||label.includes('依据说明'))aliases.push('原因','核实意见');
   if(field.dataset.validate==='json')aliases.push('JSON','字段','模板');
   return {field,score:text.includes(label)?label.length:Math.max(0,...aliases.filter(key=>text.includes(normalize(key))).map(key=>key.length))};
  }).filter(item=>item.score>0).sort((a,b)=>b.score-a.score);
  if(ranked.length)showField(state,ranked[0].field,item.message,true);
 }
 if(!state.errors.size){
  const node=document.createElement('p');node.className='field-error form-submit-error';node.dataset.formSubmitError='';node.setAttribute('role','alert');node.textContent=message;
  const actions=form.querySelector('.form-actions');if(actions)actions.before(node);else form.append(node);
 }
 inlineErrorMessage.value=message;
 const first=state.errors.keys().next().value;if(first)reveal(first);
}

// A directive keeps the existing Vue form models and submit handlers intact while
// applying one validation and accessibility policy to static and dynamic fields.
export const vFormValidation:ObjectDirective<HTMLFormElement>={
 created(form){form.noValidate=true},
 mounted(form){
  const state={} as FormState;state.form=form;state.errors=new Map();
  state.refresh=()=>{
   for(const [field,error] of state.errors)if(!form.contains(field)||field.disabled||!error.fromServer&&!errorFor(field))clearField(state,field);
   for(const field of fields(form)){
    const label=fieldLabel(field);if(!label)continue;
    // The stable accessible name excludes subsequently inserted error text.
    if(!field.hasAttribute('aria-label'))field.setAttribute('aria-label',fieldName(field));
    const caption=label.querySelector<HTMLElement>('.field-caption')||label;
    const marker=caption.querySelector<HTMLElement>('[data-required-marker]');
    if(field.required&&!label.querySelector('.required-star')){
     const star=document.createElement('span');star.textContent=' *';star.className='required-star';star.dataset.requiredMarker='';star.setAttribute('aria-hidden','true');
     if(caption===label&&label.matches('label'))label.insertBefore(star,label.firstElementChild);else caption.append(star);
    }else if(!field.required&&marker)marker.remove();
   }
  };
  const submit=(event:Event)=>{
   activeForm=form;clearFormErrors(form);state.refresh();
   for(const field of fields(form)){const message=errorFor(field);if(message)showField(state,field,message)}
   const first=state.errors.keys().next().value;
   if(first){event.preventDefault();event.stopImmediatePropagation();reveal(first)}
  };
  const edit=(event:Event)=>{
   const field=event.target as Field;if(!state.errors.has(field))return;
   const message=errorFor(field);if(message)showField(state,field,message);else clearField(state,field);
   // Shared values can also correct errors in per-tower previews after Vue updates.
   void nextTick(()=>{for(const [other,error] of state.errors)if(!error.fromServer){const message=errorFor(other);if(message)showField(state,other,message);else clearField(state,other)}});
  };
  const invalid=(event:Event)=>event.preventDefault();
  const observer=new MutationObserver(state.refresh);state.observer=observer;
  observer.observe(form,{childList:true,subtree:true,attributes:true,attributeFilter:['required','disabled']});
  form.addEventListener('submit',submit,true);form.addEventListener('input',edit);form.addEventListener('change',edit);form.addEventListener('invalid',invalid,true);
  state.dispose=()=>{observer.disconnect();if(activeForm===form)activeForm=null;clearFormErrors(form);form.removeEventListener('submit',submit,true);form.removeEventListener('input',edit);form.removeEventListener('change',edit);form.removeEventListener('invalid',invalid,true)};
  states.set(form,state);state.refresh();
 },
 beforeUnmount(form){states.get(form)?.dispose();states.delete(form)}
};
