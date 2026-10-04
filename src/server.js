import express from "express";
import OpenAI from "openai";
import { inspectFreeProviders } from "./free-ai-resource-manager.js";
import { createBrowserManager } from "./browser-manager.js";
import { refreshModelScout, getModelScoutState, getDynamicPool } from "./model-scout.js";

const app = express();
app.use(express.json({limit:"1mb"}));

const startedAt = new Date().toISOString();
const events = [];
const tasks = new Map();
const browserRequests = new Map();
const browserRuns = new Map();
const browser = createBrowserManager({emit});
let modelScoutTimer = null;

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
  return event;
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
  const order=providerOrder();
  const first=String(preferred || "").toLowerCase();
  const candidates=first && first !== "auto" ? [first,...order] : order;
  return [...new Set(candidates)].filter(p=>aiConfigured(p));
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

function resolveBrain(employee) {
  return {
    provider: String(employee?.provider || process.env.AI_PROVIDER || aiProvider()).toLowerCase(),
    model: employee?.model || null
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
        emit("ai.error",{provider:"gemini",model,attempt:attempt+1,error:error?.message||String(error),transient:Boolean(error?.transient)});
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

async function callOpenAICompatible({provider,baseUrl,apiKey,model,task,headers={}}) {
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
        ]
      })
    });
    const data=await response.json().catch(()=>({}));
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

function openRouterPool(employee) {
  const role=String(employee?.role || "executor");
  let pool=OPENROUTER_MODEL_POOLS[role] || OPENROUTER_MODEL_POOLS.executor;
  const dynamic=getDynamicPool(employee).filter(x => x && !x.includes(":"));
  if(dynamic.length) pool=[...dynamic,...pool];
  try {
    const custom=JSON.parse(process.env.OPENROUTER_MODEL_POOLS_JSON || "null");
    if (custom && Array.isArray(custom[role]) && custom[role].length) pool=custom[role];
  } catch (_) {}
  const preferred=employee?.model || process.env.OPENROUTER_MODEL;
  if (preferred) pool=[preferred,...pool];
  return [...new Set(pool.filter(Boolean))];
}

async function generateWithOpenRouter(task, employee, preferredModel) {
  const pool=openRouterPool(employee);
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
      if (i<ordered.length-1) {
        emit("gateway.model_fallback",{employeeId:employee?.id || null,role,from:model,to:ordered[i+1],reason:error?.message || String(error)});
      }
    }
  }
  throw lastError || new Error("All OpenRouter free models failed");
}

async function generateWithHuggingFace(task, employee, preferredModel) {
  const token=String(process.env.HUGGINGFACE_API_KEY || "").trim();
  if(!token) throw Object.assign(new Error("Hugging Face API key is not configured"),{code:"HF_NOT_CONFIGURED"});
  const dynamic=getDynamicPool(employee).filter(model => model.includes("/"));
  const configured=(process.env.HUGGINGFACE_MODELS || "").split(",").map(x=>x.trim()).filter(Boolean);
  const pool=[preferredModel,...dynamic,...configured].filter(Boolean);
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
        model: model.includes(":") ? model : model+":fastest",
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

async function generateViaGateway(task, employee) {
  const brain=resolveBrain(employee);
  const providers=gatewayProviders(brain.provider);
  if(!providers.length) {
    const e=new Error("No configured AI provider is available in FREE_ONLY="+freeOnly());
    e.code="AI_NOT_CONFIGURED";
    throw e;
  }
  let lastError;
  for(const provider of providers) {
    const model=provider==="gemini" ? brain.model
      : provider==="huggingface" ? brain.model
      : provider==="openrouter" ? (brain.model || openRouterModel())
      : provider==="cloudflare" ? (brain.model || process.env.CLOUDFLARE_MODEL || null)
      : (process.env.OPENAI_MODEL || null);
    emit("gateway.route",{employeeId:employee.id,role:employee.role,provider,model,freeOnly:freeOnly()});
    try {
      let result;
      if(provider==="gemini") result=await generateWithGemini(task,model);
      else if(provider==="huggingface") result=await generateWithHuggingFace(task,employee,model);
      else if(provider==="openrouter") result=await generateWithOpenRouter(task,employee,model);
      else if(provider==="cloudflare") result=await generateWithCloudflare(task,model);
      else if(provider==="openai") {
        if(freeOnly()) throw Object.assign(new Error("Paid OpenAI is blocked by FREE_ONLY policy"),{code:"PAID_PROVIDER_BLOCKED"});
        result=await generateWithOpenAI(task,model);
      } else throw new Error("Unsupported AI provider: "+provider);
      emit("gateway.success",{employeeId:employee.id,provider,model:result.model,freeOnly:freeOnly()});
      return result;
    } catch(error) {
      lastError=error;
      emit("gateway.provider_failed",{employeeId:employee.id,provider,error:error?.message||String(error),transient:Boolean(error?.transient),freeOnly:freeOnly()});
      emit("gateway.fallback",{from:provider,to:providers[providers.indexOf(provider)+1] || null,reason:error?.message||String(error)});
    }
  }
  throw lastError || new Error("All configured AI providers failed");
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

async function executeWorkerTask(record) {
  try {
    transitionTask(record,"running",{startedAt:new Date().toISOString(),attempts:Number(record.attempts || 0)+1});
    const employee=getEmployee(record.employeeId);
    record.employeeId=employee.id;
    record.employee=employee.name;
    record.role=employee.role;
    record.provider=resolveBrain(employee).provider;
    record.model=resolveBrain(employee).model;
    emit("task.started",{taskId:record.id,employeeId:employee.id,role:employee.role,provider:record.provider,model:record.model});

    const result=await generateViaGateway(record.task,employee);

    record.model=result.model;
    transitionTask(record,"completed",{result:result.text,completedAt:new Date().toISOString()});
    emit("task.completed",{taskId:record.id,employeeId:employee.id,provider:record.provider,model:record.model});
    return result.text;
  } catch(error) {
    const message=error?.message || String(error);
    transitionTask(record,"failed",{error:message,failedAt:new Date().toISOString()});
    emit("task.failed",{taskId:record.id,employeeId:record.employeeId,provider:record.provider,error:message});
    return null;
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

function buildVerificationPrompt({task, checklist, workerResults}) {
  return [
    "You are the Verification specialist inside AI-OFFICE.",
    "Verify the worker results against the original task and checklist.",
    "Return ONLY valid JSON, no markdown.",
    'Schema: {"status":"PASS|FAIL","checks":[{"name":"string","passed":true,"evidence":"string"}],"summary":"string"}',
    "PASS only when the available evidence supports every required check.",
    "Do not invent evidence and do not treat an AI claim as proof of an external action.",
    "Original task: " + task,
    "Checklist: " + JSON.stringify(checklist || []),
    "Worker results: " + JSON.stringify(workerResults || [])
  ].join("\\n");
}

async function verifyRootTask(record) {
  const verifier=getEmployee("verifier");
  const checklist=Array.isArray(record.verificationChecklist) ? record.verificationChecklist : [];
  emit("verification.requested",{taskId:record.id,employeeId:verifier.id,checkCount:checklist.length});
  const result=await generateViaGateway(buildVerificationPrompt({
    task:record.task,
    checklist,
    workerResults:record.workerResults
  }),verifier);
  const verification=parseVerificationJson(result.text);
  if(!verification || !["PASS","FAIL"].includes(verification.status) || !Array.isArray(verification.checks)) {
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
      "Fix the failure below. Work only with capabilities actually available to this runtime.",
      "Do not claim an external action happened unless you actually performed it.",
      "Original task: " + record.task,
      "Failure class: " + failureClass.type,
      "Failed checks: " + failedChecks,
      "Failure reason: " + failureClass.reason,
      "Worker results: " + JSON.stringify(record.workerResults || []),
      "Produce a concrete fix/retest action or explain precisely what blocks it."
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
    const plan=parsePlannerJson(planResult.text);

    if(!plan || !Array.isArray(plan.subtasks) || plan.subtasks.length===0) {
      throw new Error("Chief returned invalid delegation plan");
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

    const verificationPassed=await verifyRootTask(record);
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
  browser:{configured:browserConfigured(),automationEnabled:browserAutomationEnabled(),requiresApproval:browserApprovalRequired()}
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

app.get("/api/state", (_req,res)=>res.json({
  service:"ai-office-runtime",provider:aiProvider(),aiConfigured:aiAvailable(),configuredProviders:providerOrder().filter(aiConfigured),
  employees:employees().map(e=>({...e,brain:resolveBrain(e),configured:aiConfigured(resolveBrain(e).provider)})),
  tasks:[...tasks.values()].map(taskSnapshot),events:events.slice(0,100)
}));

app.post("/api/tasks", (req,res)=>{
  const task=String(req.body?.task || "").trim();
  if(!task) return res.status(400).json({ok:false,error:"task is required"});

  const record=createTaskRecord({
    task,
    employeeId:String(req.body?.employeeId || "chief"),
    parentTaskId:req.body?.parentTaskId || null,
    kind:req.body?.kind || "root"
  });
  tasks.set(record.id,record);
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
  const record=tasks.get(req.params.id);
  if(!record) return res.status(404).json({ok:false,error:"task not found"});
  res.json({ok:true,task:taskSnapshot(record)});
});

app.listen(process.env.PORT || 10000,"0.0.0.0",()=>{
  void refreshModelScout().then(()=>emit("model_scout.refreshed",getModelScoutState())).catch(error=>emit("model_scout.error",{error:error?.message||String(error)}));
  modelScoutTimer=setInterval(()=>void refreshModelScout().then(()=>emit("model_scout.refreshed",getModelScoutState())).catch(error=>emit("model_scout.error",{error:error?.message||String(error)})), Number(process.env.MODEL_SCOUT_INTERVAL_MS || 3600000));
  emit("office.started",{provider:aiProvider(),aiConfigured:aiAvailable(),configuredProviders:providerOrder().filter(aiConfigured),employees:employees().length});
  console.log("AI-OFFICE runtime listening on",process.env.PORT || 10000,"provider:",aiProvider(),"configuredProviders:",providerOrder().filter(aiConfigured).join(","),"employees:",employees().length);
});
