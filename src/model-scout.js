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
  rolePools:{coordinator:[],developer:[],analyst:[],verifier:[],executor:[]},
  inactive:{openrouter:new Map(),huggingface:new Map()},
  errors:[]
};

function isZeroPrice(pricing){
  return pricing && Number(pricing.input) === 0 && Number(pricing.output) === 0;
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
  const data = await fetchJson("https://openrouter.ai/api/v1/models");
  const models = Array.isArray(data?.data) ? data.data : [];
  return models
    .filter(m => isZeroPrice(m?.pricing))
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
    const key=model.provider+":"+model.routeModel || model.provider+":"+model.id;
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
    state.providers.openrouter=results[0].status==="fulfilled" ? results[0].value : [];
    state.providers.huggingface=results[1].status==="fulfilled" ? results[1].value : [];
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
      total:dedupe([...state.providers.openrouter,...state.providers.huggingface]).length
    },
    rolePools:Object.fromEntries(Object.entries(state.rolePools).map(([role,pool])=>[role,pool])),
    errors:[...state.errors]
  };
}

export function getDynamicPool(employee){
  const role=String(employee?.role || "executor");
  const pool=state.rolePools[role] || [];
  return pool.map(x=>x.routeModel || x.id).filter(Boolean);
}
