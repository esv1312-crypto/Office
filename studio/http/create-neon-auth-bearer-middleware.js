import { createPublicKey, verify as verifySignature } from "node:crypto";

function decodePart(value, label) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw Object.assign(new Error(`Invalid JWT ${label}`), { status: 401, code: "INVALID_TOKEN" });
  }
}

function unauthorized(message = "Bearer authentication required") {
  return Object.assign(new Error(message), { status: 401, code: "UNAUTHENTICATED" });
}

function parseBearer(header) {
  if (typeof header !== "string") throw unauthorized();
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(header);
  if (!match) throw unauthorized();
  return match[1];
}

/**
 * Verifies Neon Managed Auth RS256 bearer JWTs and attaches only verified
 * identity claims to request.auth.actor. Authorization remains a separate
 * database-backed Studio responsibility.
 */
export function createNeonAuthBearerMiddleware({
  jwksUrl,
  issuer,
  audience,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  clockToleranceSeconds = 5,
  jwksCacheMs = 5 * 60 * 1000,
}) {
  for (const [name, value] of Object.entries({ jwksUrl, issuer, audience })) {
    if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} is required`);
  }
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  if (typeof now !== "function") throw new TypeError("now must be a function");

  let cachedKeys = null;
  let cacheExpiresAt = 0;

  async function getSigningKey(kid) {
    if (!cachedKeys || now() >= cacheExpiresAt) {
      const response = await fetchImpl(jwksUrl, { headers: { accept: "application/json" } });
      if (!response?.ok) throw Object.assign(new Error("Identity provider key lookup failed"), {
        status: 503, code: "IDENTITY_PROVIDER_UNAVAILABLE",
      });
      const jwks = await response.json();
      if (!Array.isArray(jwks?.keys)) throw Object.assign(new Error("Invalid identity provider JWKS"), {
        status: 503, code: "INVALID_IDENTITY_PROVIDER_KEYS",
      });
      cachedKeys = jwks.keys.filter(key => key.kty === "RSA" && key.use !== "enc" &&
        (!key.alg || key.alg === "RS256") && typeof key.kid === "string");
      cacheExpiresAt = now() + jwksCacheMs;
    }
    let jwk = cachedKeys.find(key => key.kid === kid);
    if (!jwk) {
      cachedKeys = null;
      cacheExpiresAt = 0;
      const response = await fetchImpl(jwksUrl, { headers: { accept: "application/json" } });
      if (!response?.ok) throw Object.assign(new Error("Identity provider key lookup failed"), {
        status: 503, code: "IDENTITY_PROVIDER_UNAVAILABLE",
      });
      const jwks = await response.json();
      if (!Array.isArray(jwks?.keys)) throw Object.assign(new Error("Invalid identity provider JWKS"), {
        status: 503, code: "INVALID_IDENTITY_PROVIDER_KEYS",
      });
      cachedKeys = jwks.keys.filter(key => key.kty === "RSA" && key.use !== "enc" &&
        (!key.alg || key.alg === "RS256") && typeof key.kid === "string");
      cacheExpiresAt = now() + jwksCacheMs;
      jwk = cachedKeys.find(key => key.kid === kid);
    }
    if (!jwk) throw unauthorized("Unknown signing key");
    return createPublicKey({ key: jwk, format: "jwk" });
  }

  return async function neonAuthBearerMiddleware(request, response, next) {
    try {
      const token = parseBearer(request?.headers?.authorization);
      const parts = token.split(".");
      if (parts.length !== 3) throw unauthorized("Malformed bearer token");
      const header = decodePart(parts[0], "header");
      const claims = decodePart(parts[1], "payload");
      if (header.alg !== "RS256" || typeof header.kid !== "string") {
        throw unauthorized("Unsupported bearer token signing algorithm");
      }
      const key = await getSigningKey(header.kid);
      const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
      const signature = Buffer.from(parts[2], "base64url");
      if (!verifySignature("RSA-SHA256", signed, key, signature)) throw unauthorized("Invalid bearer token signature");

      const current = Math.floor(now() / 1000);
      if (claims.iss !== issuer) throw unauthorized("Invalid token issuer");
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!audiences.includes(audience)) throw unauthorized("Invalid token audience");
      if (!Number.isFinite(claims.exp) || current >= claims.exp + clockToleranceSeconds) {
        throw unauthorized("Bearer token expired");
      }
      if (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || current + clockToleranceSeconds < claims.nbf)) {
        throw unauthorized("Bearer token is not active");
      }
      if (typeof claims.sub !== "string" || !claims.sub.trim()) throw unauthorized("Token subject is missing");

      request.auth = {
        ...(request.auth && typeof request.auth === "object" ? request.auth : {}),
        actor: Object.freeze({
          id: claims.sub,
          ...(typeof claims.email === "string" ? { email: claims.email } : {}),
          ...(typeof claims.name === "string" ? { name: claims.name } : {}),
        }),
      };
      return next();
    } catch (error) {
      if (error?.status === 401 || error?.status === 503) return response.status(error.status).json({
        error: error.code || "AUTHENTICATION_FAILED",
      });
      return response.status(401).json({ error: "AUTHENTICATION_FAILED" });
    }
  };
}
