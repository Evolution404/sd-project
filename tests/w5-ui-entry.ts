import {createApp,h} from 'vue';
import PlanSettlementWorkspace from '../web/src/components/PlanSettlementWorkspace.vue';
import '../web/src/style.css';
const planId=new URLSearchParams(location.search).get('plan')||'';
createApp({render:()=>h(PlanSettlementWorkspace,{executionId:planId,canSettle:true})})
 .mount('#w5-fixture');
