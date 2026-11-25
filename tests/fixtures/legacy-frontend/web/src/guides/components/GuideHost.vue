<script setup lang="ts">
import { computed, nextTick, ref, watch, type CSSProperties } from "vue";
import { useRoute, useRouter } from "vue-router";
import { navigationItems } from "../../app/navigation";
import { ElMessageBox, useZIndex } from "element-plus";
import type { Actor } from "../../../../server/shared/types/contracts";
import { api } from "../../shared/api/client";
import { guideModules, guideModuleForRoute } from "../registry/modules";
import { guideActions } from "../registry/actions";
import { guideCourses } from "../registry/journeys";
import { clearProgress, readProgress, writeProgress, GUIDE_COURSE_VERSION, type LearningProgress } from "../core/progress";
import { hasActiveGuideWorkspace, resolveGuideTarget, resolveGuideAction, resolveGuideActionTarget } from "../core/target-resolver";
import type { GuideAction, GuideModule, GuideCourse } from "../core/types";
import PracticeJourney from "./PracticeJourney.vue";
const props = defineProps<{open:boolean; actor:Actor; routeKey:string}>();
const emit = defineEmits<{ "update:open":[boolean] }>();
const open = computed({ get:()=>props.open, set:v=>emit("update:open",v) });
const route = useRoute(), router = useRouter();
const tab = ref("current"), query=ref(""), tourOpen=ref(false), tourStep=ref(0);
const feedback = ref("");
const feedbackRegion = ref<HTMLElement>();
let pendingTour = false;
const { nextZIndex } = useZIndex();
const tourZIndex = ref<number>();
// Keep tutorial controls reachable even when the highlighted surface is larger than the viewport.
const tourCardStyle: CSSProperties = {
  position: "fixed",
  top: "auto",
  left: "auto",
  right: "12px",
  bottom: "12px",
  transform: "none",
  width: "min(520px, calc(100vw - 24px))",
  maxWidth: "calc(100vw - 24px)",
  maxHeight: "calc(100dvh - 24px)",
  overflowY: "auto",
};
const selectedCourse = ref<GuideCourse|null>(null);
const courseStep = ref(0);
const selectedModule = ref<GuideModule|null>(null);
const selectedAction = ref<GuideAction|null>(null);
const selectedActionHint = ref("");
const tourSteps = computed(() => selectedAction.value ? [{
  id:selectedAction.value.id,
  title:selectedAction.value.title,
  target:"",
  description:[selectedActionHint.value, selectedAction.value.purpose, selectedAction.value.prerequisite,
    selectedAction.value.result, selectedAction.value.risk].filter(Boolean).join("。"),
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
const stateLabels: Readonly<Record<string,string>> = {
  empty:"尚无记录",pending:"待确认",returned:"已退回",active:"有效",
  reserve:"储备",stocked:"已入库",approved:"已批准",
};
const stateLabel = (state:string) => stateLabels[state] ?? state;
const roleLabel:Readonly<Record<string,string>>={
  admin:"管理员",editor:"编辑人员",verifier:"审核人员",viewer:"只读人员"
};
watch(()=>props.actor.id,()=>{
  progress.value=readProgress(props.actor.id);selectedCourse.value=null;
  courseStep.value=0;closeTour();
  trainingRequest++;trainingChecks.value=null;trainingError.value="";trainingLoading.value=false;
},{immediate:true});
watch(() => route.fullPath, () => {
  closeTour();
  tourStep.value = 0;
  feedback.value = "";
});
watch([open, tab], ([visible, activeTab]) => {
  feedback.value = "";
  if (visible && activeTab === "training" && !trainingChecks.value && !trainingLoading.value)
    void refreshTraining();
});
watch(()=>props.open,(value)=>{
  // Starting a tour intentionally closes the drawer. Do not close the tour
  // from this drawer-close watcher; only route/logout/ElTour close may do so.
  if (value) {
    pendingTour = false;
    feedback.value = "";
    progress.value = readProgress(props.actor.id);
  } else {
    trainingRequest++;
    trainingLoading.value = false;
  }
});
function queueTour() {
  tourStep.value = 0;
  pendingTour = true;
  open.value = false;
}
function launchPendingTour() {
  if (!pendingTour || open.value) return;
  pendingTour = false;
  tourZIndex.value = nextZIndex();
  tourOpen.value = true;
}
function startTour(module: GuideModule) {
  selectedAction.value = null;
  selectedModule.value = module;
  queueTour();
}
function closeTour() {
  pendingTour = false;
  tourOpen.value = false;
  selectedModule.value = null;
  selectedAction.value = null;
}
function showFeedback(message: string) {
  feedback.value = message;
  void nextTick(() => feedbackRegion.value?.scrollIntoView({ block: "nearest" }));
}
function locateAction(action: GuideAction) {
  const target = resolveGuideAction(action.id);
  if (!target) {
    showFeedback(`当前没有唯一可定位的「${action.title}」控件。请核对权限、页签及单据状态，或打开具体记录后重试。`);
    return;
  }
  selectedModule.value = null;
  selectedAction.value = action;
  selectedActionHint.value = target.menu ? `打开高亮的菜单后选择「${action.title}」` : target.reason;
  queueTour();
}
function moduleDestination(key: string) {
  const item = navigationItems.find(entry => entry.key === key);
  return item && (!item.adminOnly || props.actor.role === "admin") ? item : undefined;
}
async function goToModule(key: string) {
  if (!moduleDestination(key)) return;
  feedback.value = "";
  if (hasActiveGuideWorkspace()) {
    showFeedback("请先关闭指引，保存或退出当前详情及办理，再前往其他模块。");
    return;
  }
  try {
    if (key !== props.routeKey && await router.push({ name: key })) {
      showFeedback("未离开当前页面。请处理当前业务提示后重试。");
      return;
    }
    open.value = false;
  } catch {
    showFeedback("无法打开业务页面，请重试。");
  }
}
function openCourse(course:GuideCourse) {
  selectedCourse.value=course;
  const previous = progress.value[course.id];
  courseStep.value = previous?.state === "reading" ? previous.stepIndex : 0;
  tab.value="training";
  if (!trainingChecks.value && !trainingLoading.value) void refreshTraining();
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
const currentCourseRead = computed(() =>
  selectedCourse.value && courseStep.value === selectedCourse.value.instructions.length - 1 &&
  progress.value[selectedCourse.value.id]?.state === "read");
const courseDestination = computed(() => {
  const course = selectedCourse.value;
  if (!course) return undefined;
  return moduleDestination(course.routeName === "excel" ? "demands" : course.routeName);
});
function hasRole(roles:readonly string[]) {return roles.includes(props.actor.role);}
function closeCourse() {selectedCourse.value=null;courseStep.value=0;}
</script>
<template>
  <ElDrawer v-model="open" title="使用指引" class="sd-guide-center" size="min(580px,96vw)"
    :close-on-click-modal="true" :destroy-on-close="false" @closed="launchPendingTour">
    <p class="guide-intro">了解每项业务操作的前置条件、正式结果与风险。阅读说明不会自动修改业务数据。</p>
    <div v-if="feedback" ref="feedbackRegion" class="guide-feedback">
      <ElAlert :title="feedback" type="info" :closable="false" />
    </div>
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
              <p v-if="action.states.join(',')!=='any'"><strong>典型状态：</strong>{{ action.states.map(stateLabel).join("、") }}</p>
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
            :title="action.title + ' · ' + (guideModuleForRoute(action.module)?.title ?? '导入 Excel')" :name="action.id">
            <p>{{ action.purpose }}</p>
            <ElButton v-if="action.module !== routeKey && moduleDestination(action.module)" size="small" text type="primary"
              @click="goToModule(action.module)">前往{{ moduleDestination(action.module)?.title }}</ElButton>
            <ElButton v-else size="small" text type="primary" @click="locateAction(action)">定位当前按钮</ElButton>
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
            <ElButton v-else-if="moduleDestination(module.id)" text type="primary"
              @click="goToModule(module.id)">前往{{ module.title }}</ElButton>
            <span v-else class="guide-subtle">当前账号无权访问</span>
          </article>
        </div>
        <article class="guide-module-item">
          <strong>使用 Excel 导入和导出</strong>
          <p>下载模板并填写，上传检查，有问题时按提示修改。保存后可打开已导入的记录。</p>
          <ElButton text type="primary" @click="tab='search';query='Excel'">查看Excel操作说明</ElButton>
        </article>
      </ElTabPane>
      <ElTabPane label="全流程实操" name="practice" lazy>
        <PracticeJourney v-if="open && tab === 'practice'" :key="actor.id" @navigate="open = false" />
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
          <ElButton v-if="courseDestination" text type="primary" @click="goToModule(courseDestination.key)">
            前往{{ courseDestination.title }}
          </ElButton>
          <ElSteps :active="courseStep" direction="vertical" class="guide-course-steps">
            <ElStep v-for="(instruction,index) in selectedCourse.instructions" :key="index"
              :title="instruction" :status="index<courseStep?'finish':index===courseStep?'process':'wait'" />
          </ElSteps>
          <p><strong>实际完成检查：</strong>{{selectedCourse.checkpoint}}</p>
          <ElAlert v-if="trainingError" :title="trainingError" type="warning" :closable="false" />
          <p v-else-if="trainingLoading" class="guide-subtle" role="status">正在读取实操验收状态</p>
          <ElAlert v-else-if="trainingChecks && !trainingChecks.training" type="info" :closable="false"
            title="当前环境可阅读指引。课程实操由独立训练实例核验。" />
          <ElAlert v-else-if="checkpoint(selectedCourse.id)?.completed"
            type="success" :closable="false"
            :title="'真实业务检查通过：'+checkpoint(selectedCourse.id)?.details" />
          <ElAlert v-else-if="trainingChecks?.training" type="info" :closable="false"
            :title="'尚未取得真实业务完成证据：'+(checkpoint(selectedCourse.id)?.details||selectedCourse.checkpoint)" />
          <ElButton v-if="trainingChecks?.training || trainingError" :loading="trainingLoading"
            @click="refreshTraining">重新核验课程完成状态</ElButton>
          <div class="guide-course-actions">
            <ElButton :disabled="courseStep===0" @click="courseStep--;saveReading(false)">上一步</ElButton>
            <ElTag v-if="currentCourseRead" type="success">已阅读</ElTag>
            <ElButton v-else type="primary" @click="nextReading">
              {{courseStep+1===selectedCourse.instructions.length?"标记已阅读":"下一步"}}
            </ElButton>
          </div>
        </template>
      </ElTabPane>
    </ElTabs>
  </ElDrawer>
  <ElTour v-model="tourOpen" v-model:current="tourStep" :mask="true"
    :z-index="tourZIndex" :content-style="tourCardStyle" :show-arrow="false"
    :scroll-into-view-options="{ block: 'center', inline: 'nearest', behavior: 'instant' }"
    :target-area-clickable="false" :close-on-press-escape="true"
    @close="closeTour">
    <ElTourStep v-for="step in tourSteps" :key="step.id"
      :target="()=>selectedAction ? resolveGuideActionTarget(selectedAction.id) : resolveGuideTarget(step.target)"
      :title="step.title"
      :description="step.description" />
  </ElTour>
</template>
<style scoped>
.guide-feedback { margin-bottom: 12px }
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
