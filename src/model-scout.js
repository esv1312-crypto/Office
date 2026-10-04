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
  providers:{openrouter:[],huggingface:[]},
  catalog:{openrouter:new Map(),huggingface:new Map()},
  rolePools:{coordinator:[],developer:[],analyst:[],verifier:[],executor:[]},
  inactive:{openrouter:new Map(),huggingface:new Map()},
  errors:[]
};

function isZeroPrice(pricing){
  if (!pricing) return false;
  const input = pricing.input ?? pricing.prompt;
  const output = pricing.output ?? pricing.completion;
  return Number(input) === 0 && Number(output) === 0;
}
function isFreeModelId(id=""){
  return String(id).endsWith(":free");
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

async function fetchJson(url, options={}){
  const response = await fetch(url, { ...options, headers: { "Accept":"application/json", ...(options.headers||{}) }});
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error((data?.error?.message || data?.error || ("HTTP "+response.status)));
  return data;
}

async function discoverOpenRouter(){
  const headers={};
  const key=String(process.env.OPENROUTER_API_KEY || "").trim();
  if(key) headers.Authorization="Bearer "+key;
  const data = await fetchJson("https://openrouter.ai/api/v1/models",{headers});
  const models = Array.isArray(data?.data) ? data.data : [];
  return models
    .filter(m => isZeroPrice(m?.pricing) || isFreeModelId(m?.id))
    .filter(m => (m?.architecture?.output_modalities || ["text"]).includes("text"))
    .map(m => ({
      provider:"openrouter",
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
      if(!free) continue;
      out.push({
        provider:"huggingface",
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

function dedupe(models){
  const map=new Map();
  for(const model of models){
    const key=model.provider+":"+(model.routeModel || model.id);
    const existing=map.get(key);
    if(!existing || model.score > existing.score) map.set(key,model);
  }
  return [...map.values()];
}

function rankRoles(){
  const roles={};
  for(const role of Object.keys(ROLE_KEYWORDS)){
    const all=dedupe([...state.providers.openrouter,...state.providers.huggingface])
      .map(m=>({...m,score:roleScore(m,role)}))
      .sort((a,b)=>b.score-a.score || b.context_length-a.context_length || b.throughput-a.throughput);
    roles[role]=all.slice(0,12);
  }
  state.rolePools=roles;
}

export async function refreshModelScout(){
  if(state.refreshing) return getModelScoutState();
  state.refreshing=true;
  state.errors=[];
  try {
    const results=await Promise.allSettled([discoverOpenRouter(),discoverHuggingFace()]);
    const discovered={
      openrouter:results[0].status==="fulfilled" ? results[0].value : [],
      huggingface:results[1].status==="fulfilled" ? results[1].value : []
    };
    for(const provider of Object.keys(discovered)){
      const seen=new Set(discovered[provider].map(x=>x.routeModel || x.id));
      for(const model of discovered[provider]) state.catalog[provider].set(model.routeModel || model.id,model);
      for(const [key,model] of state.catalog[provider]){
        if(seen.has(key)) state.inactive[provider].delete(key);
        else state.inactive[provider].set(key,{...model,inactiveSince:model.inactiveSince || new Date().toISOString()});
      }
      state.providers[provider]=discovered[provider];
    }
    for(const result of results){
      if(result.status==="rejected") state.errors.push(result.reason?.message || String(result.reason));
    }
    rankRoles();
    state.refreshedAt=new Date().toISOString();
    return getModelScoutState();
  } finally {
    state.refreshing=false;
  }
}

export function getModelScoutState(){
  return {
    refreshedAt:state.refreshedAt,
    refreshing:state.refreshing,
    freeOnly:true,
    counts:{
      openrouter:state.providers.openrouter.length,
      huggingface:state.providers.huggingface.length,
      total:dedupe([...state.providers.openrouter,...state.providers.huggingface]).length,
      inactiveOpenrouter:state.inactive.openrouter.size,
      inactiveHuggingface:state.inactive.huggingface.size
    },
    rolePools:Object.fromEntries(Object.entries(state.rolePools).map(([role,pool])=>[role,pool])),
    inactive:{
      openrouter:[...state.inactive.openrouter.values()].map(x=>({id:x.id,routeModel:x.routeModel||null,name:x.name,inactiveSince:x.inactiveSince})),
      huggingface:[...state.inactive.huggingface.values()].map(x=>({id:x.id,routeModel:x.routeModel||null,name:x.name,inactiveSince:x.inactiveSince}))
    },
    errors:[...state.errors]
  };
}

export function getDynamicPool(employee){
  const role=String(employee?.role || "executor");
  const pool=state.rolePools[role] || [];
  return pool.map(x=>x.routeModel || x.id).filter(Boolean);
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
