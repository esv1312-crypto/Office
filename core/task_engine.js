const TASK_STATUS=Object.freeze({CREATED:'CREATED',READY:'READY',ASSIGNED:'ASSIGNED',IN_PROGRESS:'IN_PROGRESS',WAITING:'WAITING',IMPLEMENTED:'IMPLEMENTED',VERIFYING:'VERIFYING',COMPLETED:'COMPLETED',FAIL:'FAIL',FIXING:'FIXING',RETEST:'RETEST'});
const ALLOWED_TRANSITIONS=Object.freeze({
 CREATED:['READY','WAITING'],READY:['ASSIGNED','WAITING'],ASSIGNED:['IN_PROGRESS','WAITING'],
 IN_PROGRESS:['IMPLEMENTED','WAITING','FAIL'],WAITING:['READY','ASSIGNED'],IMPLEMENTED:['VERIFYING'],
 VERIFYING:['COMPLETED','FAIL'],FAIL:['FIXING'],FIXING:['RETEST','FAIL','READY'],RETEST:['VERIFYING','FAIL'],COMPLETED:[]
});
function createTask(input={}){if(!input.objective) throw new Error('Task objective is required'); const now=new Date().toISOString(); return {id:input.id||'task-'+Date.now(),project:input.project||null,requiredSkills:input.requiredSkills||[],dependencies:input.dependencies||[],objective:input.objective,status:TASK_STATUS.CREATED,result:null,verification:null,history:[{status:TASK_STATUS.CREATED,at:now}]};}
function canTransition(current,next){return (ALLOWED_TRANSITIONS[current]||[]).includes(next);}
function transitionTask(task,next,meta={}){if(!canTransition(task.status,next)) throw new Error(`Invalid task transition: ${task.status} -> ${next}`); task.status=next; task.history.push({status:next,at:new Date().toISOString(),...meta}); return task;}
function dependenciesReady(task,tasks){return (task.dependencies||[]).every(id=>tasks[id]?.status===TASK_STATUS.COMPLETED);}
function markReadyIfPossible(task,tasks){if(![TASK_STATUS.CREATED,TASK_STATUS.WAITING].includes(task.status)||!dependenciesReady(task,tasks)) return false; transitionTask(task,TASK_STATUS.READY,{reason:'DEPENDENCIES_READY'}); return true;}
module.exports={TASK_STATUS,ALLOWED_TRANSITIONS,createTask,canTransition,transitionTask,dependenciesReady,markReadyIfPossible};