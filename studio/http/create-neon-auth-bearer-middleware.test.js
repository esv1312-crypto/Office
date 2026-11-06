import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createNeonAuthBearerMiddleware } from "./create-neon-auth-bearer-middleware.js";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", use: "sig", alg: "RS256" };
const now = () => 1_800_000_000_000;

function token(overrides = {}, headerOverrides = {}) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "RS256", typ: "JWT", kid: "test-key", ...headerOverrides });
  const claims = encode({
    iss: "https://auth.example.test",
    aud: "studio-api",
    sub: "verified-user-123",
    exp: 1_800_000_300,
    email: "owner@example.test",
    name: "Studio Owner",
    ...overrides,
  });
  const input = `${header}.${claims}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
}

function fixture() {
  let fetches = 0;
  const middleware = createNeonAuthBearerMiddleware({
    jwksUrl: "https://auth.example.test/.well-known/jwks.json",
    issuer: "https://auth.example.test",
    audience: "studio-api",
    now,
    fetchImpl: async () => {
      fetches += 1;
      return { ok: true, json: async () => ({ keys: [jwk] }) };
    },
  });
  const response = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return { middleware, response, get fetches() { return fetches; } };
}

test("accepts a valid RS256 token and attaches only verified subject identity", async () => {
  const f = fixture();
  const request = { headers: { authorization: `Bearer ${token()}` } };
  let nextCalls = 0;
  await f.middleware(request, f.response, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  assert.deepEqual(request.auth.actor, {
    id: "verified-user-123",
    email: "owner@example.test",
    name: "Studio Owner",
  });
  assert.equal(f.response.statusCode, null);
  assert.equal(f.fetches, 1);
});

test("rejects missing bearer credentials", async () => {
  const f = fixture();
  await f.middleware({ headers: {} }, f.response, () => assert.fail("next must not run"));
  assert.equal(f.response.statusCode, 401);
});

test("rejects an invalid signature", async () => {
  const f = fixture();
  const parts = token().split(".");
  parts[1] = Buffer.from(JSON.stringify({ sub: "attacker", iss: "https://auth.example.test", aud: "studio-api", exp: 1_800_000_300 })).toString("base64url");
  await f.middleware({ headers: { authorization: `Bearer ${parts.join(".")}` } }, f.response, () => assert.fail("next must not run"));
  assert.equal(f.response.statusCode, 401);
});

for (const [label, claims] of [
  ["wrong issuer", { iss: "https://attacker.test" }],
  ["wrong audience", { aud: "other-api" }],
  ["expired token", { exp: 1_799_999_000 }],
  ["missing subject", { sub: "" }],
]) {
  test(`rejects token with ${label}`, async () => {
    const f = fixture();
    await f.middleware({ headers: { authorization: `Bearer ${token(claims)}` } }, f.response, () => assert.fail("next must not run"));
    assert.equal(f.response.statusCode, 401);
  });
}

test("rejects algorithms other than RS256", async () => {
  const f = fixture();
  await f.middleware({ headers: { authorization: `Bearer ${token({}, { alg: "none" })}` } }, f.response, () => assert.fail("next must not run"));
  assert.equal(f.response.statusCode, 401);
});

test("caches JWKS between valid requests", async () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) {
    const response = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await f.middleware({ headers: { authorization: `Bearer ${token()}` } }, response, () => {});
  }
  assert.equal(f.fetches, 1);
});


test("accepts a valid Neon Auth EdDSA (Ed25519) token", async () => {
  const { publicKey: edPublicKey, privateKey: edPrivateKey } = generateKeyPairSync("ed25519");
  const edJwk = { ...edPublicKey.export({ format: "jwk" }), kid: "neon-ed-key", use: "sig", alg: "EdDSA" };
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "EdDSA", typ: "JWT", kid: "neon-ed-key" });
  const claims = encode({
    iss: "https://auth.example.test",
    aud: "studio-api",
    sub: "neon-owner-456",
    exp: 1_800_000_300,
    email: "owner@example.test",
  });
  const input = `${header}.${claims}`;
  const jwt = `${input}.${sign(null, Buffer.from(input), edPrivateKey).toString("base64url")}`;
  const middleware = createNeonAuthBearerMiddleware({
    jwksUrl: "https://auth.example.test/.well-known/jwks.json",
    issuer: "https://auth.example.test",
    audience: "studio-api",
    now,
    fetchImpl: async () => ({ ok: true, json: async () => ({ keys: [edJwk] }) }),
  });
  const response = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const request = { headers: { authorization: `Bearer ${jwt}` } };
  let nextCalls = 0;
  await middleware(request, response, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  assert.equal(request.auth.actor.id, "neon-owner-456");
  assert.equal(request.auth.actor.email, "owner@example.test");
  assert.equal(response.statusCode, null);
});

test("rejects an EdDSA token when the JWKS key is RSA", async () => {
  const f = fixture();
  const parts = token().split(".");
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: "test-key" })).toString("base64url");
  await f.middleware({ headers: { authorization: `Bearer ${header}.${parts[1]}.${parts[2]}` } }, f.response, () => assert.fail("next must not run"));
  assert.equal(f.response.statusCode, 401);
});
