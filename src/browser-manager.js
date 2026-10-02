const SENSITIVE_ACTIONS = new Set(["signup","login","create_key","connect_account","billing","purchase","delete","send","write"]);
const SAFE_ACTIONS = new Set(["research","read","docs","pricing","status"]);

function randomToken() {
  return crypto.randomUUID().replaceAll("-", "");
}

export function createBrowserManager({emit}) {
  const requests = new Map();
  const freeOnly = () => String(process.env.AI_FREE_ONLY ?? "true").toLowerCase() !== "false";

  function request({taskId=null,url="",goal="",actionClass="research"}) {
    if (!url) throw Object.assign(new Error("browser.request requires url"), {code:"BROWSER_INVALID"});
    if (!goal) throw Object.assign(new Error("browser.request requires goal"), {code:"BROWSER_INVALID"});
    const action=String(actionClass || "research").toLowerCase();
    if (!SAFE_ACTIONS.has(action) && !SENSITIVE_ACTIONS.has(action)) {
      throw Object.assign(new Error("Unsupported browser action class: " + action), {code:"BROWSER_POLICY_DENIED"});
    }
    if (freeOnly() && /billing|purchase|upgrade|paid/i.test(goal + " " + action)) {
      throw Object.assign(new Error("Paid browser action is blocked by FREE_ONLY policy"), {code:"BROWSER_POLICY_DENIED"});
    }

    const id=crypto.randomUUID();
    const needsApproval=SENSITIVE_ACTIONS.has(action);
    const approvalToken=needsApproval ? randomToken() : null;
    const record={
      id,taskId,url,goal,actionClass:action,
      status:needsApproval ? "waiting_approval" : "queued",
      requiresApproval:needsApproval,
      approvalToken,
      createdAt:new Date().toISOString(),
      approvedAt:null,
      startedAt:null,
      completedAt:null,
      result:null,
      error:null
    };
    requests.set(id,record);
    emit("browser.requested",{
      requestId:id,taskId,url,goal,actionClass:action,
      requiresApproval:needsApproval,status:record.status
    });
    if (needsApproval) {
      emit("approval.requested",{
        requestId:id,taskId,url,goal,actionClass:action,
        approvalRequired:true,
        approvalToken
      });
    } else {
      emit("browser.queued",{requestId:id,taskId,url,goal,actionClass:action});
    }
    return publicRecord(record);
  }

  function approve(id,token) {
    const record=requests.get(id);
    if (!record) throw Object.assign(new Error("Browser request not found"), {code:"BROWSER_NOT_FOUND"});
    if (record.status !== "waiting_approval") {
      return publicRecord(record);
    }
    if (!token || token !== record.approvalToken) {
      throw Object.assign(new Error("Valid human approval token is required"), {code:"BROWSER_APPROVAL_REQUIRED"});
    }
    record.approvedAt=new Date().toISOString();
    record.status="queued";
    emit("approval.granted",{requestId:id,taskId:record.taskId,actionClass:record.actionClass});
    emit("browser.queued",{requestId:id,taskId:record.taskId,actionClass:record.actionClass});
    return publicRecord(record);
  }

  function status(id) {
    const record=requests.get(id);
    return record ? publicRecord(record) : null;
  }

  function summary() {
    const all=[...requests.values()];
    return {
      manager:"browser-manager",
      enabled:true,
      backendConfigured:Boolean(process.env.BROWSER_AUTOMATION_BASE_URL),
      backend:"external-browser-bridge",
      freeOnly:freeOnly(),
      approvalPolicy:"sensitive actions require explicit human approval",
      pendingApproval:all.filter(x=>x.status==="waiting_approval").length,
      queued:all.filter(x=>x.status==="queued").length,
      active:all.filter(x=>x.status==="running").length,
      completed:all.filter(x=>x.status==="completed").length,
      failed:all.filter(x=>x.status==="failed").length,
      nextAction:process.env.BROWSER_AUTOMATION_BASE_URL
        ? "Connect the external browser bridge"
        : "Configure BROWSER_AUTOMATION_BASE_URL for live browser execution"
    };
  }

  function publicRecord(record) {
    return {
      ...record,
      approvalToken: record.status==="waiting_approval" ? record.approvalToken : undefined
    };
  }

  return {request,approve,status,summary};
}
