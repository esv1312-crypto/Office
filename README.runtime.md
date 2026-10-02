# AI-OFFICE Runtime

This is the executable control-plane for AI-OFFICE.

Flow:
INTAKE -> RECON -> PLAN -> DELEGATE -> EXECUTE -> VERIFY -> FIX -> RETEST -> EVIDENCE

The runtime starts without an API key in control-plane mode, exposes health/state/task endpoints, and switches to AI mode when OPENAI_API_KEY is configured.

The live monitor remains a separate observability service.
