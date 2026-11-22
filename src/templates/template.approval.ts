import type { TemplateApprovalMode } from '@prisma/client';

/**
 * Pure policy for template publish approval.
 *
 * The database shape is intentionally small: one approval row per `(templateId, revision)`.
 * All decisions live here so unit tests can cover every branch without Prisma.
 */

export const SELF_APPROVAL_REASON_MIN_LENGTH = 20;
export const SELF_APPROVAL_REASON_MAX_LENGTH = 500;

export type ApprovalMode = TemplateApprovalMode;

export type PublishApprovalStatus = 'none' | 'pending' | 'approved' | 'rejected';

export interface PublishApprovalState {
  mode: ApprovalMode;
  /** At least one active approver exists for the tenant. */
  hasApprover: boolean;
  /** Status of the approval row for the template revision being published. */
  approvalStatus: PublishApprovalStatus;
  approvalRevision?: number;
  templateRevision: number;
  requesterAdminId: string;
  reviewerAdminId?: string | null;
  selfApprovalReason?: string | null;
}

export type PublishApprovalDecision =
  | { allowed: true; selfApproval: boolean; reason: string | null }
  | { allowed: false; code: string };

export function requiresSeparateApprover(mode: ApprovalMode): boolean {
  return mode === 'two_person';
}

export function normalizeSelfApprovalReason(
  reason: string | null | undefined,
): string | null {
  if (reason === undefined || reason === null) {
    return null;
  }

  const trimmed = reason.trim();

  if (
    trimmed.length < SELF_APPROVAL_REASON_MIN_LENGTH ||
    trimmed.length > SELF_APPROVAL_REASON_MAX_LENGTH
  ) {
    return null;
  }

  return trimmed;
}

export function approvalIsStale(
  approvalRevision: number,
  templateRevision: number,
): boolean {
  return approvalRevision !== templateRevision;
}

export function decidePublishApproval(state: PublishApprovalState): PublishApprovalDecision {
  if (state.approvalStatus === 'approved') {
    if (
      state.approvalRevision !== undefined &&
      approvalIsStale(state.approvalRevision, state.templateRevision)
    ) {
      return { allowed: false, code: 'approval_stale' };
    }

    if (
      requiresSeparateApprover(state.mode) &&
      state.reviewerAdminId !== null &&
      state.reviewerAdminId !== undefined &&
      state.reviewerAdminId === state.requesterAdminId
    ) {
      return { allowed: false, code: 'approval_self_forbidden' };
    }

    return { allowed: true, selfApproval: false, reason: null };
  }

  if (requiresSeparateApprover(state.mode)) {
    if (!state.hasApprover) {
      return { allowed: false, code: 'approver_unavailable' };
    }

    if (state.approvalStatus === 'pending') {
      return { allowed: false, code: 'approval_pending' };
    }

    if (state.approvalStatus === 'rejected') {
      return { allowed: false, code: 'approval_rejected' };
    }

    return { allowed: false, code: 'approval_required' };
  }

  // self_approval_allowed: never bypass an outstanding or rejected review.
  if (state.approvalStatus === 'pending') {
    return { allowed: false, code: 'approval_pending' };
  }

  if (state.approvalStatus === 'rejected') {
    return { allowed: false, code: 'approval_rejected' };
  }

  const reason = normalizeSelfApprovalReason(state.selfApprovalReason);

  if (reason === null) {
    return { allowed: false, code: 'self_approval_reason_required' };
  }

  return { allowed: true, selfApproval: true, reason };
}
