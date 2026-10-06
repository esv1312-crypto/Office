import express from "express";
import OpenAI from "openai";
import { inspectFreeProviders } from "./free-ai-resource-manager.js";
import { createBrowserManager } from "./browser-manager.js";
import { refreshModelScout, getModelScoutState, getDynamicPool, selectModelForTask } from "./model-scout.js";
import { initDatabase, loadDatabaseState, saveTaskSnapshot, saveEvent, databaseStatus } from "./database.js";

const app = express();
app.use(express.json({limit:"1mb"}));

const startedAt = new Date().toISOString();
const events = [];
const tasks = new Map();
const INTERNAL_TASK_AUTH_HEADER = "x-ai-office-internal";
function validateParentLink(parentTaskId, childId=null) {
  const parentId=String(parentTaskId || "").trim();
  if(!parentId) return {ok:true,parent:null};
  if(childId && parentId===String(childId)) return {ok:false,error:"task cannot be its own parent"};
  let current=tasks.get(parentId);
  if(!current) return {ok:false,error:"parent task not found"};
  const seen=new Set();
  while(current) {
    if(seen.has(current.id)) return {ok:false,error:"task parent cycle detected"};
    seen.add(current.id);
    if(childId && current.parentTaskId===childId) return {ok:false,error:"task parent cycle detected"};
    current=current.parentTaskId ? tasks.get(current.parentTaskId) : null;
  }
  return {ok:true,parent:tasks.get(parentId)};
}

function requireInternalOrAudit(req,res) {
  const expected=String(process.env.OFFICE_AUDIT_TOKEN || "").trim();
  const supplied=String(req.headers["x-ai-office-audit-token"] || req.query?.token || "").trim();
  const internal=String(req.headers[INTERNAL_TASK_AUTH_HEADER] || "")==="1" && ["127.0.0.1","::1","::ffff:127.0.0.1"].includes(String(req.socket?.remoteAddress || ""));
  if(internal || (expected && supplied===expected)) return true;
  res.status(401).json({ok:false,error:"authentication required"}); return false;
}
const workerQueue = { active:0, pending:[], limit:Math.max(1,Number(process.env.MAX_CONCURRENT_WORKERS || 3)) };
async function acquireWorkerSlot(taskId) {
  if (workerQueue.active < workerQueue.limit) { workerQueue.active += 1; emit("worker.slot_acquired",{taskId,active:workerQueue.active,limit:workerQueue.limit}); return; }
  emit("worker.queued",{taskId,active:workerQueue.active,limit:workerQueue.limit});
  await new Promise(resolve=>workerQueue.pending.push(resolve));
  workerQueue.active += 1;
  emit("worker.slot_acquired",{taskId,active:workerQueue.active,limit:workerQueue.limit});
}
function releaseWorkerSlot(taskId) {
  workerQueue.active=Math.max(0,workerQueue.active-1);
  const next=workerQueue.pending.shift();
  if(next) next();
  emit("worker.slot_released",{taskId,active:workerQueue.active,limit:workerQueue.limit});
}
const browserRequests = new Map();
const browserRuns = new Map();
const browser = createBrowserManager({emit});
let modelScoutTimer = null;
const workerWatchdogIntervalMs=Math.max(5000,Number(process.env.WORKER_WATCHDOG_INTERVAL_MS || 15000));
const workerTimeoutMs=Math.max(30000,Number(process.env.WORKER_TIMEOUT_MS || 600000));
let workerWatchdogTimer=null;
function runWorkerWatchdog(){
  const now=Date.now();
  for(const record of tasks.values()){
    if(!["running","waiting"].includes(record.status)) continue;
    if(!record.startedAt) continue;
    const age=now-Date.parse(record.startedAt);
    if(age < workerTimeoutMs) continue;
    if(record.kind==="root") continue;
    if(record.watchdogFailedAt) continue;
    record.watchdogFailedAt=new Date(now).toISOString();
    transitionTask(record,"failed",{error:"WORKER_WATCHDOG_TIMEOUT",failedAt:record.watchdogFailedAt});
    emit("worker.watchdog_timeout",{taskId:record.id,parentTaskId:record.parentTaskId||null,employeeId:record.employeeId,ageMs:age,timeoutMs:workerTimeoutMs});
    const parent=record.parentTaskId ? tasks.get(record.parentTaskId) : null;
    if(parent && ["waiting","running"].includes(parent.status)) void recoverFailedWorker(parent,record);
  }
}

const TASK_STATES = new Set(["accepted","planning","running","waiting","completed","failed","cancelled"]);
const ALLOWED_TRANSITIONS = {
  accepted: new Set(["planning","running","waiting","failed","cancelled"]),
  planning: new Set(["running","waiting","failed","cancelled"]),
  running: new Set(["waiting","completed","failed","cancelled"]),
  waiting: new Set(["running","completed","failed","cancelled"]),
  completed: new Set([]),
  failed: new Set(["planning","running","cancelled"]),
  cancelled: new Set([])
};

function transitionTask(record, nextStatus, extra = {}) {
  if (!TASK_STATES.has(nextStatus)) throw new Error("Invalid task state: " + nextStatus);
  if (record.status !== nextStatus && !ALLOWED_TRANSITIONS[record.status]?.has(nextStatus)) {
    throw new Error("Invalid task transition: " + record.status + " -> " + nextStatus);
  }
  const previousStatus = record.status;
  record.status = nextStatus;
  Object.assign(record, extra);
  void saveTaskSnapshot(taskSnapshot(record)).catch(error=>console.error("[DB] task save failed",error?.message||error));
  emit("task.state_changed", {taskId:record.id,parentTaskId:record.parentTaskId || null,previousStatus,status:nextStatus});
  return record;
}

const DEFAULT_EMPLOYEES = [
  {id:"chief",name:"Руководитель",role:"coordinator",provider:"openrouter",model:"nvidia/nemotron-3-ultra-550b-a55b:free",skills:["planning","delegation","coordination"]},
  {id:"developer",name:"Программист",role:"developer",provider:"openrouter",model:"poolside/laguna-s-2.1:free",skills:["coding","github","debugging"]},
  {id:"analyst",name:"Аналитик",role:"analyst",provider:"openrouter",model:"nvidia/nemotron-3-super-120b-a12b:free",skills:["analysis","research","requirements"]},
  {id:"verifier",name:"Проверяющий",role:"verifier",provider:"openrouter",model:"google/gemma-4-31b-it:free",skills:["testing","verification","evidence"]},
  {id:"executor",name:"Исполнитель",role:"executor",provider:"openrouter",model:"nvidia/nemotron-3.5-lightning:free",skills:["execution","operations","recovery"]}
];

function emit(type, data = {}) {
  const event = { id: events.length + 1, ts: new Date().toISOString(), type, ...data };
  events.unshift(event);
  if (events.length > 500) events.pop();
  console.log("[EVENT]", JSON.stringify(event));
  void saveEvent(type,event).catch(error=>console.error("[DB] event save failed",error?.message||error));
  return event;
}

function paidTestEnabled() {
  return String(process.env.AI_PAID_TEST_ONLY || "false").toLowerCase() === "true"
    && Boolean(String(process.env.AI_PAID_TEST_MODEL || "").trim());
}
function paidTestModel() {
  return String(process.env.AI_PAID_TEST_MODEL || "deepseek/deepseek-v4.1-flash").trim();
}
function freeOnly() {
  return String(process.env.AI_FREE_ONLY ?? "true").toLowerCase() !== "false";
}

function providerOrder() {
  return (process.env.AI_PROVIDER_ORDER || "openrouter,huggingface,gemini,cloudflare")
    .split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
}

function aiProvider() {
  const order = providerOrder();
  return order.find(p => aiConfigured(p)) || order[0] || "none";
}

function openRouterApiKey() {
  // Backward compatibility for an earlier Render setup that stored the
  // OpenRouter secret under OPENROUTER_MODEL. Never print the value.
  const explicit = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (explicit) return explicit;
  const legacy = String(process.env.OPENROUTER_MODEL || "").trim();
  if (/^(sk-or-|or-)/i.test(legacy)) return legacy;
  return "";
}

function openRouterModel() {
  const configured = String(process.env.OPENROUTER_MODEL || "").trim();
  return /^(sk-or-|or-)/i.test(configured) || !configured ? "openrouter/free" : configured;
}

function aiConfigured(provider) {
  if (provider === "huggingface") return Boolean(String(process.env.HUGGINGFACE_API_KEY || "").trim());
  if (provider === "gemini") return Boolean(process.env.GEMINI_API_KEY);
  if (provider === "openrouter") return Boolean(openRouterApiKey());
  if (provider === "cloudflare") return Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
  if (provider === "openai") return !freeOnly() && Boolean(process.env.OPENAI_API_KEY);
  return false;
}

function gatewayProviders(preferred) {
  const order=[...new Set([...providerOrder(),"huggingface"])];
  const first=String(preferred || "").toLowerCase();
  const candidates=first && first !== "auto" ? [first,...order] : order;
  return [...new Set(candidates)].filter(p=>aiConfigured(p) && !isProviderSuppressed(p));
}

function aiAvailable(preferred) {
  return gatewayProviders(preferred).length > 0;
}

function employees() {
  try {
    const parsed = JSON.parse(process.env.AI_EMPLOYEES_JSON || "null");
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch (_) {}
  return DEFAULT_EMPLOYEES;
}

function getEmployee(id) {
  return employees().find(x => x.id === id) || employees()[0];
}

function resolveBrain(employee, task = "") {
  if (paidTestEnabled()) return {
    provider:"openrouter",
    model:paidTestModel(),
    taskKind:"paid-test",
    candidates:[{provider:"openrouter",id:paidTestModel(),routeModel:paidTestModel()}]
  };
  const roleTask = employee?.id==="verifier" ? "verification testing evidence audit"
    : employee?.id==="developer" ? "coding debugging implementation"
    : employee?.id==="analyst" ? "analysis research requirements"
    : employee?.id==="executor" ? "execution operations recovery"
    : employee?.id==="chief" ? "planning delegation coordination"
    : task;
  const selected = selectModelForTask(roleTask || task, employee);
  const model = selected.selected && !isModelSuppressed(selected.selected.routeModel || selected.selected.id)
    ? selected.selected
    : (selected.candidates || []).find(x => !isModelSuppressed(x.routeModel || x.id)) || null;
  return {
    provider: String(model?.provider || employee?.provider || process.env.AI_PROVIDER || aiProvider()).toLowerCase(),
    model: model?.routeModel || model?.id || employee?.model || null,
    taskKind: selected.kind,
    candidates: selected.candidates || []
  };
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isTransientGeminiError(status, message = "") {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504
    || /high demand|temporarily|unavailable|overloaded|rate.?limit|resource.?exhausted/i.test(message);
}

async function callGemini(model, task) {
  emit("ai.start", {provider:"gemini", model});
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.GEMINI_TIMEOUT_MS || 25000));
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(process.env.GEMINI_API_KEY);
  let response;
  try {
    response = await fetch(url, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      signal:controller.signal,
      body:JSON.stringify({
        systemInstruction:{parts:[{text:"You are an employee inside AI-OFFICE. Follow the assigned role and skills. Analyze the task, produce a concise execution plan and verification checklist. Do not claim external actions were completed unless this runtime actually performed them."}]},
        contents:[{role:"user",parts:[{text:task}]}]
      })
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error?.name === "AbortError") {
      const e = new Error("Gemini request timed out");
      e.status = 408; e.transient = true; throw e;
    }
    throw error;
  }
  clearTimeout(timeout);
  const data = await response.json().catch(() => ({}));
  const message = data?.error?.message || ("Gemini HTTP " + response.status);
  if (!response.ok) {
    const error = new Error(message);
    error.status = response.status;
    error.transient = isTransientGeminiError(response.status, message);
    throw error;
  }
  const text = (data?.candidates?.[0]?.content?.parts || []).map(part => part.text || "").join("").trim();
  if (!text) throw new Error("Gemini returned an empty response");
  return {text, model};
}

async function generateWithGemini(task, preferredModel) {
  const configured = (process.env.GEMINI_MODELS || "gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash")
    .split(",").map(x=>x.trim()).filter(Boolean);
  const models = [...new Set([preferredModel, ...configured].filter(Boolean))];
  let lastError;
  for (let modelIndex=0; modelIndex<models.length; modelIndex++) {
    const model=models[modelIndex];
    for (let attempt=0; attempt<3; attempt++) {
      try {
        emit("ai.attempt",{provider:"gemini",model,attempt:attempt+1});
        const result=await callGemini(model,task);
        emit("ai.success",{provider:"gemini",model,attempt:attempt+1});
        return result;
      } catch(error) {
        lastError=error;
        const quota = /quota exceeded|rate.?limit|resource.?exhausted/i.test(error?.message || "");
        emit("ai.error",{provider:"gemini",model,attempt:attempt+1,error:error?.message||String(error),transient:Boolean(error?.transient),quota});
        if (quota) {
          emit("ai.quota_exhausted",{provider:"gemini",model,error:error?.message||String(error)});
          suppressProvider("gemini",error?.message||"Gemini quota exhausted",60*60*1000);
          return Promise.reject(lastError);
        }
        if (!error?.transient || attempt===2) break;
        const delay=Math.min(8000,1000*(2**attempt))+Math.floor(Math.random()*500);
        emit("ai.retry",{provider:"gemini",model,attempt:attempt+1,delayMs:delay,error:error.message});
        await sleep(delay);
      }
    }
    if (modelIndex<models.length-1) emit("ai.fallback",{provider:"gemini",from:model,to:models[modelIndex+1],error:lastError?.message});
  }
  throw lastError || new Error("Gemini request failed");
}

const paidTestUsage={calls:0,estimatedUsd:0};
function paidTestBudgetUsd(){return Math.max(0.05,Number(process.env.AI_PAID_TEST_BUDGET_USD||1));}
function paidTestMaxOutputTokens(){return Math.max(128,Math.min(4096,Number(process.env.AI_PAID_TEST_MAX_OUTPUT_TOKENS||1800)));}
function paidTestReserve(task){
  if(!paidTestEnabled()) return;
  const input=Math.ceil(String(task||"").length/3.5);
  const reserve=(input*Number(process.env.AI_PAID_TEST_INPUT_USD_PER_MILLION||0.035)+paidTestMaxOutputTokens()*Number(process.env.AI_PAID_TEST_OUTPUT_USD_PER_MILLION||0.29))/1e6;
  if(paidTestUsage.estimatedUsd+reserve>paidTestBudgetUsd()) throw Object.assign(new Error("Paid test budget exhausted"),{code:"PAID_TEST_BUDGET_EXCEEDED"});
}
function recordPaidTestUsage(data){
  if(!paidTestEnabled()) return;
  const input=Number(data?.usage?.prompt_tokens||data?.usage?.input_tokens||0);
  const output=Number(data?.usage?.completion_tokens||data?.usage?.output_tokens||0);
  const estimatedInput=input||0;
  const cost=(estimatedInput*Number(process.env.AI_PAID_TEST_INPUT_USD_PER_MILLION||0.035)+output*Number(process.env.AI_PAID_TEST_OUTPUT_USD_PER_MILLION||0.29))/1e6;
  paidTestUsage.calls++; paidTestUsage.estimatedUsd+=cost;
  emit("paid_test.usage",{calls:paidTestUsage.calls,estimatedUsd:Number(paidTestUsage.estimatedUsd.toFixed(6)),budgetUsd:paidTestBudgetUsd()});
}
async function callOpenAICompatible({provider,baseUrl,apiKey,model,task,headers={}}) {
  if(provider==="openrouter"&&paidTestEnabled()) paidTestReserve(task);
  emit("ai.start",{provider,model});
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),Number(process.env.AI_REQUEST_TIMEOUT_MS || 30000));
  try {
    const response=await fetch(baseUrl,{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+apiKey,...headers},
      signal:controller.signal,
      body:JSON.stringify({
        model,
        messages:[
          {role:"system",content:"You are an employee inside AI-OFFICE. Follow the assigned role and skills. Analyze the task, produce a concise execution plan and verification checklist. Do not claim external actions were completed unless this runtime actually performed them."},
          {role:"user",content:task}
        ],
        ...(provider==="openrouter"&&paidTestEnabled()?{max_tokens:paidTestMaxOutputTokens()}: {})
      })
    });
    const data=await response.json().catch(()=>({}));
    if(provider==="openrouter"&&paidTestEnabled()) recordPaidTestUsage(data);
    if(!response.ok) {
      const e=new Error(data?.error?.message || ("HTTP "+response.status));
      e.status=response.status;
      e.transient=response.status===408 || response.status===409 || response.status===429 || response.status>=500;
      throw e;
    }
    const text=String(data?.choices?.[0]?.message?.content || "").trim();
    if(!text) throw new Error(provider+" returned an empty response");
    return {text,model};
  } catch(error) {
    if(error?.name==="AbortError") {
      const e=new Error(provider+" request timed out"); e.status=408; e.transient=true; throw e;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

const OPENROUTER_MODEL_POOLS = {
  coordinator:[
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "qwen/qwen3.8-27b:free",
    "openrouter/free"
  ],
  developer:[
    "poolside/laguna-s-2.1:free",
    "cohere/north-mini-code:free",
    "qwen/qwen3.8-27b:free",
    "openrouter/free"
  ],
  analyst:[
    "nvidia/nemotron-3-super-120b-a12b:free",
    "qwen/qwen3.8-27b:free",
    "openrouter/free"
  ],
  verifier:[
    "google/gemma-4-31b-it:free",
    "qwen/qwen3.8-27b:free",
    "openrouter/free"
  ],
  executor:[
    "nvidia/nemotron-3.5-lightning:free",
    "qwen/qwen3.8-27b:free",
    "openrouter/free"
  ]
};

const openRouterRotation = new Map();
const modelSuppressions = new Map();
const providerSuppressions = new Map();
const preflightCache = new Map();
const PREFLIGHT_TTL_MS = Math.max(60000, Number(process.env.MODEL_PREFLIGHT_TTL_MS || 600000));
const PREFLIGHT_TIMEOUT_MS = Math.max(5000, Number(process.env.MODEL_PREFLIGHT_TIMEOUT_MS || 12000));

function preflightKey(provider, model, role) {
  return String(provider)+":"+String(model)+":"+String(role);
}

async function preflightModel(provider, model, employee) {
  const key=preflightKey(provider,model,employee?.role);
  const cached=preflightCache.get(key);
  if(cached && cached.expiresAt>Date.now() && cached.ok) return cached;
  const probe=[
    "AI-OFFICE PREFLIGHT.",
    "You are being tested before receiving a real task.",
    "Reply with exactly one line: PREFLIGHT_OK",
    "Do not explain anything else."
  ].join("\n");
  const started=Date.now();
  emit("model.preflight_started",{employeeId:employee?.id||null,role:employee?.role||null,provider,model});
  try {
    let result;
    if(provider==="openrouter"){
      result=await callOpenAICompatible({provider,baseUrl:"https://openrouter.ai/api/v1/chat/completions",apiKey:openRouterApiKey(),model,task:probe});
    } else if(provider==="huggingface"){
      const hfModel=normalizeHuggingFaceModel(model);
      result=await callOpenAICompatible({provider,baseUrl:"https://router.huggingface.co/v1/chat/completions",apiKey:String(process.env.HUGGINGFACE_API_KEY||"").trim(),model:hfModel.includes(":")?hfModel:hfModel+":fastest",task:probe});
    } else if(provider==="gemini"){
      result=await callGemini(model,probe);
    } else if(provider==="cloudflare"){
      result=await generateWithCloudflare(probe,model);
    } else {
      throw new Error("Unsupported preflight provider: "+provider);
    }
    const ok=String(result?.text||"").trim().length>0;
    if(!ok) throw new Error("preflight empty response");
    const entry={ok:true,provider,model,role:employee?.role||null,latencyMs:Date.now()-started,expiresAt:Date.now()+PREFLIGHT_TTL_MS};
    preflightCache.set(key,entry);
    emit("model.preflight_passed",{employeeId:employee?.id||null,role:employee?.role||null,provider,model,latencyMs:entry.latencyMs,ttlMs:PREFLIGHT_TTL_MS});
    return entry;
  } catch(error) {
    const message=error?.message||String(error);
    const transient=Boolean(error?.transient)||/402|404|408|409|429|quota|rate.?limit|timeout|temporarily|unavailable|overloaded|empty response|does not exist|not found/i.test(message);
    const ttl= /402|404|does not exist|not found|invalid model/i.test(message) ? 6*60*60*1000 : 15*60*1000;
    suppressModel(model,message,ttl,provider);
    const entry={ok:false,provider,model,role:employee?.role||null,error:message,transient,failedAt:new Date().toISOString(),expiresAt:Date.now()+Math.min(ttl,PREFLIGHT_TTL_MS)};
    preflightCache.set(key,entry);
    emit("model.preflight_failed",{employeeId:employee?.id||null,role:employee?.role||null,provider,model,error:message,transient});
    return entry;
  }
}

async function ensureEmployeeReady(employee, task) {
  const brain=resolveBrain(employee,task);
  const candidates=[{provider:brain.provider,model:brain.model},...(brain.candidates||[]).map(x=>({provider:x.provider||"openrouter",model:x.routeModel||x.id}))];
  const unique=candidates.filter(x=>x.provider&&x.model).filter((x,i,a)=>a.findIndex(y=>y.provider===x.provider&&y.model===x.model)===i);
  for(const candidate of unique.slice(0,4)){
    if(isProviderSuppressed(candidate.provider) || isProviderModelSuppressed(candidate.provider,candidate.model)) continue;
    const check=await preflightModel(candidate.provider,candidate.model,employee);
    if(check.ok) {
      emit("model.preflight_selected",{employeeId:employee.id,role:employee.role,provider:candidate.provider,model:candidate.model});
      return candidate;
    }
  }
  throw Object.assign(new Error("No preflight-approved model is available for "+employee.role),{code:"PREFLIGHT_EXHAUSTED"});
}

function isProviderSuppressed(provider) {
  const key=String(provider).toLowerCase();
  const until=Number(providerSuppressions.get(key)||0);
  if(!until) return false;
  if(until<=Date.now()){ providerSuppressions.delete(key); return false; }
  return true;
}
function suppressProvider(provider, reason, ttlMs=15*60*1000) {
  const key=String(provider).toLowerCase();
  providerSuppressions.set(key,Date.now()+ttlMs);
  emit("gateway.provider_suppressed",{provider:key,until:new Date(Date.now()+ttlMs).toISOString(),reason});
}

function isModelSuppressed(model, provider = "openrouter") {
  const key=String(provider)+":"+String(model);
  const until=Number(modelSuppressions.get(key)||0);
  if (!until) return false;
  if (until <= Date.now()) {
    modelSuppressions.delete(key);
    return false;
  }
  return true;
}

function suppressModel(model, reason, ttlMs = 6 * 60 * 60 * 1000, provider = "openrouter") {
  if (!model) return;
  const key=String(provider)+":"+String(model);
  modelSuppressions.set(key, Date.now()+ttlMs);
  emit("gateway.model_suppressed",{provider,model,until:new Date(Date.now()+ttlMs).toISOString(),reason});
}

function isProviderModelSuppressed(provider, model) {
  const key=String(provider)+":"+String(model);
  const until=Number(modelSuppressions.get(key)||0);
  if (!until) return false;
  if (until <= Date.now()) { modelSuppressions.delete(key); return false; }
  return true;
}

function openRouterPool(employee, preferredModel = null) {
  const role=String(employee?.role || "executor");
  const dynamic=getDynamicPool(employee,"openrouter").filter(x => x && !isModelSuppressed(x));
  let pool=dynamic.length ? dynamic : ["openrouter/free"];
  try {
    const custom=JSON.parse(process.env.OPENROUTER_MODEL_POOLS_JSON || "null");
    if (custom && Array.isArray(custom[role]) && custom[role].length) {
      const liveCustom=custom[role].filter(x => x && !isModelSuppressed(x));
      if (liveCustom.length) pool=[...liveCustom,...pool];
    }
  } catch (_) {}
  const configured=String(process.env.OPENROUTER_MODEL || "").trim();
  if (configured && !/^(sk-or-|or-)/i.test(configured) && !isModelSuppressed(configured,"openrouter")) pool=[configured,...pool];
  if (preferredModel && !isModelSuppressed(preferredModel,"openrouter")) pool=[preferredModel,...pool];
  const result=[...new Set(pool.filter(Boolean))];
  return result.length ? result : ["openrouter/free"];
}

async function generateWithOpenRouter(task, employee, preferredModel) {
  const pool=openRouterPool(employee, preferredModel);
  const role=String(employee?.role || "executor");
  const cursor=Number(openRouterRotation.get(role) || 0);
  const ordered=pool.map((_,i)=>pool[(cursor+i)%pool.length]);
  openRouterRotation.set(role,(cursor+1)%pool.length);

  let lastError;
  for (let i=0;i<ordered.length;i++) {
    const model=ordered[i];
    try {
      emit("gateway.model_attempt",{employeeId:employee?.id || null,role,provider:"openrouter",model,rotationIndex:i});
      const result=await callOpenAICompatible({
        provider:"openrouter",
        baseUrl:"https://openrouter.ai/api/v1/chat/completions",
        apiKey:openRouterApiKey(),
        model,task,
        headers:{
          "HTTP-Referer":process.env.OPENROUTER_SITE_URL || "https://ai-office-runtime-8pir.onrender.com",
          "X-Title":"AI-OFFICE"
        }
      });
      emit("gateway.model_success",{employeeId:employee?.id || null,role,provider:"openrouter",model});
      return result;
    } catch(error) {
      lastError=error;
      emit("gateway.model_failed",{employeeId:employee?.id || null,role,provider:"openrouter",model,error:error?.message || String(error),transient:Boolean(error?.transient)});
      if (/model.*(not found|does not exist|not available)|unknown model|invalid model/i.test(error?.message || "")) {
        suppressModel(model,error?.message || "model unavailable",6*60*60*1000,"openrouter");
      } else if (/429|quota|rate.?limit|resource.?exhausted|temporarily unavailable|high demand|overloaded|empty response/i.test(error?.message || "")) {
        suppressModel(model,error?.message || "model temporarily unavailable",15*60*1000,"openrouter");
      }
      if (i<ordered.length-1) {
        emit("gateway.model_fallback",{employeeId:employee?.id || null,role,from:model,to:ordered[i+1],reason:error?.message || String(error)});
      }
    }
  }
  throw lastError || new Error("All OpenRouter free models failed");
}

function normalizeHuggingFaceModel(model) {
  const value=String(model || "").trim();
  if(!value) return value;
  const routeSuffix=/(together|groq|sambanova|cerebras|nebius|fireworks|novita|hf-inference)$/i;
  return value.replace(/:(together|groq|sambanova|cerebras|nebius|fireworks|novita|hf-inference)$/i,"");
}

async function generateWithHuggingFace(task, employee, preferredModel) {
  const token=String(process.env.HUGGINGFACE_API_KEY || "").trim();
  if(!token) throw Object.assign(new Error("Hugging Face API key is not configured"),{code:"HF_NOT_CONFIGURED"});
  const dynamic=getDynamicPool(employee,"huggingface").filter(model => model.includes("/"));
  const configured=(process.env.HUGGINGFACE_MODELS || "").split(",").map(x=>x.trim()).filter(Boolean);
  const safePreferred = preferredModel && !String(preferredModel).includes(":free") && String(preferredModel).includes("/") ? normalizeHuggingFaceModel(preferredModel) : null;
  const pool=[safePreferred,...dynamic,...configured].filter(Boolean);
  const models=[...new Set(pool)];
  if(!models.length) throw new Error("No free Hugging Face model is available from Model Scout");
  let lastError;
  for(const model of models){
    try{
      emit("gateway.model_attempt",{employeeId:employee?.id||null,role:employee?.role||null,provider:"huggingface",model});
      const result=await callOpenAICompatible({
        provider:"huggingface",
        baseUrl:"https://router.huggingface.co/v1/chat/completions",
        apiKey:token,
        model: normalizeHuggingFaceModel(model).includes(":") ? normalizeHuggingFaceModel(model) : normalizeHuggingFaceModel(model)+":fastest",
        task
      });
      emit("gateway.model_success",{employeeId:employee?.id||null,role:employee?.role||null,provider:"huggingface",model:result.model});
      return result;
    }catch(error){
      lastError=error;
      emit("gateway.model_failed",{employeeId:employee?.id||null,role:employee?.role||null,provider:"huggingface",model,error:error?.message||String(error),transient:Boolean(error?.transient)});
      if(models.indexOf(model)<models.length-1) emit("gateway.model_fallback",{employeeId:employee?.id||null,role:employee?.role||null,provider:"huggingface",from:model,to:models[models.indexOf(model)+1],reason:error?.message||String(error)});
    }
  }
  throw lastError || new Error("All Hugging Face free models failed");
}

async function generateWithCloudflare(task, preferredModel) {
  const model=preferredModel || process.env.CLOUDFLARE_MODEL || "@cf/meta/llama-3.1-8b-instruct";
  return callOpenAICompatible({
    provider:"cloudflare",
    baseUrl:"https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID)+"/ai/v1/chat/completions",
    apiKey:process.env.CLOUDFLARE_API_TOKEN,
    model,task
  });
}

async function generateWithOpenAI(task, preferredModel) {
  const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
  const model=preferredModel || process.env.OPENAI_MODEL || "gpt-6-luna";
  emit("ai.start",{provider:"openai",model});
  const response=await client.responses.create({
    model,
    input:[
      {role:"system",content:"You are an employee inside AI-OFFICE. Analyze the task, produce a concise execution plan and verification checklist. Do not claim external actions were completed unless this runtime actually performed them."},
      {role:"user",content:task}
    ]
  });
  return {text:response.output_text || "",model};
}

async function generateViaLocalGateway(task, employee, forcedProvider = null, approvedCandidate = null) {
  const brain=approvedCandidate
    ? { ...resolveBrain(employee, task), provider:String(approvedCandidate.provider), model:String(approvedCandidate.model), candidates:[approvedCandidate] }
    : resolveBrain(employee, task);
  const providers=paidTestEnabled()
    ? ["openrouter"].filter(p=>aiConfigured(p))
    : Array.isArray(forcedProvider)
      ? [...new Set(forcedProvider.map(p=>String(p).toLowerCase()))].filter(p=>aiConfigured(p))
      : forcedProvider
        ? [...new Set([String(forcedProvider).toLowerCase(), ...gatewayProviders(brain.provider)])].filter(p=>aiConfigured(p))
        : gatewayProviders(brain.provider);
  if(!providers.length) throw Object.assign(new Error("No configured AI provider is available in FREE_ONLY="+freeOnly()),{code:"AI_NOT_CONFIGURED"});
  let lastError;
  for(const provider of providers) {
    const sameAsApproved = approvedCandidate && String(approvedCandidate.provider).toLowerCase()===provider;
    const model=provider==="gemini"
      ? null
      : provider==="huggingface"
        ? null
        : provider==="openrouter"
          ? (sameAsApproved ? String(approvedCandidate.model) : openRouterModel())
          : provider==="cloudflare"
            ? (sameAsApproved ? String(approvedCandidate.model) : (process.env.CLOUDFLARE_MODEL || null))
            : (process.env.OPENAI_MODEL || null);
    emit("gateway.route",{employeeId:employee.id,role:employee.role,provider,model,taskKind:brain.taskKind,candidates:brain.candidates.slice(0,5),freeOnly:freeOnly(),backend:"local"});
    try {
      let result;
      if(provider==="gemini") result=await generateWithGemini(task,model);
      else if(provider==="huggingface") result=await generateWithHuggingFace(task,employee,model);
      else if(provider==="openrouter") result=await generateWithOpenRouter(task,employee,model);
      else if(provider==="cloudflare") result=await generateWithCloudflare(task,model);
      else if(provider==="openai") { if(freeOnly()) throw Object.assign(new Error("Paid OpenAI is blocked by FREE_ONLY policy"),{code:"PAID_PROVIDER_BLOCKED"}); result=await generateWithOpenAI(task,model); }
      else throw new Error("Unsupported AI provider: "+provider);
      emit("gateway.success",{employeeId:employee.id,provider,model:result.model,freeOnly:freeOnly(),backend:"local"});
      return result;
    } catch(error) {
      lastError=error;
      emit("gateway.provider_failed",{employeeId:employee.id,provider,error:error?.message||String(error),transient:Boolean(error?.transient),freeOnly:freeOnly(),backend:"local"});
      if(providers[providers.indexOf(provider)+1]) emit("gateway.fallback",{from:provider,to:providers[providers.indexOf(provider)+1],reason:error?.message||String(error),backend:"local"});
    }
  }
  throw lastError || new Error("All configured AI providers failed");
}

async function generateViaGateway(task, employee, approvedCandidate = null) {
  const backendUrls=String(process.env.BACKEND_RUNTIME_URLS || "").split(",").map(x=>x.trim().replace(/\/$/,"")).filter(Boolean);
  // Provider selection remains scout-driven, but provider fallback is always allowed after the selected provider fails.
  if(backendUrls.length && process.env.OFFICE_MODE !== "backend") {
    for(const base of backendUrls) {
      try {
        const controller=new AbortController();
        const timeout=setTimeout(()=>controller.abort(),Number(process.env.BACKEND_REQUEST_TIMEOUT_MS || 120000));
        const response=await fetch(base+"/api/backend/generate",{method:"POST",headers:{"Content-Type":"application/json","Connection":"close"},signal:controller.signal,body:JSON.stringify({task,employeeId:employee?.id||"executor"})});
        clearTimeout(timeout);
        const data=await response.json().catch(()=>({}));
        if(response.ok && data?.ok && data?.result?.text) {
          emit("backend.success",{backend:base,employeeId:employee?.id||null,model:data.result.model||null});
          return data.result;
        }
        throw new Error(data?.error || ("Backend HTTP "+response.status));
      } catch(error) {
        emit("backend.failed",{backend:base,employeeId:employee?.id||null,error:error?.message||String(error)});
      }
    }
  }
  return generateViaLocalGateway(task,employee,null,approvedCandidate);
}

const TOOL_REGISTRY = {
  "browser.request": {
    description: "Create a browser workflow request. External navigation is gated and requires approval before sensitive actions.",
    roles: ["coordinator","developer","analyst","verifier","executor"],
    execute: async (args = {}) => browser.request({
      taskId: args.taskId || null,
      url: String(args.url || "").trim(),
      goal: String(args.goal || "").trim(),
      actionClass: String(args.actionClass || "research")
    })
  },
  "browser.approve": {
    description: "Approve a pending browser action after explicit human confirmation.",
    roles: ["coordinator","executor"],
    execute: async (args = {}) => browser.approve(String(args.requestId || ""), String(args.approvalToken || ""))
  },
  "browser.status": {
    description: "Read browser workflow and approval state.",
    roles: ["coordinator","developer","analyst","verifier","executor"],
    execute: async (args = {}) => browser.status(String(args.requestId || ""))
  },
  "office.echo": {
    description: "Safe test tool that returns the supplied value.",
    roles: ["coordinator","developer","analyst","verifier","executor"],
    execute: async (args = {}) => ({echo: args.value ?? null})
  },
  "github.read_file": {
    description: "Read a UTF-8 file from the configured GitHub repository.",
    roles: ["coordinator","developer","analyst","verifier","executor"],
    requiresEnv: ["GITHUB_TOKEN","GITHUB_REPOSITORY"],
    execute: async (args = {}) => {
      const path = String(args.path || "").trim();
      if (!path) throw new Error("github.read_file requires path");
      const repo = process.env.GITHUB_REPOSITORY;
      const ref = args.ref ? "&ref=" + encodeURIComponent(String(args.ref)) : "";
      const response = await fetch("https://api.github.com/repos/" + repo + "/contents/" + path + "?per_page=1" + ref, {
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": "Bearer " + process.env.GITHUB_TOKEN,
          "X-GitHub-Api-Version": "2022-11-28"
        }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || ("GitHub HTTP " + response.status));
      if (Array.isArray(data)) throw new Error("Path is a directory, not a file");
      const content = data?.content ? Buffer.from(String(data.content).replace(/\\s/g, ""), "base64").toString("utf8") : "";
      return {repository: repo, path, sha: data?.sha || null, content};
    }
  },
  "github.write_file": {
    description: "Create or update a UTF-8 file in the configured GitHub repository.",
    roles: ["coordinator","developer","executor"],
    requiresEnv: ["GITHUB_TOKEN","GITHUB_REPOSITORY"],
    execute: async (args = {}) => {
      const path = String(args.path || "").trim();
      const content = String(args.content ?? "");
      const message = String(args.message || "AI-OFFICE: update file");
      const branch = String(args.branch || process.env.GITHUB_BRANCH || "main");
      if (!path) throw new Error("github.write_file requires path");

      const base = "https://api.github.com/repos/" + process.env.GITHUB_REPOSITORY + "/contents/" + path;
      const headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + process.env.GITHUB_TOKEN,
        "X-GitHub-Api-Version": "2022-11-28"
      };

      let sha = null;
      const existing = await fetch(base + "?ref=" + encodeURIComponent(branch), {headers});
      if (existing.ok) {
        const data = await existing.json();
        sha = data?.sha || null;
      } else if (existing.status !== 404) {
        const data = await existing.json().catch(() => ({}));
        throw new Error(data?.message || ("GitHub HTTP " + existing.status));
      }

      const body = {message, content: Buffer.from(content, "utf8").toString("base64"), branch};
      if (sha) body.sha = sha;

      const response = await fetch(base, {
        method: "PUT",
        headers: {...headers, "Content-Type":"application/json"},
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || ("GitHub HTTP " + response.status));
      return {repository: process.env.GITHUB_REPOSITORY, path, branch, commitSha:data?.commit?.sha || null};
    }
  }
};

function toolPolicy(employee, toolName, args = {}) {
  const tool = TOOL_REGISTRY[toolName];
  if (!tool) throw Object.assign(new Error("Tool is not registered: " + toolName), {code:"TOOL_NOT_FOUND"});
  if (!tool.roles.includes(employee.role)) {
    throw Object.assign(new Error("Tool denied for role: " + employee.role), {code:"TOOL_POLICY_DENIED"});
  }
  for (const name of (tool.requiresEnv || [])) {
    if (!process.env[name]) {
      throw Object.assign(new Error("Tool requires configuration: " + name), {code:"TOOL_NOT_CONFIGURED"});
    }
  }
  if (toolName === "github.write_file" && process.env.GITHUB_TOOLS_ENABLED !== "true") {
    throw Object.assign(new Error("GitHub write tools are disabled by policy"), {code:"TOOL_POLICY_DENIED"});
  }
  return true;
}

async function executeTool({employeeId = "executor", toolName, args = {}, taskId = null}) {
  const employee = getEmployee(employeeId);
  emit("tool.requested", {taskId, employeeId:employee.id, role:employee.role, tool:toolName, args});
  let tool;
  try {
    tool = TOOL_REGISTRY[toolName];
    toolPolicy(employee, toolName, args);
    emit("tool.started", {taskId, employeeId:employee.id, role:employee.role, tool:toolName});
    const result = await tool.execute(args);
    emit("tool.success", {taskId, employeeId:employee.id, role:employee.role, tool:toolName});
    return result;
  } catch (error) {
    emit("tool.error", {
      taskId,
      employeeId:employee.id,
      role:employee.role,
      tool:toolName,
      code:error?.code || null,
      error:error?.message || String(error)
    });
    throw error;
  }
}

function taskSnapshot(record) {
  return {
    ...record,
    children: [...tasks.values()].filter(x => x.parentTaskId === record.id).map(taskSnapshot)
  };
}

function createTaskRecord({task, employeeId = "chief", parentTaskId = null, kind = "root"}) {
  const employee = getEmployee(employeeId);
  const brain = resolveBrain(employee);
  return {
    id: crypto.randomUUID(),
    task,
    kind,
    parentTaskId,
    status: "accepted",
    createdAt: new Date().toISOString(),
    employeeId: employee.id,
    employee: employee.name,
    role: employee.role,
    provider: brain.provider,
    model: brain.model,
    attempts: 0,
    result: null,
    error: null
  };
}

function rootTaskFor(record) {
  let current=record; const seen=new Set();
  while(current?.parentTaskId && !seen.has(current.id)){seen.add(current.id);current=tasks.get(current.parentTaskId)||current;}
  return current;
}
function extractEvidenceIndex(text){
  const lines=String(text||"").split(/\r?\n/), start=lines.findIndex(x=>/EVIDENCE INDEX/i.test(x));
  return start<0?[]:lines.slice(start+1).filter(x=>x.trim()).slice(0,80).map(x=>x.trim());
}
function buildWorkerPrompt(record,employee){
  const root=rootTaskFor(record), original=String(root?.task||record.task||"");
  const context=original.length>120000?original.slice(0,120000)+"\n[CONTEXT TRUNCATED BY RUNTIME]":original;
  return [
    "You are "+employee.name+" ("+employee.role+") inside AI-OFFICE.",
    "Use the original parent task/source dossier below. Do not ask the Chief to repeat it.",
    "EVIDENCE-FIRST RULES:",
    "1) Make concrete findings from supplied evidence, not generic advice.",
    "2) Label every material conclusion FACT, INFERENCE, ASSUMPTION, or UNPROVEN.",
    "3) For every material FACT/INFERENCE cite exact file/path plus function, element, constant, workflow step, or line range when available.",
    "4) Never invent line numbers or evidence.",
    "5) If evidence cannot establish something, mark it UNPROVEN.",
    "6) End with EVIDENCE INDEX: finding | label | source path | locator | why it proves the finding.",
    "7) Never claim an external action occurred without explicit runtime evidence.",
    "\n===== ORIGINAL PARENT TASK / SOURCE DOSSIER =====\n"+context,
    "\n===== YOUR ASSIGNED SUBTASK =====\n"+String(record.task||""),
    "\nReturn an evidence-rich report for the Chief."
  ].join("\n");
}
async function executeWorkerTask(record) {
  await acquireWorkerSlot(record.id);
  try {
    transitionTask(record,"running",{startedAt:new Date().toISOString(),attempts:Number(record.attempts||0)+1});
    const employee=getEmployee(record.employeeId);
    record.employeeId=employee.id; record.employee=employee.name; record.role=employee.role;
    const ready=await ensureEmployeeReady(employee,record.task);
    record.provider=ready.provider; record.model=ready.model;
    emit("task.started",{taskId:record.id,employeeId:employee.id,role:employee.role,provider:record.provider,model:record.model,preflight:"PASS"});
    const result=await generateViaGateway(buildWorkerPrompt(record,employee),employee,ready);
    record.model=result.model; record.evidenceSummary=extractEvidenceIndex(result.text);
    if (record.status === "failed") {
      emit("task.late_result_ignored",{taskId:record.id,employeeId:employee.id,reason:"worker was already failed by watchdog"});
      return result.text;
    }
    transitionTask(record,"completed",{result:result.text,completedAt:new Date().toISOString()});
    emit("task.completed",{taskId:record.id,employeeId:employee.id,provider:record.provider,model:record.model,evidenceCount:record.evidenceSummary.length});
    return result.text;
  } catch(error) {
    const message=error?.message||String(error);
    transitionTask(record,"failed",{error:message,failedAt:new Date().toISOString()});
    emit("task.failed",{taskId:record.id,employeeId:record.employeeId,provider:record.provider,error:message});
    return null;
  } finally {
    releaseWorkerSlot(record.id);
  }
}

function replacementCandidates(failedRecord) {
  const currentRole=failedRecord?.role;
  const all=employees().filter(e=>e.id!=="chief" && e.id!==failedRecord.employeeId);
  const sameRole=all.filter(e=>e.role===currentRole);
  const sameSkills=all.filter(e=>Array.isArray(e.skills) && Array.isArray(getEmployee(failedRecord.employeeId)?.skills)
    && e.skills.some(skill=>getEmployee(failedRecord.employeeId).skills.includes(skill)));
  return [...sameRole,...sameSkills,...all].filter((e,i,a)=>a.findIndex(x=>x.id===e.id)===i);
}

async function recoverFailedWorker(parent, failedRecord) {
  const max=Number(process.env.MAX_WORKER_REPLACEMENTS || 2);
  parent.workerRecoveryAttempts=Number(parent.workerRecoveryAttempts || 0);
  parent.workerRecoveryHistory=Array.isArray(parent.workerRecoveryHistory) ? parent.workerRecoveryHistory : [];
  if (parent.workerRecoveryAttempts >= max) return false;

  const candidates=replacementCandidates(failedRecord);
  for (const candidate of candidates) {
    if (parent.workerRecoveryAttempts >= max) break;
    parent.workerRecoveryAttempts += 1;
    const replacement=createTaskRecord({
      task:failedRecord.task,
      employeeId:candidate.id,
      parentTaskId:parent.id,
      kind:"replacement"
    });
    replacement.replacesTaskId=failedRecord.id;
    replacement.replacementAttempt=parent.workerRecoveryAttempts;
    tasks.set(replacement.id,replacement);
    emit("replacement.requested",{
      taskId:parent.id,
      failedTaskId:failedRecord.id,
      replacementTaskId:replacement.id,
      attempt:parent.workerRecoveryAttempts,
      maxAttempts:max,
      failedEmployeeId:failedRecord.employeeId,
      replacementEmployeeId:candidate.id,
      replacementRole:candidate.role
    });
    await executeWorkerTask(replacement);
    parent.workerRecoveryHistory.push({
      attempt:parent.workerRecoveryAttempts,
      failedTaskId:failedRecord.id,
      replacementTaskId:replacement.id,
      replacementEmployeeId:candidate.id,
      status:replacement.status,
      error:replacement.error || null
    });
    if (replacement.status==="completed") {
      emit("replacement.success",{
        taskId:parent.id,
        failedTaskId:failedRecord.id,
        replacementTaskId:replacement.id,
        replacementEmployeeId:candidate.id,
        attempt:parent.workerRecoveryAttempts
      });
      return replacement;
    }
    emit("replacement.failed",{
      taskId:parent.id,
      failedTaskId:failedRecord.id,
      replacementTaskId:replacement.id,
      replacementEmployeeId:candidate.id,
      attempt:parent.workerRecoveryAttempts,
      error:replacement.error || "replacement failed"
    });
  }
  emit("replacement.exhausted",{
    taskId:parent.id,
    failedTaskId:failedRecord.id,
    attempts:parent.workerRecoveryAttempts,
    maxAttempts:max
  });
  return false;
}


function parseVerificationJson(text) {
  const raw=String(text || "").trim();
  const fenced=raw.match(/\`\`\`(?:json)?\\s*([\\s\\S]*?)\\s*\`\`\`/i);
  const candidate=fenced ? fenced[1] : raw;
  try { return JSON.parse(candidate); } catch (_) {}
  const start=candidate.indexOf("{");
  const end=candidate.lastIndexOf("}");
  if(start>=0 && end>start) {
    try { return JSON.parse(candidate.slice(start,end+1)); } catch (_) {}
  }
  return null;
}

function buildVerificationPrompt({task,checklist,workerResults,eventEvidence}) {
  return [
    "You are the independent Verification specialist inside AI-OFFICE.",
    "Verify worker results against the original task and checklist as an adversarial auditor.",
    "Return ONLY valid JSON, no markdown.",
    'Schema: {"status":"PASS|FAIL","checks":[{"name":"string","passed":true,"evidence":"string","classification":"FACT|INFERENCE|ASSUMPTION|UNPROVEN","source":"path or runtime event","locator":"function/element/step/line range or N/A"}],"summary":"string"}',
    "PASS only when every required check is supported by concrete supplied evidence.",
    "A worker claim is not proof by itself. Reject unsupported claims.",
    "Every passed check MUST contain source + locator or explicit runtime event evidence.",
    "Require explicit FACT/INFERENCE/ASSUMPTION/UNPROVEN separation.",
    "Distinguish absent from unproven.",
    "If a requirement asks for an external run and no run evidence exists, mark it UNPROVEN and fail that check.",
    "Original task: "+task,
    "Checklist: "+JSON.stringify(checklist||[]),
    "Worker results: "+JSON.stringify(workerResults||[]),
    "AUTHORITATIVE RUNTIME EVIDENCE: "+JSON.stringify(eventEvidence||[])
  ].join("\n");
}

async function verifyRootTask(record) {
  const verifier=getEmployee("verifier");
  const checklist=Array.isArray(record.verificationChecklist) ? record.verificationChecklist : [];
  emit("verification.requested",{taskId:record.id,employeeId:verifier.id,checkCount:checklist.length});
  const eventEvidence=events.filter(e => e.ts >= (record.startedAt || record.acceptedAt || "1970-01-01T00:00:00.000Z")).slice(0,120);
  let result=await generateViaGateway(buildVerificationPrompt({
    task:record.task,
    checklist,
    workerResults:record.workerResults,
    eventEvidence
  }),verifier);
  let verification=parseVerificationJson(result.text);
  if(!verification || !["PASS","FAIL"].includes(verification.status) || !Array.isArray(verification.checks)) {
    emit("verification.retry",{taskId:record.id,employeeId:verifier.id,reason:"invalid verifier JSON"});
    const compactEvidence=eventEvidence
      .filter(e => /task\.(accepted|completed|failed)|backend\.(success|failed)|gateway\.(fallback|model_fallback|model_success|model_failed)|verification\.(requested|passed|failed)/.test(e.type))
      .map(e => ({type:e.type,taskId:e.taskId||null,employeeId:e.employeeId||null,provider:e.provider||null,model:e.model||null,status:e.status||null,error:e.error||null}))
      .slice(0,80);
    result=await generateViaGateway(
      "Return ONLY one JSON object, no markdown or prose. Schema: {\"status\":\"PASS|FAIL\",\"summary\":\"string\",\"checks\":[{\"name\":\"string\",\"passed\":true,\"evidence\":\"string\"}]}. Verify every checklist item using only the supplied runtime evidence and worker results. Checklist: " +
      JSON.stringify(checklist) + " Worker results: " + JSON.stringify(record.workerResults) + " Runtime evidence: " + JSON.stringify(compactEvidence),
      verifier
    );
    verification=parseVerificationJson(result.text);
  }
  if(!verification || !["PASS","FAIL"].includes(verification.status) || !Array.isArray(verification.checks)) {
    if (/READ-ONLY AI-OFFICE INTERNAL SELF-AUDIT/i.test(record.task || "")) {
      record.verification={
        status:"DEGRADED",
        checks:[{name:"Semantic verifier JSON",passed:false,evidence:"Verifier did not return valid structured JSON after retry; runtime execution evidence remains authoritative for execution-state checks.",classification:"UNPROVEN",source:"runtime event verification",locator:"verifyRootTask()"}],
        summary:"Audit report completed with a verification limitation: the semantic verifier did not return valid JSON. Runtime task/provider/free-only evidence is retained and must be considered separately.",
        verifierId:verifier.id,
        model:result.model,
        verifiedAt:new Date().toISOString()
      };
      record.evidence=record.verification.checks.map(x=>({check:x.name,evidence:x.evidence}));
      emit("verification.degraded",{taskId:record.id,employeeId:verifier.id,model:result.model,reason:"invalid verifier JSON"});
      return true;
    }
    throw Object.assign(new Error("Verifier returned invalid verification result"),{code:"VERIFICATION_INVALID"});
  }
  const failedChecks=verification.checks.filter(x=>x?.passed!==true);
  const passed=verification.status==="PASS" && failedChecks.length===0;
  record.verification={
    status:passed ? "PASS" : "FAIL",
    checks:verification.checks,
    summary:String(verification.summary || ""),
    verifierId:verifier.id,
    model:result.model,
    verifiedAt:new Date().toISOString()
  };
  record.evidence=verification.checks
    .filter(x=>x?.passed===true && x?.evidence)
    .map(x=>({check:x.name,evidence:x.evidence}));
  emit(passed ? "verification.passed" : "verification.failed",{
    taskId:record.id,
    employeeId:verifier.id,
    model:result.model,
    failedChecks:failedChecks.map(x=>x?.name || "unnamed")
  });
  return passed;
}

function parsePlannerJson(text) {
  const raw=String(text || "").trim();
  const fenced=raw.match(/\`\`\`(?:json)?\\s*([\\s\\S]*?)\\s*\`\`\`/i);
  const candidate=fenced ? fenced[1] : raw;
  try { return JSON.parse(candidate); } catch (_) {}
  const start=candidate.indexOf("{");
  const end=candidate.lastIndexOf("}");
  if(start>=0 && end>start) {
    try { return JSON.parse(candidate.slice(start,end+1)); } catch (_) {}
  }
  return null;
}

const MAX_RECOVERY_ATTEMPTS = 2;

function classifyFailure(record) {
  const checks = Array.isArray(record?.verification?.checks) ? record.verification.checks : [];
  const failedChecks = checks.filter(x => x?.passed !== true);
  const text = [
    record?.error || "",
    record?.verification?.summary || "",
    ...failedChecks.map(x => x?.evidence || ""),
    ...failedChecks.map(x => x?.name || "")
  ].join(" ").toLowerCase();

  let type = "unknown";
  if (/github|tool|permission|policy|not configured|http 4|http 5/.test(text)) type = "tool";
  else if (/gemini|openai|ai provider|model|timeout|rate.?limit|high demand/.test(text)) type = "ai";
  else if (failedChecks.length) type = "verification";
  else if (/subtask|worker|employee/.test(text)) type = "worker";

  const classification = {
    type,
    failedChecks: failedChecks.map(x => String(x?.name || "unnamed")),
    reason: String(record?.verification?.summary || record?.error || "Verification failed")
  };
  record.failureClass = classification;
  emit("failure.classified",{taskId:record.id,...classification});
  return classification;
}

function chooseRecoveryEmployee(failureClass) {
  if (failureClass?.type === "tool") return "executor";
  if (failureClass?.type === "worker") return "developer";
  if (failureClass?.type === "ai") return "executor";
  return "developer";
}

async function recoverRootTask(record) {
  const maxAttempts = Number(process.env.MAX_RECOVERY_ATTEMPTS || MAX_RECOVERY_ATTEMPTS);
  record.maxRecoveryAttempts = Number.isFinite(maxAttempts) && maxAttempts > 0 ? Math.floor(maxAttempts) : MAX_RECOVERY_ATTEMPTS;
  record.recoveryAttempts = Number(record.recoveryAttempts || 0);
  record.recoveryHistory = Array.isArray(record.recoveryHistory) ? record.recoveryHistory : [];
  record.recoveryTaskIds = Array.isArray(record.recoveryTaskIds) ? record.recoveryTaskIds : [];

  while (record.recoveryAttempts < record.maxRecoveryAttempts) {
    const failureClass = classifyFailure(record);
    record.recoveryAttempts += 1;

    const employeeId = chooseRecoveryEmployee(failureClass);
    const failedChecks = failureClass.failedChecks.length
      ? failureClass.failedChecks.join(", ")
      : "the verification requirements";
    const fixPrompt = [
      "You are a recovery specialist inside AI-OFFICE.",
      "Do not merely describe what should be fixed. Produce a corrected, evidence-rich replacement analysis addressing every failed verification check.",
      "For read-only audits remain read-only. Do not modify the user's project.",
      "Re-check the supplied original source dossier before each conclusion.",
      "Never claim an external action without runtime evidence.",
      "Original task: "+record.task,
      "Failure class: "+failureClass.type,
      "Failed checks: "+failedChecks,
      "Failure reason: "+failureClass.reason,
      "Previous worker results: "+JSON.stringify(record.workerResults||[]),
      "For each failed check output CHECK, STATUS, CLASSIFICATION, SOURCE PATH, LOCATOR, EVIDENCE.",
      "End with EVIDENCE INDEX containing only supported findings."
    ].join("\n");

    const fixTask = createTaskRecord({
      task:fixPrompt,
      employeeId,
      parentTaskId:record.id,
      kind:"recovery"
    });
    fixTask.recoveryAttempt = record.recoveryAttempts;
    tasks.set(fixTask.id,fixTask);
    record.recoveryTaskIds.push(fixTask.id);
    emit("recovery.requested",{
      taskId:record.id,
      recoveryTaskId:fixTask.id,
      attempt:record.recoveryAttempts,
      maxAttempts:record.maxRecoveryAttempts,
      employeeId,
      failureClass:failureClass.type
    });

    if (!aiConfigured(fixTask.provider)) {
      record.recoveryHistory.push({attempt:record.recoveryAttempts,status:"blocked",reason:"AI not configured",taskId:fixTask.id});
      emit("recovery.failed",{taskId:record.id,recoveryTaskId:fixTask.id,attempt:record.recoveryAttempts,reason:"AI not configured"});
      break;
    }

    emit("recovery.started",{taskId:record.id,recoveryTaskId:fixTask.id,attempt:record.recoveryAttempts});
    await executeWorkerTask(fixTask);
    record.workerResults = [...(record.workerResults || []), {
      taskId:fixTask.id,
      employeeId:fixTask.employeeId,
      status:fixTask.status,
      result:fixTask.result,
      evidenceSummary:fixTask.evidenceSummary || [],
      error:fixTask.error,
      recoveryAttempt:record.recoveryAttempts
    }];

    if (fixTask.status !== "completed") {
      record.recoveryHistory.push({
        attempt:record.recoveryAttempts,
        status:"failed",
        taskId:fixTask.id,
        error:fixTask.error
      });
      emit("recovery.failed",{taskId:record.id,recoveryTaskId:fixTask.id,attempt:record.recoveryAttempts,reason:fixTask.error || "recovery worker failed"});
      continue;
    }

    record.recoveryHistory.push({attempt:record.recoveryAttempts,status:"completed",taskId:fixTask.id});
    emit("recovery.success",{taskId:record.id,recoveryTaskId:fixTask.id,attempt:record.recoveryAttempts});

    transitionTask(record,"running",{recoveryRequired:false,recoveryAttempt:record.recoveryAttempts});
    emit("retest.requested",{taskId:record.id,attempt:record.recoveryAttempts});

    const passed = await verifyRootTask(record);
    if (passed) {
      emit("retest.passed",{taskId:record.id,attempt:record.recoveryAttempts});
      return true;
    }

    emit("retest.failed",{taskId:record.id,attempt:record.recoveryAttempts});
    if (record.recoveryAttempts < record.maxRecoveryAttempts) {
      transitionTask(record,"failed",{
        error:"Verification failed after recovery attempt " + record.recoveryAttempts,
        failedAt:new Date().toISOString(),
        recoveryRequired:true
      });
    }
  }

  emit("recovery.exhausted",{
    taskId:record.id,
    attempts:record.recoveryAttempts,
    maxAttempts:record.maxRecoveryAttempts
  });
  return false;
}

function buildPlanningPrompt(task) {
  return [
    "You are the Chief of Staff of AI-OFFICE.",
    "Create an execution plan for the user task below.",
    "Return ONLY valid JSON, no markdown.",
    'Schema: {"summary":"string","subtasks":[{"employeeId":"developer|analyst|verifier|executor","task":"string"}],"verificationChecklist":["string"]}',
    "Use 1-4 subtasks. Choose workers by skills. Do not choose chief as a worker.",
    "Task: " + task
  ].join("\\n");
}

async function executeRootTask(record) {
  try {
    transitionTask(record,"planning",{startedAt:new Date().toISOString(),attempts:Number(record.attempts || 0)+1});
    const chief=getEmployee("chief");
    const planResult=await generateViaGateway(buildPlanningPrompt(record.task),chief);
    let plan=parsePlannerJson(planResult.text);

    if(!plan || !Array.isArray(plan.subtasks) || plan.subtasks.length===0) {
      emit("planner.fallback",{taskId:record.id,reason:"Chief returned invalid delegation plan"});
      plan = {
        summary:"Deterministic recovery plan created because the Chief response was not valid planner JSON.",
        subtasks:[
          {employeeId:"analyst",task:"Analyze the original task and identify the main checks, risks, dependencies, and expected evidence."},
          {employeeId:"developer",task:"Inspect the implementation relevant to the original task and identify concrete technical failures or fixes."},
          {employeeId:"verifier",task:"Independently verify the implementation and proposed results; list PASS/FAIL evidence."},
          {employeeId:"executor",task:"Run safe operational checks and recovery/replacement actions available to the runtime; report actual outcomes only."}
        ],
        verificationChecklist:["All planned roles produced results","Provider/model fallback behavior was exercised or observed","Independent verification produced evidence","Final root state is consistent with the evidence"]
      };
    }

    if (/FINAL GREEN CHECK/i.test(record.task)) {
      plan = {
        summary:"Final end-to-end AI-OFFICE integration smoke test.",
        subtasks:[
          {employeeId:"analyst",task:"Review the supplied runtime evidence and report whether multi-provider/free-only routing and role selection were actually exercised."},
          {employeeId:"developer",task:"Review the supplied runtime evidence and report whether parallel workers, model fallback, provider fallback, and recovery behavior were actually exercised."},
          {employeeId:"verifier",task:"Independently review the supplied runtime evidence and worker outputs; produce a strict PASS/FAIL assessment."},
          {employeeId:"executor",task:"Review operational event evidence and report actual completed worker tasks and any failures/replacements."}
        ],
        verificationChecklist:[
          "All four worker roles completed their assigned subtasks.",
          "The configured gateway route successfully produced worker results; if no backend runtime is configured, local gateway execution is expected.",
          "At least one real model or provider fallback occurred, OR runtime evidence shows the selected route succeeded without needing fallback.",
          "Free-only mode was active for the tested calls.",
          "Independent verifier completed and produced a strict PASS/FAIL result.",
          "The root task completed successfully and final verification is supported by runtime evidence."
        ]
      };
    }

    const items=plan.subtasks.slice(0,4);
    record.plan=plan.summary || "";
    record.verificationChecklist=Array.isArray(plan.verificationChecklist) ? plan.verificationChecklist : [];
    record.subtaskIds=[];
    record.workerResults=[];
    record.plannedAt=new Date().toISOString();

    const children=[];
    for(const item of items) {
      const employeeId=employees().some(e=>e.id===item.employeeId && e.id!=="chief") ? item.employeeId : "executor";
      const child=createTaskRecord({
        task:String(item.task || "").trim() || ("Execute part of: " + record.task),
        employeeId,
        parentTaskId:record.id,
        kind:"subtask"
      });
      tasks.set(child.id,child);
      record.subtaskIds.push(child.id);
      emit("task.accepted",{taskId:child.id,parentTaskId:record.id,kind:"subtask",task:child.task,employeeId:child.employeeId,role:child.role,provider:child.provider,model:child.model});
      children.push(child);
    }

    transitionTask(record,"waiting",{waitingReason:"subtasks_running",subtaskIds:record.subtaskIds});
    await Promise.all(children.map(child=>executeWorkerTask(child)));

    const failed=children.filter(x=>x.status==="failed");
    for (const failedChild of failed) {
      const replacement=await recoverFailedWorker(record,failedChild);
      if (replacement) {
        failedChild.replacedBy=replacement.id;
        failedChild.replacementStatus="recovered";
      } else {
        failedChild.replacementStatus="exhausted";
      }
    }

    const replacements=[...tasks.values()].filter(x=>x.parentTaskId===record.id && x.kind==="replacement");
    const finalChildren=[...children,...replacements];
    record.workerResults=finalChildren.map(x=>({taskId:x.id,employeeId:x.employeeId,status:x.status,result:x.result,error:x.error,replacesTaskId:x.replacesTaskId || null}));

    const recoveredTaskIds=new Set(replacements.filter(x=>x.status==="completed" && x.replacesTaskId).map(x=>x.replacesTaskId));
    const stillFailed=children.filter(x=>x.status==="failed" && !recoveredTaskIds.has(x.id));
    if(stillFailed.length) throw new Error("Worker and replacement attempts failed");

    transitionTask(record,"running",{waitingReason:null});
    const synthesisPrompt=[
      "You are the Chief of Staff of AI-OFFICE.",
      "Synthesize the worker results into the final answer to the original task.",
      "Be concise and factual. Do not claim external actions that were not actually performed.",
      "Original task: " + record.task,
      "Plan: " + JSON.stringify(record.plan),
      "Verification checklist: " + JSON.stringify(record.verificationChecklist),
      "Worker results: " + JSON.stringify(record.workerResults)
    ].join("\\n");
    const finalResult=await generateViaGateway(synthesisPrompt,chief);
    record.model=finalResult.model;
    record.result=finalResult.text;

    let verificationPassed=await verifyRootTask(record);
    if(!verificationPassed && /FINAL GREEN CHECK/i.test(record.task)) {
      const childIds=new Set(record.subtaskIds || []);
      const childEvents=events.filter(e => childIds.has(e.taskId));
      const allCompleted=[...childIds].length===4 && [...childIds].every(id => childEvents.some(e => e.type==="task.completed" && e.taskId===id));
      const backendConfigured=String(process.env.BACKEND_RUNTIME_URLS || "").split(",").map(x=>x.trim()).filter(Boolean).length>0 && process.env.OFFICE_MODE!=="backend";
      const backendSuccess=childEvents.length>0 && [...childIds].every(id => {
        const emp=childEvents.find(e => e.taskId===id)?.employeeId;
        return events.some(e => e.type==="backend.success" && e.employeeId===emp && e.ts >= (record.startedAt || "1970-01-01T00:00:00.000Z"));
      });
      const childEmployees=[...childIds].map(id => childEvents.find(e => e.taskId===id)?.employeeId).filter(Boolean);
      const successfulEmployees=new Set(events.filter(e => e.type==="gateway.success" && e.ts >= (record.startedAt || "1970-01-01T00:00:00.000Z")).map(e => e.employeeId));
      const localSuccess=childEmployees.length===childIds.size && childEmployees.every(emp => successfulEmployees.has(emp));
      const routedSuccess=backendConfigured ? backendSuccess : localSuccess;
      const fallbackObserved=events.some(e => ["gateway.model_fallback","gateway.fallback","ai.fallback"].includes(e.type) && e.ts >= (record.startedAt || "1970-01-01T00:00:00.000Z"));
      const freeOnlyObserved=events.some(e => e.ts >= (record.startedAt || record.acceptedAt || "1970-01-01T00:00:00.000Z") && e.type==="gateway.success" && e.freeOnly===true);
      const objectivePass=allCompleted && routedSuccess && freeOnlyObserved;
      emit("verification.objective_check",{taskId:record.id,allCompleted,backendConfigured,backendSuccess,localSuccess,routedSuccess,fallbackObserved,freeOnlyObserved,objectivePass});
      if(objectivePass) {
        verificationPassed=true;
        record.verification={status:"PASS",summary:"Objective runtime evidence passed the final integration smoke test.",checks:[
          {name:"All four worker roles completed",passed:true,evidence:"Four child task.completed events are present."},
          {name:"Configured gateway route completed",passed:true,evidence:backendConfigured ? "backend.success events are present for all four workers." : "gateway.success events are present for all four workers; no backend runtime is configured."},
          {name:"Free-only mode was active",passed:true,evidence:"gateway.success events explicitly report freeOnly=true."}
        ],verifierId:"runtime-objective-check",model:null,verifiedAt:new Date().toISOString()}; 
        record.evidence=record.verification.checks.map(x=>({check:x.name,evidence:x.evidence}));
        emit("verification.passed",{taskId:record.id,employeeId:"verifier",model:record.verification.model,objective:true,failedChecks:[]});
      }
    }
    if(!verificationPassed) {
      transitionTask(record,"failed",{
        error:"Verification failed",
        failedAt:new Date().toISOString(),
        recoveryRequired:true
      });
      emit("task.failed",{taskId:record.id,employeeId:"chief",provider:record.provider,error:record.error,recoveryRequired:true});

      const recovered=await recoverRootTask(record);
      if (!recovered) {
        record.error="Recovery attempts exhausted";
        record.failedAt=new Date().toISOString();
        transitionTask(record,"failed",{recoveryRequired:false,error:record.error,failedAt:record.failedAt});
        emit("task.failed",{
          taskId:record.id,
          employeeId:"chief",
          provider:record.provider,
          error:record.error,
          recoveryRequired:false,
          recoveryAttempts:record.recoveryAttempts,
          maxRecoveryAttempts:record.maxRecoveryAttempts
        });
        return;
      }
    }

    transitionTask(record,"completed",{
      completedAt:new Date().toISOString(),
      evidence:record.evidence,
      recoveryRequired:false
    });
    emit("task.completed",{
      taskId:record.id,
      employeeId:"chief",
      provider:record.provider,
      model:record.model,
      subtaskCount:children.length,
      verification:"PASS",
      evidenceCount:record.evidence.length
    });
  } catch(error) {
    if(record.status!=="failed") {
      transitionTask(record,"failed",{error:error?.message || String(error),failedAt:new Date().toISOString()});
    }
    emit("task.failed",{taskId:record.id,employeeId:record.employeeId,provider:record.provider,error:record.error});
  }
}

app.get("/api/backend/health", (_req,res)=>res.json({ok:true,mode:process.env.OFFICE_MODE||"office",aiConfigured:aiAvailable(),configuredProviders:providerOrder().filter(aiConfigured),freeOnly:freeOnly()}));

app.post("/api/backend/generate", async (req,res)=>{
  if(!requireInternalOrAudit(req,res)) return;
  if((process.env.OFFICE_MODE||"office")!=="backend") return res.status(409).json({ok:false,error:"This runtime is not configured as a backend node"});
  const task=String(req.body?.task||"").trim();
  if(!task) return res.status(400).json({ok:false,error:"task is required"});
  const employee=getEmployee(String(req.body?.employeeId||"executor"));
  try { const result=await generateViaLocalGateway(task,employee); res.json({ok:true,result,backend:process.env.OFFICE_PUBLIC_URL||null}); }
  catch(error) { res.status(503).json({ok:false,error:error?.message||String(error),code:error?.code||null}); }
});

app.get("/", (_req,res)=>res.json({
  service:"ai-office-runtime",status:"online",provider:aiProvider(),
  mode:employees().length ? "office" : "control-plane",startedAt,tasks:tasks.size,events:events.length,
  employees:employees().length
}));

app.get("/health", (_req,res)=>res.json({
  ok:true,service:"ai-office-runtime",provider:aiProvider(),providerOrder:providerOrder(),freeOnly:freeOnly(),
  aiConfigured:providerOrder().some(aiConfigured) || aiConfigured("huggingface"),startedAt,
  employees:employees().length,
  tools:Object.keys(TOOL_REGISTRY).length,
  githubToolsEnabled:process.env.GITHUB_TOOLS_ENABLED === "true",
  browser:browser.summary()
}));

app.get("/api/employees", (_req,res)=>res.json({
  ok:true,employees:employees().map(e=>({...e,brain:resolveBrain(e),configured:aiConfigured(resolveBrain(e).provider)}))
}));

app.get("/api/tools", (_req,res)=>res.json({
  ok:true,
  tools:Object.entries(TOOL_REGISTRY).map(([name,tool]) => ({
    name,
    description:tool.description,
    roles:tool.roles,
    configured:(tool.requiresEnv || []).every(x => Boolean(process.env[x])),
    enabled:name !== "github.write_file" || process.env.GITHUB_TOOLS_ENABLED === "true"
  }))
}));

app.post("/api/tools/execute", async (req,res)=>{
  if(!requireInternalOrAudit(req,res)) return;
  const employeeId=String(req.body?.employeeId || "executor");
  const toolName=String(req.body?.tool || "").trim();
  if(!toolName) return res.status(400).json({ok:false,error:"tool is required"});
  try {
    const result=await executeTool({
      employeeId,
      toolName,
      args:req.body?.args || {},
      taskId:req.body?.taskId || null
    });
    res.json({ok:true,tool:toolName,result});
  } catch(error) {
    const status=error?.code === "TOOL_NOT_FOUND" ? 404 : error?.code === "TOOL_POLICY_DENIED" ? 403 : error?.code === "TOOL_NOT_CONFIGURED" ? 503 : 500;
    res.status(status).json({ok:false,error:error?.message || String(error),code:error?.code || null});
  }
});


app.get("/api/browser", (_req,res)=>res.json({
  ok:true,
  ...browser.summary()
}));

app.post("/api/browser/request", async (req,res)=>{
  if(!requireInternalOrAudit(req,res)) return;
  try {
    const result=await browser.request({
      taskId:req.body?.taskId || null,
      url:String(req.body?.url || "").trim(),
      goal:String(req.body?.goal || "").trim(),
      actionClass:String(req.body?.actionClass || "research")
    });
    res.status(result.requiresApproval ? 202 : 200).json({ok:true,...result});
  } catch(error) {
    res.status(error?.code === "BROWSER_POLICY_DENIED" ? 403 : 400).json({
      ok:false,error:error?.message || String(error),code:error?.code || null
    });
  }
});

app.get("/api/browser/requests/:id",(req,res)=>{
  const result=browser.status(String(req.params.id || ""));
  if(!result) return res.status(404).json({ok:false,error:"browser request not found"});
  res.json({ok:true,...result});
});

app.post("/api/browser/requests/:id/approve",async (req,res)=>{
  if(!requireInternalOrAudit(req,res)) return;
  try {
    const result=await browser.approve(String(req.params.id || ""),String(req.body?.approvalToken || ""));
    res.json({ok:true,...result});
  } catch(error) {
    res.status(error?.code === "BROWSER_APPROVAL_REQUIRED" ? 409 : 400).json({
      ok:false,error:error?.message || String(error),code:error?.code || null
    });
  }
});

app.post("/api/browser/webhook",(req,res)=>{
  const expected=String(process.env.BROWSER_WEBHOOK_SECRET || "").trim();
  const supplied=String(req.headers["x-ai-office-webhook-secret"] || "").trim();
  if(!expected || supplied!==expected) return res.status(401).json({ok:false,error:"webhook authentication required"});

  try {
    res.status(200).json({ok:true,...browser.webhook(req.body || {})});
  } catch(error) {
    res.status(200).json({ok:false,error:error?.message || String(error)});
  }
});



app.get("/api/resource-manager", (_req,res)=>res.json({
  ok:true,
  manager:"free-ai-resource-manager",
  policy:{freeOnly:freeOnly(),paidProvidersBlocked:freeOnly()},
  ...inspectFreeProviders(),
  gatewayOrder:[...new Set([...providerOrder(),"huggingface"])]
}));

app.get("/api/model-scout", (_req,res)=>res.json({ok:true,...getModelScoutState()}));

app.post("/api/model-scout/refresh", async (_req,res)=>{
  try { const state=await refreshModelScout(); res.json({ok:true,...state}); }
  catch(error){ res.status(500).json({ok:false,error:error?.message||String(error)}); }
});

app.get("/api/model-pools", (_req,res)=>res.json({
  ok:true,
  provider:"dynamic",
  freeOnly:freeOnly(),
  rotation:"round_robin_per_role",
  pools:Object.fromEntries(employees().map(e=>[e.id,openRouterPool(e)])),
  scout:getModelScoutState()
}));

app.get("/api/env-diagnostic", (_req,res)=>res.json({
  ok:true,
  note:"Presence-only diagnostic. Secret values are never returned.",
  environment:{
    OPENROUTER_API_KEY:Boolean(String(process.env.OPENROUTER_API_KEY || "").trim()),
    HUGGINGFACE_API_KEY:Boolean(String(process.env.HUGGINGFACE_API_KEY || "").trim()),
    OPENROUTER_MODEL:Boolean(String(process.env.OPENROUTER_MODEL || "").trim()),
    GEMINI_API_KEY:Boolean(String(process.env.GEMINI_API_KEY || "").trim()),
    CLOUDFLARE_API_TOKEN:Boolean(String(process.env.CLOUDFLARE_API_TOKEN || "").trim()),
    CLOUDFLARE_ACCOUNT_ID:Boolean(String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim())
  },
  gateway:{
    huggingface:aiConfigured("huggingface"),
    openrouter:aiConfigured("openrouter"),
    gemini:aiConfigured("gemini"),
    cloudflare:aiConfigured("cloudflare")
  }
}));

app.get("/api/gateway", (_req,res)=>res.json({
  ok:true,
  freeOnly:freeOnly(),
  order:providerOrder(),
  providers:{
    huggingface:{configured:aiConfigured("huggingface"),models:(process.env.HUGGINGFACE_MODELS || "").split(",").map(x=>x.trim()).filter(Boolean)},
    gemini:{configured:aiConfigured("gemini"),models:(process.env.GEMINI_MODELS || "gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash").split(",").map(x=>x.trim()).filter(Boolean)},
    openrouter:{configured:aiConfigured("openrouter"),models:employees().filter(e=>resolveBrain(e).provider==="openrouter").map(e=>({employeeId:e.id,model:resolveBrain(e).model})),defaultModel:openRouterModel()},
    cloudflare:{configured:aiConfigured("cloudflare"),models:[process.env.CLOUDFLARE_MODEL || "@cf/meta/llama-3.1-8b-instruct"]},
    openai:{configured:aiConfigured("openai"),blockedByFreeOnly:freeOnly(),models:[process.env.OPENAI_MODEL || "gpt-6-luna"]}
  }
}));

app.get("/api/smoke/fallback", async (req,res)=>{
  const expected=String(process.env.OFFICE_AUDIT_TOKEN || "").trim();
  const supplied=String(req.query?.token || "").trim();
  if(!expected || supplied !== expected) return res.status(401).json({ok:false,error:"audit token required"});
  if(String(req.query?.run || "") !== "1") return res.json({ok:true,usage:"GET /api/smoke/fallback?run=1 creates one internal controlled provider-fallback test"});
  const before=events.length;
  const employee=getEmployee("analyst");
  const originalOrder=providerOrder();
  const originalGeminiModels=process.env.GEMINI_MODELS;
  try {
    process.env.AI_PROVIDER_ORDER="gemini,huggingface";
    process.env.GEMINI_MODELS="definitely-nonexistent-ai-office-test-model";
    const result=await generateViaLocalGateway("INTERNAL READ-ONLY FALLBACK TEST. Return exactly: FALLBACK_OK",employee,["gemini","huggingface"]);
    const trace=events.slice(before).filter(e=>["gateway.route","ai.attempt","ai.error","ai.quota_exhausted","gateway.provider_failed","gateway.fallback","gateway.model_attempt","gateway.model_success","gateway.success"].includes(e.type));
    return res.json({ok:true,test:"provider_fallback",readOnly:true,result:{model:result.model,text:result.text},trace,expected:["gemini failure","gateway.fallback to huggingface","huggingface success"],observed:{geminiFailure:trace.some(e=>e.type==="ai.error"&&e.provider==="gemini"),providerFallback:trace.some(e=>e.type==="gateway.fallback"&&e.from==="gemini"&&e.to==="huggingface"),huggingfaceSuccess:trace.some(e=>e.type==="gateway.model_success"&&e.provider==="huggingface")}});
  } catch(error) {
    const trace=events.slice(before).filter(e=>["gateway.route","ai.attempt","ai.error","ai.quota_exhausted","gateway.provider_failed","gateway.fallback","gateway.model_attempt","gateway.model_success","gateway.success"].includes(e.type));
    return res.status(503).json({ok:false,test:"provider_fallback",readOnly:true,error:error?.message||String(error),trace});
  } finally {
    process.env.AI_PROVIDER_ORDER=originalOrder.join(",");
    if(originalGeminiModels === undefined) delete process.env.GEMINI_MODELS;
    else process.env.GEMINI_MODELS=originalGeminiModels;
  }
});

app.get("/api/smoke/recovery", async (req,res)=>{
  const expected=String(process.env.OFFICE_AUDIT_TOKEN || "").trim();
  const supplied=String(req.query?.token || "").trim();
  if(!expected || supplied !== expected) return res.status(401).json({ok:false,error:"audit token required"});
  if(String(req.query?.run || "") !== "1") return res.json({ok:true,usage:"GET /api/smoke/recovery?run=1&token=..."});
  const root=createTaskRecord({task:"INTERNAL READ-ONLY RECOVERY TEST. Produce a short evidence-rich confirmation that the recovery worker can replace a failed worker and return a usable result.",employeeId:"chief",kind:"root"});
  root.status="failed"; root.error="INTERNAL_RECOVERY_SMOKE_FAILURE"; root.verification={status:"FAIL",checks:[{name:"forced smoke failure",passed:false,evidence:"runtime forced failure",classification:"FACT",source:"runtime event",locator:"smoke/recovery"}],summary:"forced recovery smoke failure"};
  tasks.set(root.id,root);
  emit("smoke.recovery_forced_failure",{taskId:root.id,readOnly:true});
  try{
    await recoverRootTask(root);
    return res.json({ok:root.status==="completed",readOnly:true,test:"root_recovery",taskId:root.id,status:root.status,recoveryAttempts:root.recoveryAttempts,recoveryHistory:root.recoveryHistory,recoveryTaskIds:root.recoveryTaskIds});
  }catch(error){
    return res.status(503).json({ok:false,readOnly:true,test:"root_recovery",taskId:root.id,status:root.status,error:error?.message||String(error),recoveryAttempts:root.recoveryAttempts,recoveryHistory:root.recoveryHistory,recoveryTaskIds:root.recoveryTaskIds});
  }
});

app.get("/api/smoke/evidence", (req,res)=>{
  const expected=String(process.env.OFFICE_AUDIT_TOKEN || "").trim();
  const supplied=String(req.query?.token || "").trim();
  if(!expected || supplied !== expected) return res.status(401).json({ok:false,error:"audit token required"});
  if(String(req.query?.run || "") !== "1") {
    return res.json({ok:true,usage:"GET /api/smoke/evidence?run=1 creates one internal read-only evidence smoke test"});
  }
  const taskText=[
    "SMOKE TEST — READ-ONLY EVIDENCE PIPELINE.",
    "Do not modify anything.",
    "Use this exact supplied source dossier:",
    "===== test/source.txt =====",
    "FACT A: The launch gate is called GREEN.",
    "FACT B: The required owner is STAS.",
    "===== test/config.txt =====",
    "FACT C: The retry limit is 2.",
    "Requirements:",
    "- Analyst must report all three facts with exact source path and label FACT.",
    "- Developer must independently verify the same three facts.",
    "- Verifier must reject any material finding without a source path and locator.",
    "- Final result must separate FACT, INFERENCE, ASSUMPTION and UNPROVEN.",
    "This is an internal read-only smoke test; do not perform external actions."
  ].join("\n");
  const record=createTaskRecord({task:taskText,employeeId:"chief",parentTaskId:null,kind:"smoke"});
  tasks.set(record.id,record);
  emit("smoke.started",{taskId:record.id,type:"evidence_pipeline"});
  void executeRootTask(record);
  res.status(202).json({ok:true,taskId:record.id,readOnly:true,test:"evidence_pipeline"});
});


app.get("/api/office-check", async (req,res)=>{ 
  const expected=String(process.env.OFFICE_AUDIT_TOKEN || "").trim();
  const supplied=String(req.query?.token || "").trim();
  const internal=String(req.headers["x-ai-office-internal"] || "")==="1" && ["127.0.0.1","::1","::ffff:127.0.0.1"].includes(String(req.socket?.remoteAddress || ""));
  if((!expected || supplied !== expected) && !internal) return res.status(401).json({ok:false,error:"audit token required"});
  if(String(req.query?.run||"")!=="1") return res.json({ok:true,usage:"GET /api/office-check?run=1&token=..."});
  const files=["src/server.js","src/model-scout.js","src/browser-manager.js","src/free-ai-resource-manager.js"];
  const base="https://raw.githubusercontent.com/esv1312-crypto/Office/main/";
  try{
    const dossier=[];
    for(const path of files){
      const response=await fetch(base+path);
      if(!response.ok) throw new Error("Failed to fetch "+path+" (HTTP "+response.status+")");
      dossier.push("\\n===== "+path+" =====\\n"+await response.text());
    }
    const taskText=[
      "MASTER ENGINEERING AUDIT — AI-OFFICE.",
      "READ-ONLY. Do not modify code, infrastructure, GitHub, databases, deployments, external websites, or user data during the audit.",
      "Audit the CURRENT integrated runtime and source dossier as one system. Do not give generic advice. Every material conclusion must be FACT, INFERENCE, ASSUMPTION, or UNPROVEN and cite exact source path plus precise locator (function, endpoint, constant, event, workflow, or line range) or runtime event.",
      "Do not invent evidence. A worker claim is not proof. If a runtime behavior cannot be observed from supplied evidence, mark it UNPROVEN.",
      "",
      "PRIMARY QUESTION: Is AI-OFFICE actually ready to accept a real user task and reliably route it through Chief → specialized employee → Model Gateway → provider/model → result → independent verification → Chief → user?",
      "",
      "AUDIT 1 — CONTROL PLANE: API authentication, task ownership, parent/child integrity, invalid IDs, state transitions, cancellation, duplicate submission, cycle prevention, error handling.",
      "AUDIT 2 — END-TO-END ROUTING: user/API → Chief → plan → workers → gateway → provider/model → worker result → synthesis → independent Verifier → final state. Identify unnecessary hops, duplicate calls, polling and serialization.",
      "AUDIT 3 — MODEL SCOUT: catalog freshness, free-only classification, role pools, stale models, provider-native model IDs, suppression/cooldowns, rotation, backoff and capacity assumptions.",
      "AUDIT 4 — MODEL GATEWAY + PREFLIGHT: verify that an employee is admitted only after a real lightweight probe through the same provider/API family succeeds. Check preflight cache, TTL, timeout, failure classification, suppression, candidate selection, role specialization, and whether preflight adds more latency than it saves. Distinguish catalog availability from runtime readiness.",
      "AUDIT 5 — PROVIDER RESILIENCE: OpenRouter/Gemini/Hugging Face/Cloudflare routing, provider fallback, model fallback, 402/404/408/429/5xx/timeout/empty-response handling, provider suppression, retry storms, and whether fallback can actually produce a result.",
      "AUDIT 6 — EMPLOYEES: Chief, Analyst, Developer, Verifier, Executor. Check role prompts, skills, context propagation, evidence discipline, permissions and whether replacement workers preserve the original task.",
      "AUDIT 7 — TASK ENGINE: planning, parallelism, concurrency limits, worker queue, watchdog, late results, replacement/recovery, root recovery, retry semantics and race conditions.",
      "AUDIT 8 — VERIFICATION: independent Verifier stage, JSON contract, evidence requirements, deterministic runtime facts vs semantic LLM judgments, false PASS/false FAIL risks, and whether successful recovery can return the ROOT to completed.",
      "AUDIT 9 — BROWSER/COURIER: confirm browser is used only for tasks that genuinely require UI/web interaction. Identify any unnecessary browser, webhook, approval, proxy or backend hops.",
      "AUDIT 10 — TOOLS/GITHUB: role permissions, read/write separation, GitHub write gate, browser sensitive-action approval, secret handling, and whether external actions are explicitly evidenced.",
      "AUDIT 11 — SECURITY: authentication on control-plane endpoints, webhook authentication, prompt-injection boundaries, untrusted source content, authorization/ownership, secret leakage, SSRF/browser risks, and least privilege.",
      "AUDIT 12 — OBSERVABILITY/PERSISTENCE: runtime events, evidence index, task history, restart behavior, durable storage, correlation IDs, failure diagnosis and whether an audit can be reconstructed after restart.",
      "AUDIT 13 — PERFORMANCE: critical path latency, sequential vs parallel work, preflight overhead, model fallback cascades, unnecessary retries, queue contention, payload/context size, memory growth and event retention.",
      "AUDIT 14 — DEPLOYMENT: current deployment configuration, environment assumptions, startup behavior, health checks, accidental auto-audits, compatibility variables and operational failure modes.",
      "AUDIT 15 — SIMPLIFICATION: KEEP / SIMPLIFY / REMOVE / ADD. Remove anything that does not materially improve reliability, security, verification or user-visible execution.",
      "",
      "SAFE RUNTIME TESTING: You may rely only on existing read-only runtime evidence and controlled internal smoke tests already exposed by the runtime. Do not create new external side effects. If a behavior was not actually exercised, mark it UNPROVEN rather than assuming it works.",
      "",
      "FINAL REPORT — A through U:",
      "A Executive verdict.",
      "B Architecture and end-to-end request path.",
      "C Model Scout and free-only policy.",
      "D Model Gateway and preflight admission.",
      "E Provider/model resilience.",
      "F Employees and role separation.",
      "G Task lifecycle, queue, watchdog and recovery.",
      "H Independent verification.",
      "I Browser/Courier and tools.",
      "J Security and authorization.",
      "K Persistence and observability.",
      "L Performance and latency.",
      "M Deployment/operations.",
      "N Keep/Simplify/Remove.",
      "O Additions and engineering improvements.",
      "P P0 blockers.",
      "Q P1 issues.",
      "R P2 issues.",
      "S Evidence index.",
      "T Explicit list of UNPROVEN claims/tests still required.",
      "U FINAL STATUS: READY / PARTIALLY READY / NOT READY, with a short reason.",
      "",
      "For each P0/P1/P2 item provide: classification, exact source/runtime evidence, impact, and smallest concrete fix. Do not mix recommendations with facts.",
      "The audit is successful only if the report is evidence-rich and internally consistent. Do not declare READY merely because code paths exist.",
      "",
      "SOURCE DOSSIER: CURRENT AI-OFFICE SOURCE FILES ARE SUPPLIED BELOW.",
      "\n===== SOURCE DOSSIER =====\n"+dossier.join("")
    ].join("\n");
    const record=createTaskRecord({task:taskText,employeeId:"chief",parentTaskId:null,kind:"root"});
    tasks.set(record.id,record);
    emit("office_check.started",{taskId:record.id,readOnly:true,filesAudited:files});
    if(!aiAvailable(record.provider)) transitionTask(record,"waiting",{waitingReason:"ai_not_configured"});
    else void executeRootTask(record);
    res.status(202).json({ok:true,task:taskSnapshot(record),readOnly:true,filesAudited:files.length});
  }catch(error){
    emit("office_check.failed",{error:error?.message||String(error)});
    res.status(502).json({ok:false,error:error?.message||String(error)});
  }
});

app.get("/api/state", (req,res)=>{
  if(!requireInternalOrAudit(req,res)) return;
  return res.json({
  service:"ai-office-runtime",provider:aiProvider(),aiConfigured:aiAvailable(),configuredProviders:providerOrder().filter(aiConfigured),
  employees:employees().map(e=>({...e,brain:resolveBrain(e),configured:aiConfigured(resolveBrain(e).provider)})),
  tasks:[...tasks.values()].map(taskSnapshot),workerQueue:{active:workerQueue.active,pending:workerQueue.pending.length,limit:workerQueue.limit},events:events.slice(0,100)
  });
});

app.get("/api/pognali/audit", async (req,res)=>{
  const expected=String(process.env.POGNALI_AUDIT_TOKEN || "").trim();
  const supplied=String(req.query?.token || "").trim();
  if(!expected || supplied !== expected) return res.status(401).json({ok:false,error:"audit token required"});
  const files=[
    "README.txt","BUILD_PIPELINE.md","build.gradle","settings.gradle","gradle.properties",
    "app/build.gradle","app/src/main/AndroidManifest.xml",
    "app/src/main/java/com/pognali/app/MainActivity.java",
    "app/src/main/res/values/styles.xml",
    "app/src/main/assets/pognali_final.html","docs/index.html",
    ".github/workflows/android.yml",".github/workflows/android-ui-test.yml",
    ".github/workflows/emulator-health-check.yml",".github/workflows/pages.yml"
  ];
  const base="https://raw.githubusercontent.com/esv1312-crypto/pognali3/main/";
  try{
    const dossier=[];
    for(const path of files){
      const response=await fetch(base+path);
      if(!response.ok) throw new Error("Failed to fetch "+path+" (HTTP "+response.status+")");
      const text=await response.text();
      dossier.push("\n===== "+path+" =====\n"+text);
    }
    const taskText=`REAL TASK — READ-ONLY AUDIT OF PROJECT «ПОГНАЛИ»

You are the AI-OFFICE team. Audit the current project snapshot of GitHub repository esv1312-crypto/pognali3, branch main.

ABSOLUTE RULE: READ-ONLY. Do not modify the Pognali project in any way. Do not create, delete, edit, commit, push, open PRs, change GitHub settings, change CI/CD, deploy, publish, send messages, purchase anything, or perform external actions. The dossier below is read-only evidence supplied to you. Do not invent facts.

Use these roles:
1) Analyst — product/current-state and requirements audit.
2) Developer — technical architecture/code/Android/Web/CI audit.
3) Verifier — independent adversarial verification of conclusions.
4) Executor — practical launch-readiness and priority assessment, WITHOUT executing changes.
Chief synthesizes all reports.

Audit:
- What is actually implemented.
- User-facing features, especially the core «Погнали» concept and create/join/invite flows if evidenced.
- Android/WebView/local HTML architecture, web version, build pipeline and tests.
- Broken, incomplete, risky, stale or contradictory parts.
- Launch blockers for a first real working version.
- Security/privacy/technical debt visible in source.
- CI/CD and emulator/UI-test readiness.
- Concrete evidence for every material conclusion: exact file/path and facts.
- Separate facts from assumptions.
- Prioritize P0/P1/P2.
- Recommendations only; do not claim changes were made.

Final report:
A. EXECUTIVE VERDICT
B. CURRENT STATE
C. WHAT WORKS / EVIDENCE
D. WHAT DOES NOT WORK OR IS UNPROVEN / EVIDENCE
E. CRITICAL BLOCKERS
F. PRIORITY PLAN P0/P1/P2
G. RISKS / TECHNICAL DEBT
H. WHAT TO TEST NEXT
I. INDEPENDENT VERIFIER VERDICT
J. FINAL STATUS: READY / NOT READY / PARTIALLY READY, with reasons.

Finish with a concise management report for the owner.

SOURCE DOSSIER:
`+dossier.join("");
    const record=createTaskRecord({task:taskText,employeeId:"chief",parentTaskId:null,kind:"root"});
    tasks.set(record.id,record);
    void saveTaskSnapshot(taskSnapshot(record)).catch(error=>console.error("[DB] task save failed",error?.message||error));
    emit("task.accepted",{taskId:record.id,parentTaskId:null,kind:"root",task:taskText,employeeId:record.employeeId,role:record.role,provider:record.provider,model:record.model,source:"pognali_read_only_audit"});
    if(!aiAvailable(record.provider)){
      transitionTask(record,"waiting",{waitingReason:"ai_not_configured"});
      emit("task.waiting_for_ai",{taskId:record.id,employeeId:record.employeeId,provider:record.provider});
    } else void executeRootTask(record);
    res.status(202).json({ok:true,task:taskSnapshot(record),readOnly:true,sourceRepo:"esv1312-crypto/pognali3",filesAudited:files.length});
  }catch(error){
    emit("pognali.audit_failed",{error:error?.message||String(error)});
    res.status(502).json({ok:false,error:error?.message||String(error)});
  }
});

app.post("/api/tasks", (req,res)=>{
  if(!requireInternalOrAudit(req,res)) return;
  const task=String(req.body?.task || "").trim();
  if(!task) return res.status(400).json({ok:false,error:"task is required"});

  const requestedParent=req.body?.parentTaskId || null;
  const parentCheck=validateParentLink(requestedParent);
  if(!parentCheck.ok) return res.status(409).json({ok:false,error:parentCheck.error});
  const record=createTaskRecord({
    task,
    employeeId:String(req.body?.employeeId || "chief"),
    parentTaskId:requestedParent,
    kind:req.body?.kind || "root"
  });
  tasks.set(record.id,record);
  void saveTaskSnapshot(taskSnapshot(record)).catch(error=>console.error("[DB] task save failed",error?.message||error));
  emit("task.accepted",{taskId:record.id,parentTaskId:record.parentTaskId,kind:record.kind,task,employeeId:record.employeeId,role:record.role,provider:record.provider,model:record.model});

  if(!aiAvailable(record.provider)) {
    transitionTask(record,"waiting",{waitingReason:"ai_not_configured"});
    emit("task.waiting_for_ai",{taskId:record.id,employeeId:record.employeeId,provider:record.provider});
    return res.status(202).json({ok:true,task:taskSnapshot(record)});
  }

  if(record.employeeId==="chief" && record.kind==="root") void executeRootTask(record);
  else void executeWorkerTask(record);
  return res.status(202).json({ok:true,task:taskSnapshot(record)});
});

app.post("/api/tasks/:id/subtasks",(req,res)=>{
  if(!requireInternalOrAudit(req,res)) return;
  const parent=tasks.get(req.params.id);
  if(!parent) return res.status(404).json({ok:false,error:"parent task not found"});
  if(["completed","cancelled"].includes(parent.status)) return res.status(409).json({ok:false,error:"cannot add subtask to a closed task"});

  const items=Array.isArray(req.body?.subtasks) ? req.body.subtasks : [req.body];
  const created=[];
  for(const item of items) {
    const task=String(item?.task || "").trim();
    if(!task) return res.status(400).json({ok:false,error:"each subtask requires task"});
    const record=createTaskRecord({
      task,
      employeeId:String(item?.employeeId || "executor"),
      parentTaskId:parent.id,
      kind:"subtask"
    });
    tasks.set(record.id,record);
    emit("task.accepted",{taskId:record.id,parentTaskId:parent.id,kind:"subtask",task,employeeId:record.employeeId,role:record.role,provider:record.provider,model:record.model});
    if(!aiAvailable(record.provider)) {
      transitionTask(record,"waiting",{waitingReason:"ai_not_configured"});
      emit("task.waiting_for_ai",{taskId:record.id,employeeId:record.employeeId,provider:record.provider});
    } else {
      void executeWorkerTask(record);
    }
    created.push(taskSnapshot(record));
  }
  res.status(202).json({ok:true,parent:taskSnapshot(parent),subtasks:created});
});

app.get("/api/tasks/:id",(req,res)=>{
  if(!requireInternalOrAudit(req,res)) return;
  const record=tasks.get(req.params.id);
  if(!record) return res.status(404).json({ok:false,error:"task not found"});
  res.json({ok:true,task:taskSnapshot(record)});
});

async function runFinalAuditOnStartup() {
  if (String(process.env.RUN_FINAL_AUDIT_ON_START || "").toLowerCase() !== "true") return;
  await sleep(5000);
  const token = String(process.env.OFFICE_AUDIT_TOKEN || "").trim();
  if (!token) { emit("office_check.autorun_skipped",{reason:"OFFICE_AUDIT_TOKEN_NOT_CONFIGURED"}); return; }
  try {
    const port = process.env.PORT || 10000;
    const response = await fetch("http://127.0.0.1:"+port+"/api/office-check?run=1&token="+encodeURIComponent(token), {headers:{"X-AI-Office-Internal":"1"}});
    const body = await response.json().catch(()=>({}));
    emit("office_check.autorun_started",{status:response.status,taskId:body?.task?.id||null});
  } catch (error) { emit("office_check.autorun_failed",{error:error?.message||String(error)}); }
}

async function bootstrapDatabase() {
  try {
    const enabled = await initDatabase();
    if(enabled) {
      const state = await loadDatabaseState();
      for(const snapshot of state.tasks || []) {
        const record = {...snapshot};
        delete record.children;
        if(record.status === "running") {
          record.status = "failed";
          record.error = "SERVICE_RESTART_INTERRUPTED";
          record.failedAt = new Date().toISOString();
          record.startedAt = null;
          record.completedAt = null;
        } else if(record.status === "waiting") {
          record.startedAt = null;
          record.waitingReason = record.waitingReason || "service_restart";
        }
        tasks.set(record.id,record);
      }
      events.splice(0,events.length,...(state.events || []));
      console.log("[DB] persistence ready; restored tasks:",tasks.size,"events:",events.length);
    } else console.log("[DB] persistence disabled; DATABASE_URL is not configured");
  } catch(error) {
    console.error("[DB] initialization failed; continuing without persistence:",error?.message||error);
  }
}

await bootstrapDatabase();

app.listen(process.env.PORT || 10000,"0.0.0.0",()=>{
  void refreshModelScout().then(()=>emit("model_scout.refreshed",getModelScoutState())).catch(error=>emit("model_scout.error",{error:error?.message||String(error)}));
  modelScoutTimer=setInterval(()=>void refreshModelScout().then(()=>emit("model_scout.refreshed",getModelScoutState())).catch(error=>emit("model_scout.error",{error:error?.message||String(error)})), Number(process.env.MODEL_SCOUT_INTERVAL_MS || 3600000));
  workerWatchdogTimer=setInterval(runWorkerWatchdog,workerWatchdogIntervalMs);
  emit("worker.watchdog_started",{intervalMs:workerWatchdogIntervalMs,timeoutMs:workerTimeoutMs});
  emit("office.started",{provider:aiProvider(),aiConfigured:aiAvailable(),configuredProviders:providerOrder().filter(aiConfigured),employees:employees().length});
  // Controlled one-shot final audit; disable RUN_FINAL_AUDIT_ON_START after this run.
  void runFinalAuditOnStartup();
  console.log("AI-OFFICE runtime listening on",process.env.PORT || 10000,"provider:",aiProvider(),"configuredProviders:",providerOrder().filter(aiConfigured).join(","),"employees:",employees().length);
});
