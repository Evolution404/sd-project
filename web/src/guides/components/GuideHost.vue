<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import type { Actor } from "../../../../server/shared/types/contracts";
import { api } from "../../shared/api/client";
import { guideModules, guideModuleForRoute } from "../registry/modules";
import { guideActions } from "../registry/actions";
import { guideCourses } from "../registry/journeys";
import { clearProgress, readProgress, writeProgress, GUIDE_COURSE_VERSION, type LearningProgress } from "../core/progress";
import { resolveGuideTarget, resolveGuideActionTarget } from "../core/target-resolver";
import type { GuideAction, GuideModule, GuideCourse } from "../core/types";
const props = defineProps<{open:boolean; actor:Actor; routeKey:string}>();
const emit = defineEmits<{ "update:open":[boolean] }>();
const open = computed({ get:()=>props.open, set:v=>emit("update:open",v) });
const tab = ref("current"), query=ref(""), tourOpen=ref(false), tourStep=ref(0);
const selectedCourse = ref<GuideCourse|null>(null);
const courseStep = ref(0);
const selectedModule = ref<GuideModule|null>(null);
const selectedAction = ref<GuideAction|null>(null);
const tourSteps = computed(() => selectedAction.value ? [{
  id:selectedAction.value.id,
  title:selectedAction.value.title,
  target:'[data-guide-action="'+selectedAction.value.id+'"]',
  description:selectedAction.value.purpose+"；操作前："+selectedAction.value.prerequisite+
    "；正式结果："+selectedAction.value.result+"；风险："+selectedAction.value.risk,
}] : (tourModule.value?.steps??[]));
const progress = ref<Readonly<Record<string,LearningProgress>>>({});
type CourseCheck = {id:string;completed:boolean;details:string};
type TrainingChecks = {training:boolean;courses:CourseCheck[]};
const trainingChecks = ref<TrainingChecks|null>(null);
const trainingLoading = ref(false);
const trainingError = ref("");
let trainingRequest=0;
async function refreshTraining(){
  const current=++trainingRequest;
  trainingLoading.value=true;trainingError.value="";
  try {
    const response=await api<TrainingChecks>("/training/checkpoints");
    if(current===trainingRequest)trainingChecks.value=response;
  }catch(error){
    if(current===trainingRequest)trainingError.value=
      error instanceof Error?error.message:"实操验收暂不可用";
  }finally{
    if(current===trainingRequest)trainingLoading.value=false;
  }
}
function checkpoint(courseId:string){
  return trainingChecks.value?.courses.find(c=>c.id===courseId);
}
const currentModule = computed(()=>guideModuleForRoute(props.routeKey));
const tourModule = computed(()=>selectedModule.value??currentModule.value);
const filteredActions = computed(()=>{
  const q=query.value.trim().toLocaleLowerCase();
  return guideActions.filter(a=>(!q ? a.module===props.routeKey :
    [a.title,a.id,a.purpose,...a.aliases].some(x=>x.toLocaleLowerCase().includes(q))));
});
const moduleActions = computed(()=>guideActions.filter(a=>a.module===(selectedModule.value?.id??currentModule.value?.id)));
const roleLabel:Readonly<Record<string,string>>={
  admin:"管理员",editor:"编辑人员",verifier:"审核人员",viewer:"只读人员"
};
watch(()=>props.actor.id,()=>{
  progress.value=readProgress(props.actor.id);selectedCourse.value=null;
  courseStep.value=0;tourOpen.value=false;
  trainingRequest++;trainingChecks.value=null;trainingError.value="";
},{immediate:true});
watch(()=>props.routeKey,()=>{
  tourOpen.value=false;selectedModule.value=null;selectedAction.value=null;tourStep.value=0;
});
watch(()=>props.open,(value)=>{
  // Starting a tour intentionally closes the drawer. Do not close the tour
  // from this drawer-close watcher; only route/logout/ElTour close may do so.
  if(value) progress.value=readProgress(props.actor.id);
  else trainingRequest++;
});
function startTour(module:GuideModule) {
  selectedAction.value=null;selectedModule.value=module;
  tourStep.value=0;
  open.value=false;
  tourOpen.value=true;
}
function closeTour() {tourOpen.value=false;selectedModule.value=null;selectedAction.value=null;}
function locateAction(action:GuideAction) {
  if (!resolveGuideActionTarget(action.id)) {
    ElMessage.warning("当前没有唯一可定位的“"+action.title+"”控件。请进入所属业务模块，切换对应页签或打开具体单据后重试；不会自动办理任何业务。");
    return;
  }
  selectedModule.value=null;
  selectedAction.value=action;
  tourStep.value=0;
  open.value=false;
  tourOpen.value=true;
}
function finishTour() {
  closeTour();
  ElMessage.info("已阅读页面说明。实际业务操作和训练完成需要分别验证。");
}
function openCourse(course:GuideCourse) {
  selectedCourse.value=course;
  courseStep.value=progress.value[course.id]?.stepIndex??0;
  tab.value="training";
  void refreshTraining();
}
function saveReading(isFinal:boolean) {
  const course=selectedCourse.value;
  if(!course) return;
  const changed:Record<string,LearningProgress>={...progress.value,[course.id]:{
    courseId:course.id,version:GUIDE_COURSE_VERSION,
    state:isFinal?"read":"reading",
    stepIndex:isFinal?course.instructions.length-1:courseStep.value,
  }};
  progress.value=changed;writeProgress(props.actor.id,changed);
}
function nextReading() {
  const course=selectedCourse.value;
  if(!course) return;
  if(courseStep.value+1>=course.instructions.length) {
    saveReading(true);
    ElMessage.success("仅记录为“已阅读”；训练成功仍需服务端核验。");
    return;
  }
  courseStep.value++;saveReading(false);
}
async function resetProgress() {
  try {
    await ElMessageBox.confirm("仅清除当前账号在本浏览器中的说明阅读记录，不修改任何业务数据。","清除学习记录");
    clearProgress(props.actor.id); progress.value={};courseStep.value=0;
  } catch { /* user cancelled */ }
}
function showCourseRoute(course:GuideCourse) {
  // Avoid route navigation that could bypass an unsaved business editor's draft guard.
  const target=guideModules.find(m=>m.id===course.routeName);
  return target?.title??"专业需求 / Excel专题";
}
function hasRole(roles:readonly string[]) {return roles.includes(props.actor.role);}
function closeCourse() {selectedCourse.value=null;courseStep.value=0;}
</script>
<template>
  <ElDrawer v-model="open" title="使用指引" class="sd-guide-center" size="min(580px,96vw)"
    :close-on-click-modal="true" :destroy-on-close="false">
    <p class="guide-intro">了解每项业务操作的前置条件、正式结果与风险。阅读说明不会自动修改业务数据。</p>
    <ElTabs v-model="tab" class="guide-tabs">
      <ElTabPane label="当前页面" name="current">
        <template v-if="currentModule">
          <div class="guide-section-title">{{ currentModule.title }}</div>
          <p>{{ currentModule.summary }}</p>
          <ElButton type="primary" data-guide-action="guide.page-tour"
            @click="startTour(currentModule)">开始当前页面导览</ElButton>
          <h3>本模块的主要操作</h3>
          <ElCollapse>
            <ElCollapseItem v-for="action in moduleActions" :key="action.id"
              :title="action.title" :name="action.id">
              <p>{{ action.purpose }}</p>
              <ElButton size="small" text type="primary" @click="locateAction(action)">定位当前按钮</ElButton>
              <p><strong>操作前：</strong>{{ action.prerequisite }}</p>
              <p><strong>操作后：</strong>{{ action.result }}</p>
              <p><strong>风险与历史：</strong>{{ action.risk }}</p>
              <p><strong>适用身份：</strong>{{ action.roles.map(role=>roleLabel[role]).join("、") }}
                <ElTag v-if="!hasRole(action.roles)" type="info" size="small">当前角色一般不可办理</ElTag>
              </p>
              <p v-if="action.states.join(',')!=='any'"><strong>典型状态：</strong>{{ action.states.join("、") }}</p>
            </ElCollapseItem>
          </ElCollapse>
        </template>
        <ElEmpty v-else description="当前页面没有独立业务导览，可通过操作搜索查找相关帮助。" />
      </ElTabPane>
      <ElTabPane label="操作搜索" name="search">
        <ElInput v-model="query" clearable placeholder="搜索：入库、结算、预检、数量、删除等"
          aria-label="搜索业务操作说明" />
        <div class="guide-result-count">共 {{ filteredActions.length }} 条操作解释</div>
        <ElCollapse>
          <ElCollapseItem v-for="action in filteredActions" :key="action.id"
            :title="action.title+' · '+action.module" :name="action.id">
            <p>{{ action.purpose }}</p>
            <ElButton size="small" text type="primary" @click="locateAction(action)">定位当前按钮</ElButton>
            <p><strong>前置条件：</strong>{{ action.prerequisite }}</p>
            <p><strong>业务结果：</strong>{{ action.result }}</p>
            <p><strong>风险：</strong>{{ action.risk }}</p>
            <p><strong>角色：</strong>{{ action.roles.map(role=>roleLabel[role]).join("、") }}</p>
            <p v-if="!hasRole(action.roles)">当前账号缺少该操作的典型角色，实际以服务器授权为准。</p>
          </ElCollapseItem>
        </ElCollapse>
      </ElTabPane>
      <ElTabPane label="模块导览" name="modules">
        <div class="guide-module-list">
          <article v-for="module in guideModules" :key="module.id" class="guide-module-item">
            <strong>{{ module.title }}</strong>
            <p>{{ module.summary }}</p>
            <ElButton v-if="module.id===routeKey" text type="primary"
              @click="startTour(module)">开始短导览</ElButton>
            <span v-else class="guide-subtle">先通过原导航进入该模块，再启动导览</span>
          </article>
        </div>
        <article class="guide-module-item">
          <strong>Excel批量处理专题</strong>
          <p>使用稳定关联号，下载中文模板、预检、修正、合法部分或整批原子提交并回查。</p>
          <ElButton text type="primary" @click="tab='search';query='Excel'">查看Excel操作说明</ElButton>
        </article>
      </ElTabPane>
      <ElTabPane label="业务课程" name="training">
        <template v-if="!selectedCourse">
          <p class="guide-subtle">分段学习并在独立训练实例中亲自完成真实业务。课程“已阅读”与服务器核实的“实操通过”严格分开。</p>
          <div class="guide-course-actions">
            <ElButton :loading="trainingLoading" @click="refreshTraining">核验实操结果</ElButton>
            <ElTag v-if="trainingChecks?.training" type="success">独立训练实例</ElTag>
            <ElTag v-else-if="trainingChecks && !trainingChecks.training" type="info">正式环境只读教学</ElTag>
          </div>
          <ElAlert v-if="trainingError" type="warning" :closable="false" :title="trainingError" />
          <p v-if="trainingChecks && !trainingChecks.training" class="guide-subtle">
            本服务器不是训练实例。请由管理员通过“启动训练环境”启动独立实例后登录该地址，
            课程完成检查只认训练服务器真实业务记录，无法通过浏览器参数启用。
          </p>
          <article v-for="course in guideCourses" :key="course.id" class="guide-course-row">
            <div>
              <strong>{{ course.id }} {{ course.title }}</strong>
              <p>{{ course.purpose }}</p>
              <span class="guide-subtle">由 {{ course.roles.map(role=>roleLabel[role]).join("、") }} 参与</span>
              <ElTag v-if="checkpoint(course.id)?.completed" type="success" size="small">实操通过</ElTag>
              <ElTag v-else-if="trainingChecks?.training" type="info" size="small">尚未完成</ElTag>
            </div>
            <ElButton @click="openCourse(course)">{{progress[course.id]?.state==="read"?"重学":"阅读"}}</ElButton>
          </article>
          <ElButton class="guide-reset" text @click="resetProgress">清除本账号在本机的学习记录</ElButton>
        </template>
        <template v-else>
          <ElButton text @click="closeCourse">返回全部课程</ElButton>
          <h3>{{selectedCourse.id}} {{selectedCourse.title}}</h3>
          <p>{{selectedCourse.purpose}}</p>
          <ElAlert type="info" :closable="false"
            :title="'前往业务模块：'+showCourseRoute(selectedCourse)+'（需用户主动通过原导航进入）'" />
          <ElSteps :active="courseStep" direction="vertical" class="guide-course-steps">
            <ElStep v-for="(instruction,index) in selectedCourse.instructions" :key="index"
              :title="instruction" :status="index<courseStep?'finish':index===courseStep?'process':'wait'" />
          </ElSteps>
          <p><strong>实际完成检查：</strong>{{selectedCourse.checkpoint}}</p>
          <ElAlert v-if="!trainingChecks?.training" type="warning" :closable="false"
            title="正式环境没有训练验收：仅可阅读与使用导览。请在独立训练实例中完成练习。" />
          <ElAlert v-else-if="checkpoint(selectedCourse.id)?.completed"
            type="success" :closable="false"
            :title="'真实业务检查通过：'+checkpoint(selectedCourse.id)?.details" />
          <ElAlert v-else type="info" :closable="false"
            :title="'尚未取得真实业务完成证据：'+(checkpoint(selectedCourse.id)?.details||selectedCourse.checkpoint)" />
          <ElButton :loading="trainingLoading" @click="refreshTraining">重新核验课程完成状态</ElButton>
          <div class="guide-course-actions">
            <ElButton :disabled="courseStep===0" @click="courseStep--;saveReading(false)">上一步</ElButton>
            <ElButton type="primary" @click="nextReading">
              {{courseStep+1===selectedCourse.instructions.length?"标记已阅读":"下一步"}}
            </ElButton>
          </div>
        </template>
      </ElTabPane>
    </ElTabs>
  </ElDrawer>
  <ElTour v-model="tourOpen" :current="tourStep" :mask="true"
    :target-area-clickable="false" :close-on-press-escape="true"
    @change="tourStep=$event" @close="closeTour" @finish="finishTour">
    <ElTourStep v-for="step in tourSteps" :key="step.id"
      :target="()=>selectedAction ? resolveGuideActionTarget(selectedAction.id) : resolveGuideTarget(step.target)"
      :title="step.title"
      :description="step.description" />
  </ElTour>
</template>
<style scoped>
.guide-intro,.guide-subtle {font-size:13px;color:var(--muted)}
.guide-section-title {font-size:17px;font-weight:650;margin:3px 0 10px}
.guide-result-count{font-size:12px;color:var(--muted);margin:9px 0}
.guide-module-list {display:grid;grid-template-columns:1fr 1fr;gap:10px}
.guide-module-item,.guide-course-row{padding:14px;border:1px solid var(--edge);border-radius:12px}
.guide-module-item p,.guide-course-row p{font-size:13px;line-height:1.6;margin:6px 0}
.guide-module-item .el-button{margin-top:5px}
.guide-course-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
.guide-course-row p{margin:5px 0}
.guide-course-actions{display:flex;gap:8px;margin-top:15px}
.guide-reset{margin-top:12px}
.guide-course-steps{margin:18px 0}
@media(max-width:520px){.guide-module-list{grid-template-columns:1fr}}
</style>
