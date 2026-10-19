const SENSITIVE_ACTIONS = new Set(["signup","login","create_key","connect_account","billing","purchase","delete","send","write"]);
const SAFE_ACTIONS = new Set(["research","read","docs","pricing","status"]);

export function createBrowserManager({emit}) {
  const requests=new Map();
  const freeOnly=()=>String(process.env.AI_FREE_ONLY ?? "true").toLowerCase() !== "false";
  const key=()=>process.env["TINY"+"FISH_API_KEY"];
  const enabled=()=>String(process.env.BROWSER_AUTOMATION_ENABLED || "false").toLowerCase()==="true";
  const publicUrl=()=>String(process.env.OFFICE_PUBLIC_URL || "https://ai-office-runtime-8pir.onrender.com").replace(/\/+$/,"");
  const auditUrl=(raw)=>{ try { return new URL(String(raw||"")).origin; } catch (_) { return "[invalid-url]"; } };

  async function call(path,body){
    if(!key()) throw Object.assign(new Error("browser backend is not configured"),{code:"BROWSER_NOT_CONFIGURED"});
    const r=await fetch("https://agent.tinyfish.ai"+path,{
      method:"POST",
      headers:{"Content-Type":"application/json","X-API-Key":key()},
      body:JSON.stringify(body)
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d?.error?.message || d?.message || ("browser backend HTTP "+r.status));
    return d;
  }

  function pub(r){ const {webhookToken,...safe}=r; return {...safe}; }

  async function start(r){
    if(!enabled()){ r.status="blocked"; r.error="Browser automation disabled by policy"; r.completedAt=new Date().toISOString(); emit("browser.blocked",{requestId:r.id,reason:r.error}); return pub(r); }
    if(!key()){ r.status="blocked"; r.error="Browser backend is not configured"; r.completedAt=new Date().toISOString(); emit("browser.blocked",{requestId:r.id,reason:r.error}); return pub(r); }
    r.status="running"; r.startedAt=new Date().toISOString();
    try{
      const callback=publicUrl()+"/api/browser/webhook?token="+encodeURIComponent(r.webhookToken);
      const d=await call("/v1/automation/run-async",{url:r.url,goal:r.goal,webhook_url:callback});
      r.runId=d?.run_id || d?.runId || null;
      emit("browser.started",{requestId:r.id,runId:r.runId,url:auditUrl(r.url)});
    }catch(e){
      const token=r.webhookToken;
      const rawError=e?.message||String(e);
      r.error=token?String(rawError).split(token).join("[redacted]"):String(rawError);
      r.webhookToken=null;
      r.status="failed"; r.completedAt=new Date().toISOString();
      emit("browser.failed",{requestId:r.id,error:r.error});
    }
    return pub(r);
  }

  async function request({taskId=null,url="",goal="",actionClass="research"}){
    if(!url || !goal) throw Object.assign(new Error("url and goal are required"),{code:"BROWSER_INVALID"});
    const action=String(actionClass||"research").toLowerCase();
    if(!SAFE_ACTIONS.has(action)&&!SENSITIVE_ACTIONS.has(action)) throw Object.assign(new Error("unsupported browser action"),{code:"BROWSER_POLICY_DENIED"});
    if(freeOnly() && /billing|purchase|upgrade|paid/i.test(goal+" "+action)) throw Object.assign(new Error("paid browser action blocked by FREE_ONLY policy"),{code:"BROWSER_POLICY_DENIED"});
    const needs=SENSITIVE_ACTIONS.has(action);
    const r={id:crypto.randomUUID(),taskId,url,goal,actionClass:action,status:needs?"waiting_approval":"queued",requiresApproval:needs,createdAt:new Date().toISOString(),approvedAt:null,startedAt:null,completedAt:null,runId:null,webhookToken:crypto.randomUUID(),result:null,error:null};
    requests.set(r.id,r);
    emit("browser.requested",{requestId:r.id,taskId,url:auditUrl(url),goal:"[redacted]",goalLength:goal.length,actionClass:action,requiresApproval:needs,status:r.status});
    if(needs){ emit("approval.requested",{requestId:r.id,taskId,url:auditUrl(url),goal:"[redacted]",goalLength:goal.length,actionClass:action,approvalRequired:true}); return pub(r); }
    emit("browser.queued",{requestId:r.id,taskId,url:auditUrl(url),goal:"[redacted]",goalLength:goal.length,actionClass:action});
    // Never leave a request queued forever when execution is disabled or credentials are missing.
    return start(r);
  }

  async function approveAuthorized(id){
    const r=requests.get(id);
    if(!r) throw Object.assign(new Error("browser request not found"),{code:"BROWSER_NOT_FOUND"});
    if(r.status!=="waiting_approval") return pub(r);
    r.approvedAt=new Date().toISOString();
    emit("approval.granted",{requestId:id,taskId:r.taskId,actionClass:r.actionClass,source:"authenticated_control_plane"});
    return start(r);
  }

  function webhook(payload={}, suppliedToken=""){
    const token=String(suppliedToken||"");
    const r=[...requests.values()].find(x=>x.webhookToken && x.webhookToken===token);
    if(!r) return {matched:false,authenticated:false};
    const runId=String(payload.run_id||payload.data?.run_id||"");
    if(!runId || (r.runId && r.runId!==runId)) return {matched:false,authenticated:false};
    r.runId=runId;
    r.webhookToken=null;
    r.status=String(payload.status||payload.data?.status||"UNKNOWN").toLowerCase();
    r.completedAt=new Date().toISOString();
    r.result=payload.data?.result??payload.result??null;
    r.error=payload.data?.error?.message||payload.error?.message||null;
    emit("browser.completed",{requestId:r.id,runId,status:r.status,error:r.error});
    return {matched:true,authenticated:true,requestId:r.id,status:r.status};
  }

  function status(id){ const r=requests.get(id); return r?pub(r):null; }

  function summary(){
    const a=[...requests.values()];
    return {
      manager:"browser-manager",
      enabled:Boolean(enabled() && key()),
      managerLoaded:true,
      backendConfigured:Boolean(key()),
      backend:key()?"tinyfish":"external-browser-bridge",
      automationEnabled:enabled(),
      freeOnly:freeOnly(),
      approvalPolicy:"sensitive actions require explicit human approval",
      pendingApproval:a.filter(x=>x.status==="waiting_approval").length,
      queued:a.filter(x=>x.status==="queued").length,
      active:a.filter(x=>x.status==="running").length,
      completed:a.filter(x=>x.status==="completed").length,
      failed:a.filter(x=>x.status==="failed"||x.status==="blocked").length,
      nextAction:!key()?"Configure browser backend credentials":!enabled()?"Enable browser automation only after confirming spending policy":"Browser execution is live"
    };
  }
  return {request,approveAuthorized,status,summary,webhook};
}
