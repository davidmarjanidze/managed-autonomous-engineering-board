import type { ApprovalRetentionAuditEntry } from "@src/services/tasks";

export function formatRetentionAuditChange(
  entry: ApprovalRetentionAuditEntry,
): string {
  return [
    entry.changes.maxHistoryCount !== undefined
      ? `maxHistoryCount=${entry.changes.maxHistoryCount}`
      : null,
    entry.changes.maxAgeDays !== undefined
      ? `maxAgeDays=${entry.changes.maxAgeDays}`
      : null,
    entry.changes.pruneIntervalMs !== undefined
      ? `pruneIntervalMs=${entry.changes.pruneIntervalMs}`
      : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(", ");
}
