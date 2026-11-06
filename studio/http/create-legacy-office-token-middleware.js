import { timingSafeEqual } from "node:crypto";

/**
 * Compatibility authentication for the existing AI-OFFICE owner credential.
 * This keeps the new Studio isolated at the database/schema level while
 * allowing the already-configured legacy owner token to authorize its API.
 */
export function createLegacyOfficeTokenMiddleware({ token, headerName = "x-ai-office-audit-token" }) {
  const expected = String(token || "").trim();
  if (!expected) throw new TypeError("A legacy Office owner token is required");
  if (typeof headerName !== "string" || !headerName.trim()) throw new TypeError("headerName is required");
  const expectedBytes = Buffer.from(expected, "utf8");

  return function legacyOfficeTokenMiddleware(request, response, next) {
    const headerToken = request?.headers?.[headerName.toLowerCase()];
    const authorization = request?.headers?.authorization;
    const bearer = typeof authorization === "string" ? /^Bearer (.+)$/.exec(authorization)?.[1] : null;
    const supplied = typeof headerToken === "string" ? headerToken : bearer;
    if (typeof supplied !== "string") return response.status(401).json({ error: "UNAUTHENTICATED" });
    const suppliedBytes = Buffer.from(supplied, "utf8");
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
      return response.status(401).json({ error: "UNAUTHENTICATED" });
    }
    request.auth = {
      ...(request.auth && typeof request.auth === "object" ? request.auth : {}),
      actor: Object.freeze({ id: "legacy-office-owner", name: "AI-OFFICE owner" }),
    };
    return next();
  };
}
