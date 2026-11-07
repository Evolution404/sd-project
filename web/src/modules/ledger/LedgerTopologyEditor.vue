<script setup lang="ts">
import {computed,reactive,ref,watch,onMounted,onBeforeUnmount,nextTick} from 'vue';
import {ElButton,ElCard,ElDialog,ElEmpty,ElForm,ElFormItem,ElInput,ElOption,ElSelect,ElTag} from 'element-plus';
import {requestApi} from '../../shared/api/client';
import {newClientId} from '../../shared/utils/client-id';
import {topologyTowerLabel,estimateTowerLabelWidth} from '../../shared/utils/topology-labels';

type Rec=Record<string,any>;
type DraftTower={client_id:string;after_id:string|null;data:{tower_no:string;management_department:string;maintenance_team:string;tower_type:string;model:string;height:string;longitude:string;latitude:string}};
type DraftSpan={start_id:string;end_id:string};
type Node=Rec & {x:number;y:number;draft:boolean};
const props=defineProps<{lineId:string;workspace:Rec;canWrite:boolean;ready:boolean}>();
const emit=defineEmits<{(e:'committed'):void;(e:'openTower',id:string):void;(e:'dirty',value:boolean):void}>();
const layout=ref<'logical'|'geo'>('logical');
const mode=ref<'select'|'connect'>('select');
const selected=ref('');
const firstEndpoint=ref('');
const draftTowers=ref<DraftTower[]>([]);
const draftSpans=ref<DraftSpan[]>([]);
const past=ref<string[]>([]);
const future=ref<string[]>([]);
const camera=reactive({x:0,y:0,w:1100,h:490});
const canvasElement=ref<SVGSVGElement|null>(null);
const canvasSize=reactive({width:1000,height:440});
let sizeObserver:ResizeObserver|undefined;
const pixelsPerUnit=computed(()=>Math.max(.001,Math.min(canvasSize.width/camera.w,canvasSize.height/camera.h)));
const labelFontUnits=computed(()=>12/pixelsPerUnit.value);
const dragging=ref(false);
let dragX=0,dragY=0;
const towerDialog=ref(false),previewDialog=ref(false),previewBusy=ref(false),saving=ref(false);
const preview=ref<Rec|null>(null),previewSignature=ref('');
const message=ref('');
const towerForm=reactive({tower_no:'',management_department:'',maintenance_team:'',tower_type:'',model:'',height:'',longitude:'',latitude:''});
const pending=computed(()=>draftTowers.value.length+draftSpans.value.length);
watch(pending,count=>emit('dirty',count>0),{immediate:true});
const snapshots=()=>JSON.stringify({towers:draftTowers.value,spans:draftSpans.value});
const commitChange=(fn:()=>void)=>{
 past.value.push(snapshots());if(past.value.length>100)past.value.shift();
 fn();future.value=[];preview.value=null;message.value='';
};
function restore(raw:string){const v=JSON.parse(raw);draftTowers.value=v.towers;draftSpans.value=v.spans;preview.value=null;message.value=''}
function undo(){if(!past.value.length)return;future.value.push(snapshots());restore(past.value.pop()!)}
function redo(){if(!future.value.length)return;past.value.push(snapshots());restore(future.value.pop()!)}
function clearDraft(){draftTowers.value=[];draftSpans.value=[];past.value=[];future.value=[];preview.value=null;previewDialog.value=false;firstEndpoint.value='';selected.value='';message.value=''}
watch(()=>props.lineId,()=>{clearDraft();void nextTick(fitAll)});
watch(layout,()=>{firstEndpoint.value='';void nextTick(fitAll)});
onMounted(()=>{
 const element=canvasElement.value;
 if(!element)return;
 const update=()=>{const r=element.getBoundingClientRect();canvasSize.width=Math.max(1,r.width);canvasSize.height=Math.max(1,r.height)};
 update();
 sizeObserver=new ResizeObserver(update);sizeObserver.observe(element);
 void nextTick(fitAll);
});
onBeforeUnmount(()=>sizeObserver?.disconnect());
function resetCamera(){Object.assign(camera,{x:0,y:0,w:1100,h:490})}
const baseNodes=computed<Rec[]>(()=>[
 ...(props.workspace.junction?[{...props.workspace.junction,is_junction:true}]:[]),
 ...(props.workspace.towers||[]).filter((t:Rec)=>t.status!=='inactive')
]);
const ordered=computed<Rec[]>(()=>{
 const result=baseNodes.value.map(t=>({...t}));
 for(const t of draftTowers.value){
  const idx=t.after_id?result.findIndex(n=>n.id===t.after_id):-1;
  result.splice(idx<0?result.length:idx+1,0,{id:t.client_id,tower_no:t.data.tower_no,
   management_department:t.data.management_department,longitude:t.data.longitude===''?null:Number(t.data.longitude),
   latitude:t.data.latitude===''?null:Number(t.data.latitude),is_draft:true});
 }
 return result;
});
const allNodes=computed<Node[]>(()=>{
 const list=ordered.value;
 if(layout.value==='logical')return list.map((n,i)=>({...n,x:85+i*105,y:n.is_junction?155:235,draft:!!n.is_draft}));
 const valid=list.filter(t=>Number.isFinite(Number(t.longitude))&&Number.isFinite(Number(t.latitude))&&t.longitude!==null&&t.latitude!==null);
 if(!valid.length)return list.map((n,i)=>({...n,x:85+i*105,y:235,draft:!!n.is_draft}));
 const cos=Math.max(.15,Math.cos(valid.reduce((s,n)=>s+Number(n.latitude),0)/valid.length*Math.PI/180));
 const lon=valid.map(n=>Number(n.longitude)*cos),lat=valid.map(n=>Number(n.latitude));
 const minX=Math.min(...lon),maxX=Math.max(...lon),minY=Math.min(...lat),maxY=Math.max(...lat);
 const factor=Math.min(2500/Math.max(maxX-minX,.0001),420/Math.max(maxY-minY,.0001));
 let missing=0;
 return list.map(n=>{
  const validCoord=n.longitude!==null&&n.latitude!==null&&Number.isFinite(Number(n.longitude))&&Number.isFinite(Number(n.latitude));
  return {...n,x:validCoord?90+(Number(n.longitude)*cos-minX)*factor:90+(missing++)*105,
   y:validCoord?65+(maxY-Number(n.latitude))*factor:550,draft:!!n.is_draft,unlocated:!validCoord};
 });
});
const nodeMap=computed(()=>new Map(allNodes.value.map(n=>[n.id,n])));
type Link={id:string;start:string;end:string;draft:boolean;status:string};
const links=computed<Link[]>(()=>{
 const saved=(props.workspace.spans||[]).filter((s:Rec)=>s.status!=='retired').map((s:Rec)=>({
  id:s.id,start:s.start_tower_id,end:s.end_tower_id,draft:false,status:s.status}));
 return [...saved,...draftSpans.value.map((s,i)=>({id:'draft-span-'+i,start:s.start_id,end:s.end_id,draft:true,status:'draft'}))];
});
const visibleNodes=computed(()=>allNodes.value.filter(n=>n.x>=camera.x-50&&n.x<=camera.x+camera.w+50&&n.y>=camera.y-50&&n.y<=camera.y+camera.h+50));
const visibleLinks=computed(()=>links.value.filter(e=>{
 const a=nodeMap.value.get(e.start),b=nodeMap.value.get(e.end);
 return a&&b&&Math.max(a.x,b.x)>=camera.x-50&&Math.min(a.x,b.x)<=camera.x+camera.w+50&&Math.max(a.y,b.y)>=camera.y-50&&Math.min(a.y,b.y)<=camera.y+camera.h+50;
}));
const viewBox=computed(()=>[camera.x,camera.y,camera.w,camera.h].join(' '));
const selectedNode=computed(()=>nodeMap.value.get(selected.value));
// Text is measured in CSS pixels, NOT topology units. Cull colliding labels
// in geographic/zoomed-out views. Selected nodes and drafts have priority.
const visibleLabelIds=computed(()=>{
 const scale=pixelsPerUnit.value;
 const occupied:{left:number;right:number;top:number;bottom:number}[]=[];
 const shown=new Set<string>();
 const priority=[...visibleNodes.value].sort((a,b)=>
  Number(b.id===selected.value)-Number(a.id===selected.value)
  || Number(b.draft)-Number(a.draft)
  || a.x-b.x);
 for(const node of priority){
  const label=topologyTowerLabel(node.tower_no,props.workspace.line?.name);
  if(!label)continue;
  const x=(node.x-camera.x)*scale,y=(node.y-camera.y)*scale;
  const half=estimateTowerLabelWidth(label)/2;
  const baseline=y-(node.id===selected.value?15:10)-9;
  const box={left:x-half-3,right:x+half+3,top:baseline-14,bottom:baseline+3};
  // Screen-edge labels can be clipped naturally; they still participate
  // in collision checks to prevent doubled text at the canvas boundary.
  if(occupied.some(other=>box.left<other.right&&box.right>other.left&&box.top<other.bottom&&box.bottom>other.top))continue;
  occupied.push(box);shown.add(node.id);
 }
 return shown;
});
function focus(id:string){const n=nodeMap.value.get(id);if(!n)return;selected.value=id;camera.x=n.x-camera.w/2;camera.y=n.y-camera.h/2}
function zoom(factor:number){const midX=camera.x+camera.w/2,midY=camera.y+camera.h/2;camera.w=Math.max(190,Math.min(5000,camera.w*factor));camera.h=camera.w*490/1100;camera.x=midX-camera.w/2;camera.y=midY-camera.h/2}
function fitAll(){
 const list=allNodes.value;if(!list.length){resetCamera();return}
 const xs=list.map(n=>n.x),ys=list.map(n=>n.y),left=Math.min(...xs)-70,right=Math.max(...xs)+70,top=Math.min(...ys)-85,bottom=Math.max(...ys)+90;
 const width=Math.max(right-left,(bottom-top)*1100/490,420);camera.w=width;camera.h=width*490/1100;camera.x=(left+right-camera.w)/2;camera.y=(top+bottom-camera.h)/2;
}
function panStart(e:PointerEvent){if(e.button!==0||(e.target as Element).closest('.topology-node'))return;dragging.value=true;dragX=e.clientX;dragY=e.clientY;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)}
function panMove(e:PointerEvent){if(!dragging.value)return;const bounds=(e.currentTarget as SVGElement).getBoundingClientRect();camera.x-=(e.clientX-dragX)*camera.w/Math.max(bounds.width,1);camera.y-=(e.clientY-dragY)*camera.h/Math.max(bounds.height,1);dragX=e.clientX;dragY=e.clientY}
function panEnd(){dragging.value=false}
function wheelZoom(e:WheelEvent){
 const factor=e.deltaY>0?1.15:.87;
 const rect=(e.currentTarget as SVGElement).getBoundingClientRect();
 const fx=(e.clientX-rect.left)/Math.max(rect.width,1),fy=(e.clientY-rect.top)/Math.max(rect.height,1);
 const originX=camera.x+fx*camera.w,originY=camera.y+fy*camera.h;
 camera.w=Math.max(190,Math.min(5000,camera.w*factor));
 camera.h=camera.w*490/1100;
 camera.x=originX-fx*camera.w;camera.y=originY-fy*camera.h;
}
function clickNode(n:Node){
 if(mode.value==='connect'){
  if(!props.ready||!props.canWrite)return;
  if(!firstEndpoint.value){firstEndpoint.value=n.id;selected.value=n.id;return}
  const first=firstEndpoint.value;firstEndpoint.value='';
  if(first===n.id){message.value='不能把同一基杆塔连接到自身';return}
  if(links.value.some(e=>(e.start===first&&e.end===n.id)||(e.end===first&&e.start===n.id))){message.value='这两基杆塔之间已存在档距';return}
  commitChange(()=>draftSpans.value.push({start_id:first,end_id:n.id}));selected.value=n.id;
 }else selected.value=n.id;
}
function openAddTower(){
 if(!props.canWrite||!props.ready)return;
 Object.assign(towerForm,{tower_no:'',management_department:'',maintenance_team:'',tower_type:'',model:'',height:'',longitude:'',latitude:''});
 towerDialog.value=true;
}
function stageTower(){
 const name=towerForm.tower_no.trim();
 if(!name){message.value='请填写杆塔编号';return}
 if(ordered.value.some(n=>n.tower_no===name)){message.value='当前线路已存在相同杆塔编号';return}
 if((towerForm.longitude&&!towerForm.latitude)||(!towerForm.longitude&&towerForm.latitude)){message.value='经纬度应同时填写或同时留空';return}
 if(towerForm.longitude&&(!Number.isFinite(Number(towerForm.longitude))||Math.abs(Number(towerForm.longitude))>180||!Number.isFinite(Number(towerForm.latitude))||Math.abs(Number(towerForm.latitude))>90)){message.value='经纬度超出允许范围';return}
 const draft:DraftTower={client_id:'draft-'+newClientId().replace(/[^a-z0-9-]/gi,'').toLowerCase().slice(0,35),
  after_id:selected.value||null,data:{...towerForm,tower_no:name}};
 commitChange(()=>draftTowers.value.push(draft));selected.value=draft.client_id;towerDialog.value=false;
 focus(draft.client_id);
}
function stageSequentialSpans(){
 if(!props.canWrite||!props.ready)return;
 const candidates:DraftSpan[]=[];
 const order=ordered.value.filter(n=>n.status!=='inactive');
 for(let i=1;i<order.length;i++){
  const a=order[i-1],b=order[i];
  if(links.value.some(e=>(e.start===a.id&&e.end===b.id)||(e.start===b.id&&e.end===a.id)))continue;
  candidates.push({start_id:a.id,end_id:b.id});
 }
 if(!candidates.length){message.value='沿线相邻杆塔的档距均已建立';return}
 if(candidates.length>200){message.value='当前缺少 '+candidates.length+' 条档距。为保证单次提交安全，请先分批建立（每批最多200条）。';return}
 commitChange(()=>draftSpans.value.push(...candidates));
}

function draftBody(){return {version:props.workspace.line.version,topology_token:props.workspace.topology_token,
 towers:draftTowers.value,spans:draftSpans.value}}
async function showPreview(){
 if(!pending.value)return;
 previewBusy.value=true;message.value='';
 try{const body=draftBody();preview.value=await requestApi('/ledger/lines/'+props.lineId+'/topology/preview','POST',body);
  previewSignature.value=JSON.stringify(body);previewDialog.value=true;
 }catch(e:any){message.value=e?.message||'拓扑预览失败'}finally{previewBusy.value=false}
}
async function apply(){
 if(!preview.value||previewSignature.value!==JSON.stringify(draftBody())){message.value='拓扑草稿已变化，请重新预览';previewDialog.value=false;return}
 saving.value=true;message.value='';
 try{
  await requestApi('/ledger/lines/'+props.lineId+'/topology','POST',{...draftBody(),idempotency_key:newClientId()});
  clearDraft();emit('committed');
 }catch(e:any){message.value=e?.message||'拓扑提交失败，未修改任何记录';previewDialog.value=false}
 finally{saving.value=false}
}
</script>

<template>
 <section class="topology-workspace" aria-label="二维线路拓扑编辑器">
  <div class="topology-toolbar">
   <div class="topology-heading"><h2>二维拓扑工作台</h2><p>选中节点查看杆塔；连接模式依次点击两基杆塔形成待提交档距。</p></div>
   <div class="topology-controls">
    <ElSelect v-model="layout" aria-label="拓扑布局" class="topology-layout-select">
     <ElOption label="逻辑拓扑" value="logical"/><ElOption label="地理坐标" value="geo"/>
    </ElSelect>
    <ElButton :type="mode==='select'?'primary':'default'" @click="mode='select';firstEndpoint=''">选择</ElButton>
    <ElButton :type="mode==='connect'?'primary':'default'" :disabled="!ready||!canWrite" @click="mode='connect';firstEndpoint=''">连接档距</ElButton>
    <ElButton type="primary" :disabled="!ready||!canWrite" @click="openAddTower">新增杆塔</ElButton>
    <ElButton :disabled="!ready||!canWrite||ordered.length<2" @click="stageSequentialSpans">按顺序生成待建档距</ElButton>
   </div>
  </div>
  <div class="topology-canvas-wrap">
   <svg ref="canvasElement" class="topology-canvas" :viewBox="viewBox" aria-label="杆塔和档距的二维平面拓扑图" @pointerdown="panStart" @pointermove="panMove" @pointerup="panEnd" @pointercancel="panEnd" @wheel.prevent="wheelZoom">
    <defs><pattern id="topology-grid" :width="24/pixelsPerUnit" :height="24/pixelsPerUnit" patternUnits="userSpaceOnUse"><circle :cx="1.5/pixelsPerUnit" :cy="1.5/pixelsPerUnit" :r="1/pixelsPerUnit" fill="#D4E0F0"/></pattern></defs>
    <rect :x="camera.x" :y="camera.y" :width="camera.w" :height="camera.h" fill="#F8FBFF"/>
    <rect :x="camera.x" :y="camera.y" :width="camera.w" :height="camera.h" fill="url(#topology-grid)" style="touch-action:none"/>
    <template v-for="e in visibleLinks" :key="e.id">
     <line :x1="nodeMap.get(e.start)?.x" :y1="nodeMap.get(e.start)?.y" :x2="nodeMap.get(e.end)?.x" :y2="nodeMap.get(e.end)?.y"
      :stroke="e.draft?'#E39A35':'#3478F6'" :stroke-width="(e.draft?3.5:2.6)/pixelsPerUnit" :stroke-dasharray="e.draft?'9 5':undefined" stroke-linecap="round"/>
    </template>
    <g v-for="n in visibleNodes" :key="n.id" class="topology-node" role="button" :aria-label="'选择杆塔 '+n.tower_no" tabindex="0"
     @click.stop="clickNode(n)" @keydown.enter.prevent="clickNode(n)" @keydown.space.prevent="clickNode(n)">
     <title>{{n.tower_no}}</title>
     <circle :cx="n.x" :cy="n.y" :r="(selected===n.id?15:10)/pixelsPerUnit" :fill="n.draft?'#FFF3DB':selected===n.id?'#D9EAFE':'white'" :stroke="n.draft?'#E39A35':'#3478F6'" :stroke-width="(selected===n.id?3.5:2.4)/pixelsPerUnit"/>
     <circle v-if="firstEndpoint===n.id" :cx="n.x" :cy="n.y" :r="23/pixelsPerUnit" fill="none" stroke="#3478F6" :stroke-width="2/pixelsPerUnit" :stroke-dasharray="(4/pixelsPerUnit)+' '+(4/pixelsPerUnit)"/>
     <text v-if="visibleLabelIds.has(n.id)" class="topology-label" :x="n.x"
      :y="n.y-((selected===n.id?15:10)+9)/pixelsPerUnit" text-anchor="middle"
      :font-size="labelFontUnits" font-weight="600" fill="#334A69">{{topologyTowerLabel(n.tower_no,workspace.line?.name)}}</text>
     <text v-if="n.is_junction && pixelsPerUnit>0.9" :x="n.x" :y="n.y+28/pixelsPerUnit"
      text-anchor="middle" :font-size="10/pixelsPerUnit" fill="#667A95">接入</text>
    </g>
   </svg>
   <div class="topology-zoom">
    <ElButton size="small" aria-label="放大拓扑" @click="zoom(.75)">＋</ElButton>
    <ElButton size="small" aria-label="缩小拓扑" @click="zoom(1.35)">－</ElButton>
    <ElButton size="small" @click="fitAll">适应画布</ElButton>
   </div>
   <div class="topology-legend"><span><i class="legend-dot"/>现有杆塔</span><span><i class="legend-dot draft"/>待新增</span><span><i class="legend-line"/>现有档距</span><span><i class="legend-line draft"/>待新增档距</span></div>
  </div>
  <p v-if="layout==='geo'" class="topology-help">地理布局按真实经纬度相对排列；没有坐标的杆塔列于下方待定位区域，画布平移不改变真实坐标。</p>
  <p v-else class="topology-help">逻辑布局按杆塔沿线顺序排列。未建立的档距不会自动创建，必须使用「连接档距」操作。</p>
  <p v-if="mode==='connect'&&firstEndpoint" class="topology-help">已选择起点杆塔，请点击终点杆塔。</p>
  <p v-if="message" class="alert error" role="alert">{{message}}</p>
  <div v-if="selectedNode" class="topology-selected">
   <div><small>当前选中杆塔</small><strong>{{selectedNode.tower_no}}</strong><p>{{selectedNode.management_department||'管辖部门待填写'}} · {{selectedNode.draft?'待提交':'已入库'}}</p></div>
   <div class="topology-controls">
    <ElButton v-if="!selectedNode.draft" @click="emit('openTower',selectedNode.id)">查看详情</ElButton>
    <ElButton v-if="canWrite&&ready" @click="openAddTower">在此杆塔后插入</ElButton>
   </div>
  </div>
  <ElCard shadow="never" class="topology-change-summary">
   <div class="topology-change-head">
    <div><strong>本次待提交变更</strong><p>{{draftTowers.length}} 基新增杆塔 · {{draftSpans.length}} 条新增档距</p></div>
    <div class="topology-controls">
     <ElButton :disabled="!past.length" @click="undo">撤销</ElButton><ElButton :disabled="!future.length" @click="redo">重做</ElButton>
     <ElButton :disabled="!pending" @click="clearDraft">放弃变更</ElButton>
     <ElButton type="primary" :disabled="!pending||!ready||!canWrite" :loading="previewBusy" @click="showPreview">预览变更</ElButton>
    </div>
   </div>
   <ElEmpty v-if="!pending" description="尚无待提交变更。可在画布上选择杆塔，新增杆塔或连接档距。" :image-size="55"/>
   <div v-else class="topology-pending-list">
    <ElTag v-for="t in draftTowers" :key="t.client_id" type="warning" effect="light">新增杆塔 {{t.data.tower_no}}</ElTag>
    <ElTag v-for="(e,i) in draftSpans" :key="i" type="warning" effect="light">连接 {{nodeMap.get(e.start_id)?.tower_no}}—{{nodeMap.get(e.end_id)?.tower_no}}</ElTag>
   </div>
  </ElCard>
  <ElDialog v-model="towerDialog" title="暂存新增杆塔" width="500px" append-to-body>
   <ElForm novalidate label-position="top" @submit.prevent="stageTower">
    <ElFormItem label="杆塔编号" required><ElInput v-model="towerForm.tower_no" placeholder="例如 001A"/></ElFormItem>
    <ElFormItem label="管辖部门"><ElInput v-model="towerForm.management_department"/></ElFormItem>
    <ElFormItem label="代维队"><ElInput v-model="towerForm.maintenance_team"/></ElFormItem>
    <div class="topology-coordinates">
     <ElFormItem label="结构类型"><ElInput v-model="towerForm.tower_type"/></ElFormItem>
     <ElFormItem label="型号"><ElInput v-model="towerForm.model"/></ElFormItem>
    </div>
    <ElFormItem label="塔高（米）"><ElInput v-model="towerForm.height" placeholder="正数，最多四位小数"/></ElFormItem>
    <div class="topology-coordinates">
     <ElFormItem label="真实经度（可留空）"><ElInput v-model="towerForm.longitude" placeholder="例如 118.8"/></ElFormItem>
     <ElFormItem label="真实纬度（可留空）"><ElInput v-model="towerForm.latitude" placeholder="例如 32.1"/></ElFormItem>
    </div>
   </ElForm>
   <p class="topology-help">画布位置仅用于展示。经纬度只有明确填写后才作为杆塔属性保存。</p>
   <template #footer><ElButton @click="towerDialog=false">取消</ElButton><ElButton type="primary" @click="stageTower">加入待提交变更</ElButton></template>
  </ElDialog>
  <ElDialog v-model="previewDialog" title="拓扑变更预览 · 一次确认提交" width="600px" append-to-body>
   <div v-if="preview" class="topology-preview">
    <p>本次将新增 <strong>{{preview.tower_count}}</strong> 基杆塔和 <strong>{{preview.span_count}}</strong> 条档距。</p>
    <p>提交前已检查杆塔编号、起终点、重复档距及拓扑版本；提交将作为单个数据库事务执行，任一步失败则全部回滚。</p>
    <div v-for="t in preview.towers" :key="t.client_id" class="topology-diff-line">＋ 杆塔 {{t.tower_no}}</div>
    <div v-for="e in draftSpans" :key="e.start_id+e.end_id" class="topology-diff-line">＋ 档距 {{nodeMap.get(e.start_id)?.tower_no}} — {{nodeMap.get(e.end_id)?.tower_no}}</div>
   </div>
   <template #footer><ElButton :disabled="saving" @click="previewDialog=false">返回编辑</ElButton><ElButton type="primary" :loading="saving" @click="apply">确认并一次提交</ElButton></template>
  </ElDialog>
 </section>
</template>
<style scoped>
.topology-workspace{min-width:0;display:flex;flex-direction:column;gap:16px}.topology-toolbar,.topology-change-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap}.topology-heading h2{font-size:18px;margin:0 0 7px}.topology-heading p,.topology-change-head p{margin:0;color:#76849a;font-size:12px}.topology-controls{display:flex;flex-wrap:wrap;gap:7px;align-items:center}.topology-layout-select{width:142px}.topology-canvas-wrap{position:relative;border:1px solid #dce6f4;border-radius:12px;overflow:hidden;background:#f8fbff}.topology-canvas{display:block;width:100%;height:440px;cursor:grab;touch-action:none}.topology-canvas:active{cursor:grabbing}.topology-node{cursor:pointer;outline:none}.topology-node:focus circle{stroke:#174ca7}.topology-zoom{position:absolute;top:12px;right:12px;display:flex;gap:5px}.topology-legend{position:absolute;left:12px;bottom:12px;display:flex;gap:12px;flex-wrap:wrap;background:#fffffff0;border:1px solid #e3ebf5;border-radius:8px;padding:9px 12px;font-size:11px;color:#64748b}.topology-legend span{display:inline-flex;gap:5px;align-items:center}.legend-dot{width:9px;height:9px;border:2px solid #3478f6;border-radius:100%;display:inline-block}.legend-dot.draft{border-color:#e39a35;background:#fff3db}.legend-line{width:17px;height:0;border-top:2px solid #3478f6;display:inline-block}.legend-line.draft{border-color:#e39a35;border-top-style:dashed}.topology-help{font-size:12px;color:#74839a;margin:0}.topology-selected{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;background:#f3f7ff;border-radius:10px;padding:13px 16px}.topology-selected small{display:block;color:#70819a;font-size:11px}.topology-selected strong{font-size:18px;color:#284a76}.topology-selected p{margin:4px 0 0;font-size:12px;color:#70819a}.topology-change-summary :deep(.el-card__body){padding:17px}.topology-change-head strong{font-size:15px}.topology-pending-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.topology-coordinates{display:grid;grid-template-columns:1fr 1fr;gap:12px}.topology-preview p{line-height:1.65;color:#596d89}.topology-diff-line{border-bottom:1px solid #edf1f7;padding:10px;color:#1d6bba;font-size:13px}@media(max-width:760px){.topology-canvas{height:330px}.topology-coordinates{grid-template-columns:1fr}.topology-legend{right:12px}}
</style>
