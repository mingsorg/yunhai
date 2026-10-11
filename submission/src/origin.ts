import type { Caller } from "./auth.ts";
import { requireOwnedResource, requireScope } from "./policy.ts";

export type Integration = { id: string; tenantId: string; name: string; webhookEnabled: boolean };
export type AuditEvent = {
  eventId: string; timestamp: string; actor: string; tenantId: string;
  tool: "disable_webhook"; outcome: "allowed" | "denied"; changed?: boolean;
};

export function createMockOrigin() {
  // Synthetic data held in memory (demo only; production needs regional persistence).
  const records = new Map<string, Integration>([
    ["wh-a-1", { id: "wh-a-1", tenantId: "tenant-a", name: "Synthetic CRM", webhookEnabled: true }],
    ["wh-b-1", { id: "wh-b-1", tenantId: "tenant-b", name: "Synthetic ERP", webhookEnabled: true }],
  ]);
  const audit: AuditEvent[] = [];
  // Keep at most 100 audit events (demo only).
  function record(event: AuditEvent) {
    audit.push(event);
    if (audit.length > 100) audit.shift();
  }
  return {
    // Read: check scope, then return only this tenant's rows, with safe fields only.
    list(caller: Caller) {
      requireScope(caller, "integrations:read");
      return [...records.values()].filter((r) => r.tenantId === caller.tenantId)
        .map(({ id, name, webhookEnabled }) => ({ id, name, webhookEnabled }));
    },
    // Write: the only function that changes data. Every attempt is audited.
    disable(caller: Caller, webhookId: string) {
      // Build the audit record first, so denied attempts are recorded too.
      const event = {
        eventId: crypto.randomUUID(), timestamp: new Date().toISOString(), actor: caller.subject,
        tenantId: caller.tenantId, tool: "disable_webhook" as const,
      };
      let stage = "scope";
      try {
        // The origin enforces policy: a direct adapter call cannot bypass these checks.
        requireScope(caller, "webhooks:write");
        stage = "ownership";
        const target = records.get(webhookId);
        requireOwnedResource(caller, target?.tenantId);
        // Safe: requireOwnedResource above throws if target is undefined.
        const changed = target!.webhookEnabled;
        target!.webhookEnabled = false;
        record({ ...event, outcome: "allowed", changed });
        return { webhookId, webhookEnabled: false, changed, auditEventId: event.eventId };
      } catch (error) {
        // Do not retain untrusted IDs, bearer tokens, ticket bodies, or foreign resource details.
        record({ ...event, outcome: "denied" });
        // Log the reason, but never the requested target ID (it may belong to another tenant).
        console.log(`${new Date().toISOString()} DENIED tool=disable_webhook actor=${caller.subject} tenant=${caller.tenantId} reason=${stage}`);
        throw error;
      }
    },
    // Return copies, so callers cannot change the audit log.
    auditSnapshot() { return audit.map((event) => ({ ...event })); },
  };
}

export type MockOrigin = ReturnType<typeof createMockOrigin>;
