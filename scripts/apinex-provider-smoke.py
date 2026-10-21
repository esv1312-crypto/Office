import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE_URL = "https://api.apinex.bond/v1"
TOKEN = os.environ.get("APINEX_API_KEY", "").strip()
TIMEOUT_SECONDS = 18
PROMPT = "Reply with exactly: APINEX_SMOKE_OK"

if not TOKEN:
    raise SystemExit("APINEX_API_KEY secret is missing; no request was sent.")

def request_json(url, method="GET", payload=None):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Accept": "application/json", "Authorization": "Bearer " + TOKEN}
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as response:
            raw = response.read().decode("utf-8", "replace")
            elapsed = round((time.monotonic() - started) * 1000)
            try:
                data = json.loads(raw)
            except Exception:
                data = {}
            return response.status, data, elapsed, None
    except urllib.error.HTTPError as exc:
        elapsed = round((time.monotonic() - started) * 1000)
        try:
            data = json.loads(exc.read().decode("utf-8", "replace"))
        except Exception:
            data = {}
        message = data.get("error", {})
        if isinstance(message, dict):
            message = message.get("message", "")
        return exc.code, data, elapsed, str(message)[:240]
    except Exception as exc:
        elapsed = round((time.monotonic() - started) * 1000)
        return None, {}, elapsed, type(exc).__name__ + ": " + str(exc)[:180]

status, catalog, latency, error = request_json(BASE_URL + "/models")
if status != 200:
    report = {"provider": "apinex", "catalog_status": status, "catalog_latency_ms": latency, "error": error or "catalog request failed", "tested": []}
    print(json.dumps(report, ensure_ascii=False))
    raise SystemExit(1)

models = catalog.get("data", []) if isinstance(catalog, dict) else []
free_models = [
    item for item in models
    if isinstance(item, dict)
    and isinstance(item.get("id"), str)
    and item["id"].startswith("free/")
]
# Keep the test bounded: at most three real calls, only to explicitly free IDs.
selected = free_models[:3]
results = []
for item in selected:
    model = item["id"]
    http_status, data, elapsed, request_error = request_json(
        BASE_URL + "/chat/completions",
        method="POST",
        payload={
            "model": model,
            "messages": [{"role": "user", "content": PROMPT}],
            "max_tokens": 48,
            "temperature": 0
        }
    )
    choices = data.get("choices", []) if isinstance(data, dict) else []
    message = choices[0].get("message", {}) if choices and isinstance(choices[0], dict) else {}
    content = message.get("content", "") if isinstance(message, dict) else ""
    if isinstance(content, list):
        content = " ".join(str(part.get("text", "")) for part in content if isinstance(part, dict))
    finish_reason = choices[0].get("finish_reason") if choices and isinstance(choices[0], dict) else None
    results.append({
        "model": model,
        "http_status": http_status,
        "latency_ms": elapsed,
        "ok": http_status == 200 and bool(str(content).strip()),
        "response_chars": len(str(content).strip()),
        "finish_reason": finish_reason,
        "error": request_error
    })

report = {
    "provider": "apinex",
    "catalog_status": status,
    "catalog_latency_ms": latency,
    "free_models_found": len(free_models),
    "tested": results,
    "success_count": sum(1 for result in results if result["ok"]),
    "note": "Only free/* models were called. API key and response text are not logged."
}
serialized = json.dumps(report, ensure_ascii=False, indent=2)
print(serialized)
with open("apinex-smoke-report.json", "w", encoding="utf-8") as handle:
    handle.write(serialized + "\n")
if not results or report["success_count"] == 0:
    raise SystemExit(1)
