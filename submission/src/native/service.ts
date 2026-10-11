import { z } from "zod";
import { requireOwnedResource, requireScope } from "../policy.ts";
import { GateError, type Approval, type Judge, type NativeCaller, type Resource, type Review, type Store, type Task, type WriteInput } from "./types.ts";

export const taskInput = z.object({
  subject: z.string().min(1).max(200), text: z.string().min(1).max(2_000),
  action: z.enum(["inspect", "disable_webhook"]), webhookId: z.string().regex(/^wh-[a-z]-[0-9]+$/).max(40),
}).strict();
export const writeInput = z.object({
  taskId: z.string().uuid(), webhookId: z.string().regex(/^wh-[a-z]-[0-9]+$/).max(40),
  ticket: z.string().max(4_000), approvalId: z.string().uuid().optional(),
}).strict();

export class GateService {
  private store: Store;
  private judge: Judge;
  private now: () => number;
  constructor(store: Store, judge: Judge, now = () => Date.now()) {
    this.store = store; this.judge = judge; this.now = now;
  }

  initialize(tenantId: string) {
    if (this.store.get("initialized")) return;
    this.store.transaction(() => {
      if (!this.store.get("initialized")) {
        const id = tenantId === "tenant-a" ? "wh-a-1" : tenantId === "tenant-b" ? "wh-b-1" : undefined;
        if (id) this.store.put(`resource:${id}`, {
          id, tenantId, name: "Synthetic integration", webhookEnabled: true, version: 1,
        } satisfies Resource);
        this.store.put("resourceIds", id ? [id] : []);
        this.store.put("initialized", true);
      }
    });
  }

  private operator(caller: NativeCaller) {
    if (caller.role !== "operator") throw new GateError();
    requireScope(caller, "approvals:write");
  }
  private target(caller: NativeCaller, id: string) {
    const resource = this.store.get<Resource>(`resource:${id}`);
    requireOwnedResource(caller, resource?.tenantId);
    return resource!;
  }
  private task(caller: NativeCaller, id: string) {
    const task = this.store.get<Task>(`task:${id}`);
    if (!task || task.subject !== caller.subject || task.tenantId !== caller.tenantId || task.expiresAt <= this.now()) {
      throw new GateError();
    }
    return task;
  }
  private reserve(kind: string, id: string) {
    // Bound active records. Remove expired records when allocating, never evict a live approval.
    const ids = this.store.get<string[]>(`${kind}:ids`) ?? [];
    const active = ids.filter((key) => {
      const value = this.store.get<{ expiresAt: number }>(`${kind}:${key}`);
      if (value && value.expiresAt > this.now()) return true;
      this.store.delete(`${kind}:${key}`);
      if (kind === "review") this.store.delete(`reviewApproval:${key}`);
      return false;
    });
    if (active.length >= 200) throw new GateError("Capacity reached");
    this.store.put(`${kind}:ids`, [...active, id]);
  }
  private audit(caller: NativeCaller, outcome: string) {
    const event = { id: crypto.randomUUID(), timestamp: this.now(), actor: caller.subject, tenantId: caller.tenantId, outcome };
    this.store.put("audit", [...(this.store.get<unknown[]>("audit") ?? []), event].slice(-200));
    return event.id;
  }

  list(caller: NativeCaller) {
    requireScope(caller, "integrations:read");
    return (this.store.get<string[]>("resourceIds") ?? []).map((id) => this.target(caller, id));
  }
  createTask(caller: NativeCaller, input: z.infer<typeof taskInput>) {
    this.operator(caller);
    this.target(caller, input.webhookId);
    if (input.subject === caller.subject) throw new GateError("Independent agent identity required");
    return this.store.transaction(() => {
      const task: Task = { ...input, id: crypto.randomUUID(), tenantId: caller.tenantId, expiresAt: this.now() + 30 * 60_000 };
      this.reserve("task", task.id);
      this.store.put(`task:${task.id}`, task);
      this.audit(caller, "task_created");
      return task;
    });
  }

  review(caller: NativeCaller, id: string) {
    this.operator(caller);
    const review = this.store.get<Review>(`review:${id}`);
    if (!review || review.tenantId !== caller.tenantId) throw new GateError();
    const task = this.store.get<Task>(`task:${review.taskId}`);
    return { review, trustedTask: task };
  }
  approve(caller: NativeCaller, reviewId: string) {
    return this.store.transaction(() => {
      const { review } = this.review(caller, reviewId);
      const task = this.store.get<Task>(`task:${review.taskId}`);
      const resource = this.target(caller, review.webhookId);
      if (review.subject === caller.subject || review.verdict !== "aligned" || review.expiresAt <= this.now() ||
          !task || task.expiresAt <= this.now() || task.action !== review.action ||
          task.webhookId !== review.webhookId || resource.version !== review.version) throw new GateError("Approval not permitted");
      if (this.store.get(`reviewApproval:${review.id}`)) throw new GateError("Review already approved");
      const approval: Approval = {
        id: crypto.randomUUID(), reviewId, approvedBy: caller.subject, used: false,
        expiresAt: Math.min(this.now() + 2 * 60_000, review.expiresAt, task.expiresAt),
      };
      this.reserve("approval", approval.id);
      this.store.put(`approval:${approval.id}`, approval);
      this.store.put(`reviewApproval:${review.id}`, approval.id);
      this.audit(caller, "approval_created");
      return { ...approval, action: review.action, webhookId: review.webhookId, subject: review.subject, version: review.version };
    });
  }

  async disable(caller: NativeCaller, raw: WriteInput): Promise<{
    status: "executed" | "approval_required" | "blocked" | "review_required";
    reviewId?: string; reason?: string; webhookId?: string; webhookEnabled?: boolean; changed?: boolean; auditEventId?: string;
  }> {
    const input = writeInput.parse(raw);
    try {
      if (caller.role !== "agent") throw new GateError();
      requireScope(caller, "webhooks:write");
      const resource = this.target(caller, input.webhookId);
      const task = this.task(caller, input.taskId);
      // Structured task scope is authoritative even if a model confidently says otherwise.
      if (task.action !== "disable_webhook" || task.webhookId !== input.webhookId) throw new GateError("Outside trusted task scope");
      const ticketHash = await hashTicket(input.ticket);

      if (input.approvalId) {
        // No external await in this transaction: approval use, mutation and audit commit together.
        return this.store.transaction(() => {
          const currentTask = this.task(caller, input.taskId);
          const current = this.target(caller, input.webhookId);
          requireScope(caller, "webhooks:write");
          const approval = this.store.get<Approval>(`approval:${input.approvalId}`);
          const review = approval && this.store.get<Review>(`review:${approval.reviewId}`);
          if (!approval || approval.used || approval.expiresAt <= this.now() || approval.approvedBy === caller.subject ||
              !review || review.verdict !== "aligned" || review.expiresAt <= this.now() ||
              review.subject !== caller.subject || review.tenantId !== caller.tenantId || review.taskId !== currentTask.id ||
              review.webhookId !== current.id || review.version !== current.version || review.ticketHash !== ticketHash ||
              currentTask.action !== review.action || currentTask.webhookId !== review.webhookId) {
            throw new GateError("Invalid, expired, changed or consumed approval");
          }
          approval.used = true;
          this.store.put(`approval:${approval.id}`, approval);
          const changed = current.webhookEnabled;
          current.webhookEnabled = false;
          current.version++;
          this.store.put(`resource:${current.id}`, current);
          const auditEventId = this.audit(caller, "executed");
          return { status: "executed", webhookId: current.id, webhookEnabled: false, changed, auditEventId };
        });
      }

      const judgment = await this.judge({ task, resource, ticket: input.ticket });
      return this.store.transaction(() => {
        // The resource or task may have changed while the provider request was in flight.
        this.task(caller, input.taskId);
        if (this.target(caller, input.webhookId).version !== resource.version) throw new GateError("Resource changed; request a new review");
        const review: Review = {
          id: crypto.randomUUID(), tenantId: caller.tenantId, subject: caller.subject, taskId: task.id,
          action: "disable_webhook", webhookId: resource.id, version: resource.version, ticketHash,
          ...judgment, expiresAt: Math.min(this.now() + 5 * 60_000, task.expiresAt),
        };
        this.reserve("review", review.id);
        this.store.put(`review:${review.id}`, review);
        this.audit(caller, judgment.verdict);
        return {
          status: judgment.verdict === "aligned" ? "approval_required" : judgment.verdict === "blocked" ? "blocked" : "review_required",
          reviewId: review.id, reason: review.reason,
        };
      });
    } catch (error) {
      this.store.transaction(() => this.audit(caller, "denied"));
      throw error;
    }
  }
}

export async function hashTicket(ticket: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ticket));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
