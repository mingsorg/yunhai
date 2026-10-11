import type { Caller } from "../auth.ts";

export type NativeCaller = Caller & { role: "agent" | "operator" };
export type Task = {
  id: string; tenantId: string; subject: string; text: string;
  action: "inspect" | "disable_webhook"; webhookId: string; expiresAt: number;
};
export type Resource = { id: string; tenantId: string; name: string; webhookEnabled: boolean; version: number };
export type WriteInput = { taskId: string; webhookId: string; ticket: string; approvalId?: string };
export type Review = {
  id: string; tenantId: string; subject: string; taskId: string;
  action: "disable_webhook"; webhookId: string; version: number; ticketHash: string;
  verdict: "aligned" | "blocked" | "uncertain"; reason: string; expiresAt: number;
};
export type Approval = {
  id: string; reviewId: string; approvedBy: string; expiresAt: number; used: boolean;
};
export interface Store {
  get<T>(key: string): T | undefined;
  put(key: string, value: unknown): void;
  delete(key: string): void;
  transaction<T>(operation: () => T): T;
}
export interface AiBinding { run(model: string, input: Record<string, unknown>): Promise<unknown> }
export type Judgment = { verdict: Review["verdict"]; reason: string };
export type Judge = (context: { task: Task; resource: Resource; ticket: string }) => Promise<Judgment>;
export class GateError extends Error {
  code: string;
  constructor(code = "Action not permitted") { super(code); this.code = code; }
}
