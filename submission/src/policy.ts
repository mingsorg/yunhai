import type { Caller } from "./auth.ts";

// Single denial type. The message never reveals why access was refused.
export class AccessDenied extends Error {
  constructor() { super("Action not permitted"); }
}

// Action-level check: the token must carry the scope the tool needs.
export function requireScope(caller: Caller, scope: string): void {
  if (!caller.scopes.includes(scope)) throw new AccessDenied();
}

// Resource-level check: the target must belong to the caller's tenant.
export function requireOwnedResource(caller: Caller, tenantId: string | undefined): void {
  // Missing and foreign targets share one error to avoid disclosing another tenant's resources.
  if (tenantId !== caller.tenantId) throw new AccessDenied();
}
