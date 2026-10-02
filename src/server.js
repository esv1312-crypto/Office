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

function aiClient() {
  const key = process.env.OPENAI_API_KEY;
  return key ? new OpenAI({ apiKey: key }) : null;
}

app.get("/", (_req,res) => res.json({
  service:"ai-office-runtime",
  status:"online",
  mode: process.env.OPENAI_API_KEY ? "ai" : "control-plane",
  startedAt,
  tasks: tasks.size,
  events: events.length
}));

app.get("/health", (_req,res) => res.json({
  ok:true,
  service:"ai-office-runtime",
  aiConfigured:Boolean(process.env.OPENAI_API_KEY),
  startedAt
}));

app.get("/api/state", (_req,res) => res.json({
  service:"ai-office-runtime",
  aiConfigured:Boolean(process.env.OPENAI_API_KEY),
  tasks:[...tasks.values()],
  events:events.slice(0,100)
}));

app.post("/api/tasks", async (req,res) => {
  const task = String(req.body?.task || "").trim();
  if (!task) return res.status(400).json({ok:false,error:"task is required"});

  const id = crypto.randomUUID();
  const record = {id, task, status:"accepted", createdAt:new Date().toISOString()};
  tasks.set(id, record);
  emit("task.accepted",{taskId:id,task});

  const client = aiClient();
  if (!client) {
    record.status = "waiting_for_ai";
    emit("task.waiting_for_ai",{taskId:id});
    return res.status(202).json({ok:true,task:record});
  }

  try {
    record.status = "running";
    emit("task.started",{taskId:id});
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.6-mini",
      input: [
        {role:"system", content:"You are the execution brain of AI-OFFICE. Analyze the task, produce a concise execution plan and verification checklist. Do not claim external actions were completed unless this runtime actually performed them."},
        {role:"user", content:task}
      ]
    });
    record.status = "completed";
    record.result = response.output_text || "";
    record.completedAt = new Date().toISOString();
    emit("task.completed",{taskId:id});
    res.json({ok:true,task:record});
  } catch (error) {
    record.status = "failed";
    record.error = error?.message || String(error);
    emit("task.failed",{taskId:id,error:record.error});
    res.status(500).json({ok:false,task:record});
  }
});

app.listen(process.env.PORT || 10000, "0.0.0.0", () => {
  emit("office.started");
  console.log("AI-OFFICE runtime listening on", process.env.PORT || 10000);
});
