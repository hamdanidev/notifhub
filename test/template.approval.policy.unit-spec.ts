import {
  decidePublishApproval,
  normalizeSelfApprovalReason,
  requiresSeparateApprover,
} from '../src/templates/template.approval';

describe('template approval policy', () => {
  it('requires an approver and never allows publish without approval in two_person mode', () => {
    expect(requiresSeparateApprover('two_person')).toBe(true);
    expect(requiresSeparateApprover('self_approval_allowed')).toBe(false);

    expect(
      decidePublishApproval({
        mode: 'two_person',
        hasApprover: false,
        approvalStatus: 'none',
        templateRevision: 0,
        requesterAdminId: 'admin',
      }),
    ).toEqual({ allowed: false, code: 'approver_unavailable' });

    expect(
      decidePublishApproval({
        mode: 'two_person',
        hasApprover: true,
        approvalStatus: 'none',
        templateRevision: 0,
        requesterAdminId: 'admin',
      }),
    ).toEqual({ allowed: false, code: 'approval_required' });
  });

  it('allows publish with an approval from a different reviewer', () => {
    expect(
      decidePublishApproval({
        mode: 'two_person',
        hasApprover: true,
        approvalStatus: 'approved',
        approvalRevision: 3,
        templateRevision: 3,
        requesterAdminId: 'admin',
        reviewerAdminId: 'approver',
      }),
    ).toEqual({ allowed: true, selfApproval: false, reason: null });
  });

  it('rejects stale and self approvals', () => {
    expect(
      decidePublishApproval({
        mode: 'two_person',
        hasApprover: true,
        approvalStatus: 'approved',
        approvalRevision: 2,
        templateRevision: 3,
        requesterAdminId: 'admin',
        reviewerAdminId: 'approver',
      }),
    ).toEqual({ allowed: false, code: 'approval_stale' });

    expect(
      decidePublishApproval({
        mode: 'two_person',
        hasApprover: true,
        approvalStatus: 'approved',
        approvalRevision: 3,
        templateRevision: 3,
        requesterAdminId: 'admin',
        reviewerAdminId: 'admin',
      }),
    ).toEqual({ allowed: false, code: 'approval_self_forbidden' });
  });

  it('never lets self-approval override pending or rejected reviews', () => {
    const base = {
      mode: 'self_approval_allowed' as const,
      hasApprover: false,
      templateRevision: 0,
      requesterAdminId: 'admin',
      selfApprovalReason: 'Perbaikan typo mendesak saat approver tidak tersedia',
    };

    expect(decidePublishApproval({ ...base, approvalStatus: 'pending' })).toEqual({
      allowed: false,
      code: 'approval_pending',
    });
    expect(decidePublishApproval({ ...base, approvalStatus: 'rejected' })).toEqual({
      allowed: false,
      code: 'approval_rejected',
    });
  });

  it('requires a long enough reason for self-approval', () => {
    expect(normalizeSelfApprovalReason('pendek')).toBeNull();
    expect(normalizeSelfApprovalReason('  alasan yang cukup panjang untuk audit  ')).toBe(
      'alasan yang cukup panjang untuk audit',
    );

    expect(
      decidePublishApproval({
        mode: 'self_approval_allowed',
        hasApprover: false,
        approvalStatus: 'none',
        templateRevision: 0,
        requesterAdminId: 'admin',
        selfApprovalReason: 'pendek',
      }),
    ).toEqual({ allowed: false, code: 'self_approval_reason_required' });
  });

  it('allows self approval with a valid reason in relaxed mode', () => {
    expect(
      decidePublishApproval({
        mode: 'self_approval_allowed',
        hasApprover: true,
        approvalStatus: 'none',
        templateRevision: 4,
        requesterAdminId: 'admin',
        selfApprovalReason: 'Perbaikan typo mendesak saat approver tidak tersedia',
      }),
    ).toEqual({
      allowed: true,
      selfApproval: true,
      reason: 'Perbaikan typo mendesak saat approver tidak tersedia',
    });
  });
});
