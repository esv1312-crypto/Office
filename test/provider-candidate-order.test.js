import test from "node:test";
import assert from "node:assert/strict";
import { buildProviderCandidateOrder } from "../src/provider-candidate-order.js";

test("preflight candidate order gives every configured provider a first-round chance",()=>{
  const providerPools={
    openrouter:[{provider:"openrouter",model:"or-main"},{provider:"openrouter",model:"or-backup"}],
    huggingface:[{provider:"huggingface",model:"hf-main"}],
    gemini:[{provider:"gemini",model:"gem-main"}],
    cloudflare:[{provider:"cloudflare",model:"cf-main"}],
    apinex:[{provider:"apinex",model:"api-main"}]
  };
  const candidates=buildProviderCandidateOrder({
    providerPools,
    providerOrder:["openrouter","huggingface","gemini","cloudflare","apinex"],
    preferred:{provider:"openrouter",model:"or-main"}
  });
  assert.deepEqual(candidates.slice(0,5).map(x=>x.provider),["openrouter","huggingface","gemini","cloudflare","apinex"]);
});

test("preferred model is first in its provider lane and duplicates are removed",()=>{
  const candidates=buildProviderCandidateOrder({
    providerPools:{openrouter:[{provider:"openrouter",model:"or-main"},{provider:"openrouter",model:"or-backup"}],gemini:[{provider:"gemini",model:"gem-main"}]},
    providerOrder:["openrouter","gemini"],
    preferred:{provider:"openrouter",model:"or-main"},
    fallbackCandidates:[{provider:"openrouter",model:"or-backup"},{provider:"gemini",model:"gem-main"}]
  });
  assert.deepEqual(candidates.map(x=>x.provider+":"+x.model),["openrouter:or-main","gemini:gem-main","openrouter:or-backup"]);
});
