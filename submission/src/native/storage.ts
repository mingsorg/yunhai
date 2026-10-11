import type { Store } from "./types.ts";

export interface GateState {
  storage: {
    sql: { exec(query: string, ...bindings: string[]): { toArray(): Record<string, unknown>[] } };
    transactionSync<T>(callback: () => T): T;
  };
}
export function durableStore(ctx: GateState): Store {
  const sql = ctx.storage.sql;
  sql.exec("CREATE TABLE IF NOT EXISTS gate_records (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  return {
    get<T>(key: string): T | undefined {
      const row = sql.exec("SELECT value FROM gate_records WHERE key = ?", key).toArray()[0];
      return row ? JSON.parse(String(row.value)) as T : undefined;
    },
    put(key, value) {
      sql.exec("INSERT INTO gate_records(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, JSON.stringify(value));
    },
    delete(key) { sql.exec("DELETE FROM gate_records WHERE key = ?", key); },
    transaction(operation) { return ctx.storage.transactionSync(operation); },
  };
}
