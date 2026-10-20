export function buildProviderCandidateOrder({providerPools={}, providerOrder=[], preferred=null, fallbackCandidates=[]}={}) {
  const providers=[...new Set([...providerOrder,"huggingface","gemini","apinex","cloudflare",...(preferred?.provider?[preferred.provider]:[])])]
    .filter(provider=>Array.isArray(providerPools[provider]) && providerPools[provider].length);
  const pools=Object.fromEntries(providers.map(provider=>[provider,[...(providerPools[provider]||[])]]));
  if(preferred?.provider && preferred?.model) {
    if(!pools[preferred.provider]) {
      providers.push(preferred.provider);
      pools[preferred.provider]=[];
    }
    pools[preferred.provider]=[
      preferred,
      ...pools[preferred.provider].filter(candidate=>candidate?.model!==preferred.model)
    ];
  }
  const result=[];
  const maxLength=Math.max(0,...providers.map(provider=>pools[provider].length));
  for(let index=0;index<maxLength;index++) {
    for(const provider of providers) {
      const candidate=pools[provider][index];
      if(candidate) result.push(candidate);
    }
  }
  result.push(...fallbackCandidates);
  const seen=new Set();
  return result.filter(candidate=>{
    if(!candidate?.provider || !candidate?.model) return false;
    const key=String(candidate.provider)+":"+String(candidate.model);
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


// Keep the configured/selected primary model first on every task. Rotate only
// the backup order so fallback diversity never silently replaces the primary.
export function orderPrimaryModelFirst(models = [], preferredModel = null, cursor = 0) {
  const unique = [...new Set(models.filter(model => typeof model === "string" && model.trim()).map(model => model.trim()))];
  if (!unique.length) return [];
  const primary = preferredModel && unique.includes(preferredModel) ? preferredModel : unique[0];
  const backups = unique.filter(model => model !== primary);
  if (backups.length < 2) return [primary, ...backups];
  const offset = ((Math.trunc(Number(cursor) || 0) % backups.length) + backups.length) % backups.length;
  const rotatedBackups = backups.map((_, index) => backups[(offset + index) % backups.length]);
  return [primary, ...rotatedBackups];
}
