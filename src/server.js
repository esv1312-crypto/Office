import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json({limit:"1mb"}));

const startedAt = new Date().toISOString();
const events = [];
const tasks = new Map();

function emit(type, data = {}) {
  const event = { id: events.length + 1, ts: new Date().toISOString(), type, ...data };
  events.unshift(event);
  if (events.length > 500) events.pop();
  return event;
}

function aiProvider() {
  return (process.env.AI_PROVIDER || (process.env.OPENAI_API_KEY ? "openai" : "none")).toLowerCase();
}

function aiConfigured() {
  const provider = aiProvider();
  if (provider === "gemini") return Boolean(process.env.GEMINI_API_KEY);
  if (provider === "openai") return Boolean(process.env.OPENAI_API_KEY);
  return false;
}

async function generateWithGemini(task) {
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({
      systemInstruction: {
        parts: [{text:"You are the execution brain of AI-OFFICE. Analyze the task, produce a concise execution plan and verification checklist. Do not claim external actions were completed unless this runtime actually performed them."}]
      },
      contents: [{role:"user", parts:[{text:task}]}]
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Gemini HTTP ${response.status}`);
  }
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map(part => part.text || "")
    .join("")
    .trim();
  if (!text) throw new Error("Gemini returned an empty response");
  return {text, model};
}

async function generateWithOpenAI(task) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || "gpt-6-luna";
  const response = await client.responses.create({
    model,
    input: [
      {role:"system", content:"You are the execution brain of AI-OFFICE. Analyze the task, produce a concise execution plan and verification checklist. Do not claim external actions were completed unless this runtime actually performed them."},
      {role:"user", content:task}
    ]
  });
  return {text: response.output_text || "", model};
}

app.get("/", (_req,res) => res.json({
  service:"ai-office-runtime",
  status:"online",
  provider: aiProvider(),
  mode: aiConfigured() ? "ai" : "control-plane",
  startedAt,
  tasks: tasks.size,
  events: events.length
}));

app.get("/health", (_req,res) => res.json({
  ok:true,
  service:"ai-office-runtime",
  provider: aiProvider(),
  aiConfigured:aiConfigured(),
  startedAt
}));

app.get("/api/state", (_req,res) => res.json({
  service:"ai-office-runtime",
  provider: aiProvider(),
  aiConfigured:aiConfigured(),
  tasks:[...tasks.values()],
  events:events.slice(0,100)
}));

app.post("/api/tasks", async (req,res) => {
  const task = String(req.body?.task || "").trim();
  if (!task) return res.status(400).json({ok:false,error:"task is required"});

  const id = crypto.randomUUID();
  const record = {id, task, status:"accepted", createdAt:new Date().toISOString(), provider:aiProvider()};
  tasks.set(id, record);
  emit("task.accepted",{taskId:id,task,provider:record.provider});

  if (!aiConfigured()) {
    record.status = "waiting_for_ai";
    emit("task.waiting_for_ai",{taskId:id,provider:record.provider});
    return res.status(202).json({ok:true,task:record});
  }

  try {
    record.status = "running";
    emit("task.started",{taskId:id,provider:record.provider});
    const result = record.provider === "gemini"
      ? await generateWithGemini(task)
      : await generateWithOpenAI(task);
    record.model = result.model;
    record.status = "completed";
    record.result = result.text;
    record.completedAt = new Date().toISOString();
    emit("task.completed",{taskId:id,provider:record.provider,model:record.model});
    res.json({ok:true,task:record});
  } catch (error) {
    record.status = "failed";
    record.error = error?.message || String(error);
    emit("task.failed",{taskId:id,provider:record.provider,error:record.error});
    res.status(500).json({ok:false,task:record});
  }
});

app.listen(process.env.PORT || 10000, "0.0.0.0", () => {
  emit("office.started",{provider:aiProvider(),aiConfigured:aiConfigured()});
  console.log("AI-OFFICE runtime listening on", process.env.PORT || 10000, "provider:", aiProvider());
});
