import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Form, Table } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { templatesClient } from '../lib/adminClient';
import { describeError } from '../lib/format';

/**
 * Approval queue for template publish review. The approver approves or rejects; the maker sees
 * the same list read-only to track status. Actions are also enforced by the server.
 */
export function ApprovalQueuePage(): JSX.Element {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<unknown>(null);
  const isApprover = session?.admin.role === 'tenant_approver';

  const queue = useQuery({
    queryKey: ['template-approvals', 'pending'],
    queryFn: () => templatesClient.queueApprovals({ status: 'pending', limit: 50 }),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['template-approvals'] });
  };

  const approve = useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      templatesClient.approveApproval(id, note),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (error) => setActionError(error),
  });

  const reject = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      templatesClient.rejectApproval(id, note),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (error) => setActionError(error),
  });

  const items = queue.data?.items ?? [];

  return (
    <>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          <h1 className="h4 mb-1">Review template</h1>
          <p className="text-muted small mb-0">
            Perubahan template harus disetujui akun approver sebelum dapat dipublish.
          </p>
        </div>
        <Badge bg="light" text="dark" className="fw-normal">
          {queue.data?.total ?? 0} menunggu
        </Badge>
      </div>

      {actionError !== null ? (
        <Alert variant="danger" className="py-2" dismissible onClose={() => setActionError(null)}>
          {describeError(actionError)}
        </Alert>
      ) : null}
      {queue.isError ? (
        <Alert variant="danger" className="py-2">
          {describeError(queue.error)}
        </Alert>
      ) : null}

      <Card>
        <Card.Body className="p-0">
          {items.length === 0 ? (
            <div className="p-4 text-muted small">Tidak ada permintaan review yang menunggu.</div>
          ) : (
            <Table responsive hover className="mb-0 align-middle">
              <thead>
                <tr>
                  <th>Template</th>
                  <th>Pengaju</th>
                  <th>Waktu</th>
                  <th>Status</th>
                  <th style={{ minWidth: '18rem' }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const isOwnRequest = item.requestedBy.adminId === session?.admin.id;
                  const note = notes[item.id] ?? '';

                  return (
                    <tr key={item.id}>
                      <td>
                        <div className="fw-semibold">{item.templateKey}</div>
                        <div className="small text-muted">
                          {item.channel} · {item.locale} · v{item.templateVersion} · rev{' '}
                          {item.revision}
                        </div>
                        {item.templateSubject !== null ? (
                          <div className="small">{item.templateSubject}</div>
                        ) : null}
                      </td>
                      <td className="small">{item.requestedBy.email}</td>
                      <td className="small text-muted">
                        {new Date(item.requestedAt).toLocaleString()}
                      </td>
                      <td>
                        <Badge bg={item.stale ? 'warning' : 'secondary'} text="dark">
                          {item.stale ? 'stale' : item.status}
                        </Badge>
                      </td>
                      <td>
                        <div className="d-flex flex-column gap-2">
                          <div className="d-flex gap-2 flex-wrap">
                            <Link
                              className="btn btn-sm btn-outline-secondary"
                              to={`/templates/${item.templateId}/compare`}
                            >
                              Bandingkan versi
                            </Link>
                            <Link
                              className="btn btn-sm btn-outline-secondary"
                              to={`/templates/${item.templateId}/edit`}
                            >
                              Lihat template
                            </Link>
                          </div>
                          {isApprover && !isOwnRequest ? (
                            <>
                              <Form.Control
                                size="sm"
                                placeholder="Catatan review (wajib untuk tolak)"
                                value={note}
                                maxLength={500}
                                onChange={(event) =>
                                  setNotes((current) => ({
                                    ...current,
                                    [item.id]: event.target.value,
                                  }))
                                }
                              />
                              <div className="d-flex gap-2">
                                <Button
                                  size="sm"
                                  variant="success"
                                  disabled={approve.isPending || reject.isPending || item.stale}
                                  onClick={() =>
                                    approve.mutate({
                                      id: item.id,
                                      ...(note.trim().length === 0 ? {} : { note: note.trim() }),
                                    })
                                  }
                                >
                                  Setujui
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline-danger"
                                  disabled={
                                    approve.isPending ||
                                    reject.isPending ||
                                    note.trim().length === 0 ||
                                    item.stale
                                  }
                                  onClick={() => reject.mutate({ id: item.id, note: note.trim() })}
                                >
                                  Tolak
                                </Button>
                              </div>
                            </>
                          ) : (
                            <span className="small text-muted">
                              {isOwnRequest
                                ? 'Menunggu approver lain.'
                                : 'Hanya approver yang dapat memproses.'}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
    </>
  );
}
