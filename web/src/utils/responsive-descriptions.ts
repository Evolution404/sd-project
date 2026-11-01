import {onMounted,onBeforeUnmount,ref} from 'vue';

/** Columns based on available application viewport; no fixed-width cards at 760px. */
export function descriptionColumnCount(width:number,desktop=3):number{
 return width<=900?1:width<=1350?Math.min(desktop,2):desktop;
}
export function useResponsiveDescriptions(desktop=3){
 const columns=ref(desktop);
 const update=()=>{columns.value=descriptionColumnCount(window.innerWidth,desktop)};
 onMounted(()=>{update();window.addEventListener('resize',update,{passive:true})});
 onBeforeUnmount(()=>window.removeEventListener('resize',update));
 return columns;
}
