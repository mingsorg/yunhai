// Identity of the caller. Derived only from the token, never from the request body.
export type Caller = Readonly<{
  subject: string;
  tenantId: string;
  scopes: readonly string[];
}>;

// Deliberately public synthetic credentials. Never deploy these as real identities.
const TOKENS: Readonly<Record<string, Caller>> = Object.freeze({
  "demo-a-read": { subject: "partner-one-reader", tenantId: "tenant-a", scopes: ["integrations:read"] },
  "demo-a-write": { subject: "partner-one-writer", tenantId: "tenant-a", scopes: ["integrations:read", "webhooks:write"] },
  "demo-b-read": { subject: "partner-two-reader", tenantId: "tenant-b", scopes: ["integrations:read"] },
});

// Turn a Bearer token into a caller. Unknown or malformed tokens return null (HTTP 401).
export function authenticate(request: Request): Caller | null {
  // Accept only 'Bearer <token>' with letters, digits and dashes.
  const match = /^Bearer ([A-Za-z0-9-]+)$/i.exec(request.headers.get("authorization") ?? "");
  // Object.hasOwn blocks prototype names such as __proto__.
  if (!match || !Object.hasOwn(TOKENS, match[1])) return null;
  const known = TOKENS[match[1]];
  // Fresh immutable context prevents accidental sharing of mutable request identity.
  return Object.freeze({ ...known, scopes: Object.freeze([...known.scopes]) });
}
