import type {
  ApprovalGateStatus,
  ApprovalRequestPage,
} from "@src/services/tasks";

interface ApprovalControlsPanelProps {
  approvalGate: ApprovalGateStatus;
  approvalAuditStatusFilter: "all" | "pending" | "approved" | "rejected";
  approvalAuditPage: ApprovalRequestPage;
  onToggleApprovalGate: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onChangeStatusFilter: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  runtimeSummary: React.JSX.Element;
}

export function ApprovalControlsPanel({
  approvalGate,
  approvalAuditStatusFilter,
  approvalAuditPage,
  onToggleApprovalGate,
  onChangeStatusFilter,
  onPreviousPage,
  onNextPage,
  runtimeSummary,
}: ApprovalControlsPanelProps): React.JSX.Element {
  return (
    <div className="approval-gate-panel">
      {runtimeSummary}
      <label>
        <input
          type="checkbox"
          checked={approvalGate.enabled}
          onChange={onToggleApprovalGate}
        />
        Require human approval for high-impact phases (
        {approvalGate.protectedPhases.join(", ")})
      </label>
      <div className="approval-audit-controls">
        <label>
          Approval Audit Status
          <select
            value={approvalAuditStatusFilter}
            onChange={onChangeStatusFilter}
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <div className="approval-audit-pagination">
          <button
            type="button"
            onClick={onPreviousPage}
            disabled={approvalAuditPage.offset <= 0}
          >
            Previous
          </button>
          <span>
            Showing {approvalAuditPage.items.length} of{" "}
            {approvalAuditPage.total}
          </span>
          <button
            type="button"
            onClick={onNextPage}
            disabled={
              approvalAuditPage.offset + approvalAuditPage.limit >=
              approvalAuditPage.total
            }
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
