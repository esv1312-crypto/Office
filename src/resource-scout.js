const SOURCES = [
  {
    id: "apinex-free-models",
    name: "APINEX free-model catalog",
    kind: "model_catalog",
    url: "https://apinex.bond/models?group=free",
    termsUrl: "https://apinex.bond/pricing",
    freeClaim: "Models marked free; account quotas and terms require verification",
    integrationStatus: "not_connected"
  },
  {
    id: "free-public-apis",
    name: "Free Public APIs",
    kind: "api_directory",
    url: "https://www.freepublicapis.com/",
    termsUrl: "https://www.freepublicapis.com/",
    freeClaim: "Directory of public APIs; each API has its own terms",
    integrationStatus: "not_connected"
  },
  {
    id: "freeapihub",
    name: "FreeAPIHub",
    kind: "api_directory",
    url: "https://freeapihub.com/apis?sort=new",
    termsUrl: "https://freeapihub.com/",
    freeClaim: "Directory includes free and freemium APIs; individual terms require review",
    integrationStatus: "not_connected"
  },
  {
    id: "public-api-lists",
    name: "Public API Lists",
    kind: "open_source_catalog",
    url: "https://github.com/public-api-lists/public-api-lists",
    termsUrl: "https://github.com/public-api-lists/public-api-lists",
    freeClaim: "Curated list; each API has its own terms",
    integrationStatus: "not_connected"
  }
];

const resources = new Map(SOURCES.map(source => [source.id, {
  ...source,
  status: "not_checked",
  httpStatus: null,
  contentType: null,
  lastCheckedAt: null,
  lastError: null
}]));

let refreshing = false;

export function restoreResourceSnapshots(snapshots = []) {
  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    if (!snapshot || !resources.has(String(snapshot.id || ""))) continue;
    const source = resources.get(snapshot.id);
    resources.set(snapshot.id, {
      ...source,
      ...snapshot,
      // Runtime configuration is code-owned; never restore arbitrary URLs or auth headers from persisted data.
      url: source.url,
      termsUrl: source.termsUrl,
      integrationStatus: "not_connected"
    });
  }
  return getResourceScoutState();
}

export function getResourceScoutState() {
  const items = [...resources.values()].map(resource => ({ ...resource }));
  return {
    refreshing,
    count: items.length,
    reachable: items.filter(item => item.status === "reachable").length,
    unavailable: items.filter(item => item.status === "unavailable" || item.status === "check_failed").length,
    unreviewed: items.length,
    policy: {
      automaticIntegration: false,
      secretHandling: "catalog checks are unauthenticated; provider keys are never sent to catalog sites",
      approvalRequiredBeforeIntegration: true,
      disclaimer: "A reachable catalog is not proof that every listed API is free, safe, or permitted for commercial use."
    },
    sources: items
  };
}

export async function scanResourceSources({ fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  if (refreshing) return getResourceScoutState();
  refreshing = true;
  try {
    const entries = await Promise.all(SOURCES.map(async source => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const checkedAt = new Date().toISOString();
      try {
        const response = await fetchImpl(source.url, {
          method: "GET",
          redirect: "follow",
          headers: { "Accept": "text/html,application/json;q=0.9,*/*;q=0.8" },
          signal: controller.signal
        });
        if (response.body && typeof response.body.cancel === "function") {
          try { await response.body.cancel(); } catch (_) {}
        }
        const resource = {
          ...resources.get(source.id),
          status: response.ok ? "reachable" : "unavailable",
          httpStatus: Number(response.status || 0),
          contentType: response.headers?.get?.("content-type") || null,
          lastCheckedAt: checkedAt,
          lastError: response.ok ? null : "HTTP " + response.status
        };
        resources.set(source.id, resource);
        return { ...resource };
      } catch (error) {
        const resource = {
          ...resources.get(source.id),
          status: "check_failed",
          httpStatus: null,
          contentType: null,
          lastCheckedAt: checkedAt,
          lastError: error?.name === "AbortError" ? "Request timed out" : String(error?.message || error).slice(0, 240)
        };
        resources.set(source.id, resource);
        return { ...resource };
      } finally {
        clearTimeout(timeout);
      }
    }));
    return {
      ...getResourceScoutState(),
      sources: entries
    };
  } finally {
    refreshing = false;
  }
}

export async function persistResourceSnapshots(state, saveResourceSnapshot) {
  if (typeof saveResourceSnapshot !== "function") return;
  for (const resource of state?.sources || []) {
    await saveResourceSnapshot(resource);
  }
}
