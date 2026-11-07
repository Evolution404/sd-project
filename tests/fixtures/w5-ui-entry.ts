import {createApp,h} from 'vue';
import PlanSettlementWorkspace from '../../web/src/modules/plans/PlanSettlementWorkspace.vue';
import '../../web/src/style.css';
import '../../web/src/styles/element-plus';
import '../../web/src/styles/dictionary.css';
const planId=new URLSearchParams(location.search).get('plan')||'';
createApp({render:()=>h(PlanSettlementWorkspace,{executionId:planId,canSettle:true})})
 .mount('#w5-fixture');
