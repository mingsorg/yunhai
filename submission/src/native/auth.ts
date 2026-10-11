import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { authenticate } from "../auth.ts";
import type { NativeCaller } from "./types.ts";

export type AuthEnv = {
  NATIVE_MODE: "fixture" | "cloudflare";
  APP_HOST?: string; ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string; IDENTITY_POLICY_JSON?: string;
};
export const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const policySchema = z.record(z.string(), z.object({
  tenantId: z.string().min(1).max(100),
  scopes: z.array(z.enum(["integrations:read", "webhooks:write", "approvals:write"])).max(3),
  role: z.enum(["agent", "operator"]),
}).strict());
const keys = new Map<string, JWTVerifyGetKey>();

export function configurationAllows(request: Request, env: AuthEnv) {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  if (host && host !== url.host) return false;
  if (env.NATIVE_MODE === "fixture") return LOCAL_HOSTS.includes(url.hostname);
  return env.NATIVE_MODE === "cloudflare" && !!env.APP_HOST && url.host === env.APP_HOST &&
    url.protocol === "https:" && /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN ?? "") &&
    !!env.ACCESS_AUD && !!env.IDENTITY_POLICY_JSON;
}

export async function authenticateNative(request: Request, env: AuthEnv, testKeys?: JWTVerifyGetKey): Promise<NativeCaller | null> {
  if (env.NATIVE_MODE === "fixture") {
    if (!LOCAL_HOSTS.includes(new URL(request.url).hostname)) return null;
    if (request.headers.get("authorization") === "Bearer demo-operator-a") {
      return { subject: "human-operator-a", tenantId: "tenant-a", scopes: ["integrations:read", "approvals:write"], role: "operator" };
    }
    const caller = authenticate(request);
    return caller ? { ...caller, role: "agent" } : null;
  }
  if (env.NATIVE_MODE !== "cloudflare" || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD ||
      !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN)) return null;
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;
  try {
    let jwks = testKeys ?? keys.get(env.ACCESS_TEAM_DOMAIN);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(`${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`), { timeoutDuration: 5_000 });
      keys.set(env.ACCESS_TEAM_DOMAIN, jwks);
    }
    const { payload } = await jwtVerify(token, jwks, {
      issuer: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD, algorithms: ["RS256"],
      requiredClaims: ["sub", "exp", "iat"],
    });
    // Service-token JWTs carry an empty `sub` and the token's Client ID in `common_name`.
    const commonName = typeof payload.common_name === "string" ? payload.common_name : "";
    const subject = payload.sub || (commonName ? `service:${commonName}` : "");
    if (!subject) return null;
    const policy = policySchema.parse(JSON.parse(env.IDENTITY_POLICY_JSON ?? "{}"));
    if (!Object.hasOwn(policy, subject)) return null;
    const grant = policy[subject];
    // No permissions are accepted from request bodies or self-asserted JWT custom claims.
    return Object.freeze({ subject, ...grant, scopes: Object.freeze([...grant.scopes]) });
  } catch { return null; }
}
