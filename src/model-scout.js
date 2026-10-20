const ROLE_KEYWORDS = {
  coordinator:["orchestration","reasoning","agent","planning","coding"],
  developer:["code","coding","programming","agent","tool"],
  analyst:["reasoning","research","analysis","long context","document"],
  verifier:["reasoning","verification","coding","structured"],
  executor:["agent","tool","coding","fast","throughput"]
};

const state = {
  refreshedAt:null,
  refreshing:false,
  providers:{openrouter:[],huggingface:[],apinex:[]},
  catalog:{openrouter:new Map(),huggingface:new Map(),apinex:new Map()},
  rolePools:{coordinator:[],developer:[],analyst:[],verifier:[],executor:[]},
  inactive:{openrouter:new Map(),huggingface:new Map(),apinex:new Map()},
  errors:[],
  qualification:new Map()
};

export function isZeroPrice(pricing){
  if (!pricing || typeof pricing !== "object") return false;
  const input = pricing.input ?? pricing.prompt;
  const output = pricing.output ?? pricing.completion;
  if (input === undefined || input === null || output === undefined || output === null) return false;
  const inputPrice = Number(input);
  const outputPrice = Number(output);
  return Number.isFinite(inputPrice) && Number.isFinite(outputPrice)
    && inputPrice === 0 && outputPrice === 0;
}
function isFreeModelId(id=""){
  return String(id).endsWith(":free");
}

function isExpired(model){
  const raw = model?.expiration_date;
  if (!raw) return false;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) && ts <= Date.now();
}

export function isUsableFreeModel(model){
  if (!model?.id || isExpired(model)) return false;
  return isZeroPrice(model?.pricing) || isFreeModelId(model.id);
}

function roleScore(model, role){
  const hay = JSON.stringify(model).toLowerCase();
  let score = 0;
  for (const keyword of (ROLE_KEYWORDS[role] || [])) if (hay.includes(keyword)) score += 2;
  if (model.context_length >= 100000) score += 1;
  if (model.supports_tools) score += 3;
  if (model.supports_structured_output) score += 2;
  if (model.throughput && model.throughput > 50) score += 1;
  return score;
}

export async function fetchJson(url, options={}){
  const {fetchImpl=fetch, timeoutMs:requestedTimeout, ...requestOptions}=options;
  const configuredTimeout=Number(requestedTimeout ?? process.env.MODEL_CATALOG_TIMEOUT_MS ?? 10000);
  const timeoutMs=Number.isFinite(configuredTimeout)?Math.max(1000,configuredTimeout):10000;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response = await fetchImpl(url, { ...requestOptions, signal:controller.signal, headers: { "Accept":"application/json", ...(requestOptions.headers||{}) }});
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error((data?.error?.message || data?.error || ("HTTP "+response.status)));
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverOpenRouter(){
  const headers={};
  const key=String(process.env.OPENROUTER_API_KEY || "").trim();
  if(key) headers.Authorization="Bearer "+key;
  const data = await fetchJson("https://openrouter.ai/api/v1/models",{headers});
  const models = Array.isArray(data?.data) ? data.data : [];
  return models
    .filter(isUsableFreeModel)
    .filter(m => {
      const routeName=String(m?.id||"")+" "+String(m?.name||"");
      // Exclude known non-chat endpoints even if their catalog metadata also lists text.
      if (/(lyria|image|video|audio|tts|whisper|embed(?:ding)?|rerank|content.?safety|moderation)/i.test(routeName)) return false;
      const modalities=m?.architecture?.output_modalities;
      if(Array.isArray(modalities)) return modalities.includes("text");
      // If metadata is missing, retain only routes not identified as non-chat above.
      return true;
    })
    .map(m => ({
      provider:"openrouter",
      qualification:"discovered_unverified",
      id:m.id,
      name:m.name || m.id,
      context_length:Number(m.context_length||0),
      supports_tools:Array.isArray(m.supported_parameters) && m.supported_parameters.includes("tools"),
      supports_structured_output:Array.isArray(m.supported_parameters) && (m.supported_parameters.includes("structured_outputs") || m.supported_parameters.includes("response_format")),
      throughput:null,
      score:0,
      discoveredAt:new Date().toISOString()
    }));
}

async function discoverHuggingFace(){
  const token=String(process.env.HUGGINGFACE_API_KEY || "").trim();
  if(!token) return [];
  const data=await fetchJson("https://router.huggingface.co/v1/models", {
    headers:{Authorization:"Bearer "+token}
  });
  const models=Array.isArray(data?.data) ? data.data : [];
  const out=[];
  for(const m of models){
    const providers=Array.isArray(m?.providers) ? m.providers : [];
    for(const p of providers){
      if(p?.status !== "live") continue;
      const free = p?.is_free === true || isZeroPrice(p?.pricing);
      if(!free || isExpired(m) || isExpired(p)) continue;
      out.push({
        provider:"huggingface",
        qualification:"discovered_unverified",
        id:m.id,
        routeModel:m.id+":"+p.provider,
        providerId:p.provider,
        name:m.id,
        context_length:Number(p.context_length||m.context_length||0),
        supports_tools:Boolean(p.supports_tools),
        supports_structured_output:Boolean(p.supports_structured_output),
        throughput:Number(p.throughput||0),
        score:0,
        discoveredAt:new Date().toISOString()
      });
    }
  }
  return out;
}

export function normalizeApinexModels(data){
  const models=Array.isArray(data?.data) ? data.data : [];
  return models
    .filter(model => typeof model?.id === "string" && model.id.startsWith("free/") && !isExpired(model))
    .map(model => ({
      provider:"apinex",
      id:model.id,
      routeModel:model.id,
      name:model.name || model.id,
      context_length:Number(model.context_length || model.context_window || 0),
      supports_tools:Array.isArray(model.supported_parameters) && model.supported_parameters.includes("tools"),
      supports_structured_output:Array.isArray(model.supported_parameters) && (model.supported_parameters.includes("structured_outputs") || model.supported_parameters.includes("response_format")),
      throughput:null,
      score:0,
      discoveredAt:new Date().toISOString(),
      qualification:"discovered_unverified"
    }));
}

async function discoverApinex(){
  const token=String(process.env.APINEX_API_KEY || "").trim();
  if(!token) return [];
  const data=await fetchJson("https://api.apinex.bond/v1/models",{
    headers:{Authorization:"Bearer "+token}
  });
  return normalizeApinexModels(data);
}

function dedupe(models){
  const map=new Map();
  for(const model of models){
    const key=model.provider+":"+(model.routeModel || model.id);
    const existing=map.get(key);
    if(!existing || model.score > existing.score) map.set(key,model);
  }
  return [...map.values()];
}

export function isModelQualifiedForRole(model, role, qualifications=state.qualification, nowMs=Date.now()){
  const provider=String(model?.provider||"").trim().toLowerCase();
  const id=String(model?.routeModel||model?.id||"").trim();
  const entry=qualifications.get(provider+":"+id+":"+String(role||"").trim());
  return Boolean(entry && entry.status==="passed" && (!entry.expiresAt || Date.parse(entry.expiresAt)>nowMs));
}

function rankRoles(){
  const roles={};
  for(const role of Object.keys(ROLE_KEYWORDS)){
    // Discovery is not proof of reachability. Production role pools contain only
    // models that passed a live provider-specific preflight for this role.
    const all=dedupe(Object.values(state.providers).flat())
      .filter(m=>isModelQualifiedForRole(m,role))
      .map(m=>({...m,qualification:"passed",score:roleScore(m,role)}))
      .sort((a,b)=>b.score-a.score || b.context_length-a.context_length || b.throughput-a.throughput);
    roles[role]=all.slice(0,12);
  }
  state.rolePools=roles;
}

export function resolveProviderDiscovery(previousModels, result){
  if(result?.status==="fulfilled" && Array.isArray(result.value)){
    return {ok:true,models:result.value,error:null};
  }
  return {
    ok:false,
    models:Array.isArray(previousModels)?previousModels:[],
    error:result?.reason?.message || String(result?.reason || "provider discovery failed")
  };
}

export async function refreshModelScout(){
  if(state.refreshing) return getModelScoutState();
  state.refreshing=true;
  state.errors=[];
  try {
    const results=await Promise.allSettled([discoverOpenRouter(),discoverHuggingFace(),discoverApinex()]);
    const providers=["openrouter","huggingface","apinex"];
    for(let i=0;i<providers.length;i++){
      const provider=providers[i];
      const result=results[i];
      // A failed catalog request is not evidence that every previously known model disappeared.
      // Preserve the last successful provider snapshot and its routing pool on transient errors.
      const outcome=resolveProviderDiscovery(state.providers[provider],result);
      if(!outcome.ok){
        state.errors.push(provider+": "+outcome.error);
        continue;
      }
      const models=outcome.models;
      const seen=new Set(models.map(x=>x.routeModel || x.id));
      for(const model of models) state.catalog[provider].set(model.routeModel || model.id,model);
      for(const [key,model] of state.catalog[provider]){
        if(seen.has(key)) state.inactive[provider].delete(key);
        else state.inactive[provider].set(key,{...model,inactiveSince:model.inactiveSince || new Date().toISOString()});
      }
      state.providers[provider]=models;
    }
    rankRoles();
    state.refreshedAt=new Date().toISOString();
    return getModelScoutState();
  } finally {
    state.refreshing=false;
  }
}

const MAX_QUALIFICATION_RECORDS=100;
const ALLOWED_QUALIFICATION_ERRORS=new Set(["auth","quota","model_unavailable","rate_limited","timeout","invalid_response","provider_error"]);

export function recordModelQualification({provider,model,role,ok,latencyMs=null,errorCategory=null,transient=false,checkedAt=new Date().toISOString(),expiresAt=null}={}){
  const safeProvider=String(provider||"").trim().toLowerCase().slice(0,40);
  const safeModel=String(model||"").trim().slice(0,240);
  const safeRole=String(role||"").trim().slice(0,40);
  if(!safeProvider||!safeModel||!safeRole) return false;
  const key=safeProvider+":"+safeModel+":"+safeRole;
  const parsedTime=Date.parse(checkedAt);
  const checkedAtIso=Number.isFinite(parsedTime)?new Date(parsedTime).toISOString():new Date().toISOString();
  const expiry=Date.parse(expiresAt||"");
  const entry={
    provider:safeProvider,model:safeModel,role:safeRole,
    status:ok===true?"passed":"failed",
    checkedAt:checkedAtIso,
    latencyMs:Number.isFinite(Number(latencyMs))&&Number(latencyMs)>=0?Math.round(Number(latencyMs)):null,
    expiresAt:Number.isFinite(expiry)?new Date(expiry).toISOString():null,
    transient:Boolean(transient),
    errorCategory:ok===true?null:(ALLOWED_QUALIFICATION_ERRORS.has(errorCategory)?errorCategory:"provider_error")
  };
  state.qualification.delete(key);
  state.qualification.set(key,entry);
  while(state.qualification.size>MAX_QUALIFICATION_RECORDS){
    state.qualification.delete(state.qualification.keys().next().value);
  }
  // Immediately promote a successful probe (or remove a failed/expired one) from role pools.
  rankRoles();
  return true;
}

export function getModelScoutState(){
  return {
    refreshedAt:state.refreshedAt,
    refreshing:state.refreshing,
    freeOnly:true,
    counts:{
      openrouter:state.providers.openrouter.length,
      huggingface:state.providers.huggingface.length,
      apinex:state.providers.apinex.length,
      total:dedupe(Object.values(state.providers).flat()).length,
      inactiveOpenrouter:state.inactive.openrouter.size,
      inactiveHuggingface:state.inactive.huggingface.size
    },
    rolePools:Object.fromEntries(Object.entries(state.rolePools).map(([role,pool])=>[role,pool])),
    inactive:{
      openrouter:[...state.inactive.openrouter.values()].map(x=>({id:x.id,routeModel:x.routeModel||null,name:x.name,inactiveSince:x.inactiveSince})),
      huggingface:[...state.inactive.huggingface.values()].map(x=>({id:x.id,routeModel:x.routeModel||null,name:x.name,inactiveSince:x.inactiveSince})),
      apinex:[...state.inactive.apinex.values()].map(x=>({id:x.id,routeModel:x.routeModel||null,name:x.name,inactiveSince:x.inactiveSince}))
    },
    errors:[...state.errors],
    qualification:[...state.qualification.values()].sort((a,b)=>b.checkedAt.localeCompare(a.checkedAt)),
    qualificationSummary:{passed:[...state.qualification.values()].filter(x=>x.status==="passed").length,failed:[...state.qualification.values()].filter(x=>x.status==="failed").length,retained:state.qualification.size},
    policy:{
      freeDefinition:"explicit zero input/output pricing or a provider-documented free model identifier; APINEX is restricted to free/* IDs",
      expiredModelsExcluded:true,
      liveCapacity:"not guaranteed by catalog; discovered models are unverified until runtime probes pass"
    }
  };
}

export function getCandidatePool(employee, provider = null){
  const role=String(employee?.role || "executor");
  return dedupe(Object.values(state.providers).flat())
    .filter(model=>!provider || model.provider===provider)
    .map(model=>({...model,score:roleScore(model,role)}))
    .sort((a,b)=>b.score-a.score || b.context_length-a.context_length || b.throughput-a.throughput)
    .map(model=>model.routeModel || model.id)
    .filter(Boolean);
}

export function getDynamicPool(employee, provider = null){
  // Refresh expiry filtering on every read so stale preflight approvals are never routed.
  rankRoles();
  const role=String(employee?.role || "executor");
  const pool=state.rolePools[role] || [];
  return pool
    .filter(x => !provider || x.provider === provider)
    .map(x=>x.routeModel || x.id)
    .filter(Boolean);
}


const TASK_RULES = [
  ["video", /video|ролик|анимац|монтаж/i],
  ["visual", /чертеж|чертёж|cad|3d|архитект|diagram|диаграм/i],
  ["coding", /приложен|app|код|code|program|программ|github|debug|bug|deploy/i],
  ["verification", /проверь|тест|verify|audit|аудит|review|ревью/i],
  ["text", /текст|письм|стать|перевод|rewrite|copy|контент/i],
  ["analysis", /анализ|исслед|research|сравн|аналит/i]
];
const TASK_CAPABILITIES = {
  coding:["code","coding","program","developer","agent","terminal"],
  verification:["reasoning","verify","verification","audit","testing"],
  text:["writing","text","language","instruction"],
  analysis:["reasoning","research","analysis","long context"],
  visual:["vision","image","multimodal","diagram"],
  video:["video","multimodal","generation"],
  general:["reasoning","agent","general"]
};
function classifyTask(task=""){
  const s=String(task);
  for(const [kind,re] of TASK_RULES) if(re.test(s)) return kind;
  return "general";
}
function scoreForTask(model,kind){
  const hay=JSON.stringify(model).toLowerCase();
  let score=Number(model.score||0);
  for(const word of (TASK_CAPABILITIES[kind]||[])) if(hay.includes(word)) score+=4;
  if(model.supports_tools && (kind==="coding" || kind==="verification")) score+=5;
  if(model.context_length>=100000 && (kind==="analysis" || kind==="text")) score+=3;
  return score;
}
export function selectModelForTask(task,employee){
  const kind=classifyTask(task);
  const role=String(employee?.role||"executor");
  const pool=state.rolePools[role]||[];
  const ranked=pool.map(m=>({...m,taskKind:kind,taskScore:scoreForTask(m,kind)}))
    .sort((a,b)=>b.taskScore-a.taskScore||b.context_length-a.context_length||b.throughput-b.throughput);
  return {kind,selected:ranked[0]||null,candidates:ranked.slice(0,8)};
}
