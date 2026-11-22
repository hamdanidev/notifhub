import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { templatesClient } from '../lib/adminClient';
import { describeError } from '../lib/format';

export interface TemplateApprovalPanelProps {
  templateId: string;
  revision: number;
}

/**
 * Maker submits the current draft revision; the approver approves or rejects it. The server
 * enforces both roles, so this panel is a convenience (and a place to surface `stale`).
 */
export function TemplateApprovalPanel({
  templateId,
  revision,
}: TemplateApprovalPanelProps): JSX.Element {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const isApprover = session?.admin.role === 'tenant_approver';

  const approvals = useQuery({
    queryKey: ['template-approvals', templateId],
    queryFn: () => templatesClient.listTemplateApprovals(templateId, { limit: 20 }),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['template-approvals', templateId] });
    void queryClient.invalidateQueries({ queryKey: ['template', templateId] });
  };

  const submit = useMutation({
    mutationFn: () =>
      templatesClient.submitReview(templateId, revision, note.trim().length > 0 ? note.trim() : undefined),
    onSuccess: () => {
      setError(null);
      setNote('');
      invalidate();
    },
    onError: (mutationError) => setError(mutationError),
  });

  const approve = useMutation({
    mutationFn: (approvalId: string) =>
      templatesClient.approveApproval(approvalId, note.trim().length > 0 ? note.trim() : undefined),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (mutationError) => setError(mutationError),
  });

  const reject = useMutation({
    mutationFn: (approvalId: string) => templatesClient.rejectApproval(approvalId, note.trim()),
    onSuccess: () => {
      setError(null);
      setNote('');
      invalidate();
    },
    onError: (mutationError) => setError(mutationError),
  });

  const currentRevision = (approvals.data?.items ?? []).filter(
    (item) => item.revision === revision,
  );
  const pending = currentRevision.find((item) => item.status === 'pending');
  const latest = currentRevision[0];

  return (
    <Card className="mb-3">
      <Card.Body className="py-2">
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <span className="fw-semibold small">Approval publish</span>
          {latest === undefined ? (
            <Badge bg="secondary">belum diajukan</Badge>
          ) : latest.stale ? (
            <Badge bg="warning" text="dark">
              stale (revisi berubah)
            </Badge>
          ) : (
            <Badge
              bg={
                latest.status === 'approved'
                  ? 'success'
                  : latest.status === 'rejected'
                    ? 'danger'
                    : 'secondary'
              }
            >
              {latest.status}
            </Badge>
          )}
          {latest?.selfApproved === true ? (
            <Badge bg="warning" text="dark">
              self-approved
            </Badge>
          ) : null}
          {latest?.reviewedBy !== null && latest?.reviewedBy !== undefined ? (
            <span className="small text-muted">oleh {latest.reviewedBy.email}</span>
          ) : null}
          <Link className="small" to={`/templates/${templateId}/compare`}>
            Bandingkan versi
          </Link>
        </div>

        {error !== null ? (
          <Alert variant="danger" className="py-2 small mt-2 mb-0">
            {describeError(error)}
          </Alert>
        ) : null}

        {latest !== undefined && latest.reviewNote !== null ? (
          <div className="small text-muted mt-1">Catatan reviewer: {latest.reviewNote}</div>
        ) : null}

        <div className="d-flex gap-2 flex-wrap mt-2">
          <input
            className="form-control form-control-sm"
            style={{ maxWidth: '22rem' }}
            placeholder="Catatan (wajib untuk tolak)"
            value={note}
            maxLength={500}
            aria-label="Catatan review"
            onChange={(event) => setNote(event.target.value)}
          />
          {!isApprover ? (
            <Button
              size="sm"
              variant="outline-secondary"
              disabled={submit.isPending || pending !== undefined || latest?.status === 'approved'}
              onClick={() => submit.mutate()}
            >
              Ajukan review
            </Button>
          ) : pending !== undefined ? (
            <>
              <Button
                size="sm"
                variant="success"
                disabled={approve.isPending || reject.isPending || pending.stale}
                onClick={() => approve.mutate(pending.id)}
              >
                Setujui
              </Button>
              <Button
                size="sm"
                variant="outline-danger"
                disabled={approve.isPending || reject.isPending || note.trim().length === 0}
                onClick={() => reject.mutate(pending.id)}
              >
                Tolak
              </Button>
            </>
          ) : (
            <span className="small text-muted">Tidak ada permintaan review untuk revisi ini.</span>
          )}
        </div>
      </Card.Body>
    </Card>
  );
}
