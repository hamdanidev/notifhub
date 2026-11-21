import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Card, Col, Row, Spinner } from 'react-bootstrap';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { TemplateStatusBadge } from '../components/TemplateStatusBadge';
import { templatesClient } from '../lib/adminClient';
import { describeError, formatDateTime } from '../lib/format';
import type { TemplateSummary } from '@notifhub/js';

export function TemplateHistoryPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [rollbackTarget, setRollbackTarget] = useState<TemplateSummary | null>(null);

  const versions = useQuery({
    queryKey: ['template-versions', id],
    queryFn: () => templatesClient.listTemplateVersions(id ?? ''),
    enabled: id !== undefined,
  });
  const audit = useQuery({
    queryKey: ['template-audit', id],
    queryFn: () => templatesClient.listTemplateAudit(id ?? '', 100, 0),
    enabled: id !== undefined,
  });
  const testSends = useQuery({
    queryKey: ['template-test-sends', id],
    queryFn: () => templatesClient.listTemplateTestSends(id ?? '', 50, 0),
    enabled: id !== undefined,
  });

  const rollback = useMutation({
    mutationFn: (sourceVersion: number) => templatesClient.rollbackTemplate(id ?? '', sourceVersion),
    onSuccess: (result) => {
      setRollbackTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
      void queryClient.invalidateQueries({ queryKey: ['template-versions', id] });
      navigate(`/templates/${result.id}/edit`);
    },
  });

  return (
    <>
      <PageHeader
        title="Riwayat template"
        subtitle="Versi, audit perubahan, dan test send."
        actions={
          <>
            <Link to={`/templates/${id ?? ''}/edit`} className="btn btn-sm btn-outline-secondary">
              Kembali ke editor
            </Link>
            <Link to="/templates" className="btn btn-sm btn-outline-secondary">
              Daftar template
            </Link>
          </>
        }
      />

      {rollback.error !== null ? (
        <Alert variant="danger">{describeError(rollback.error)}</Alert>
      ) : null}

      <Row className="g-3">
        <Col xl={7}>
          <Card>
            <Card.Header className="small fw-semibold">Versi</Card.Header>
            <Card.Body>
              <QueryState
                isLoading={versions.isLoading}
                error={versions.error}
                skeleton="table"
                onRetry={() => void versions.refetch()}
              >
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Versi</th>
                        <th>Status</th>
                        <th>Aktif</th>
                        <th>Revision</th>
                        <th>Published</th>
                        <th>Diperbarui</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {(versions.data ?? []).map((version) => (
                        <tr key={version.id}>
                          <td>{version.version}</td>
                          <td><TemplateStatusBadge status={version.status} /></td>
                          <td>{version.active ? 'ya' : 'tidak'}</td>
                          <td>{version.revision}</td>
                          <td>{formatDateTime(version.publishedAt)}</td>
                          <td>{formatDateTime(version.updatedAt)}</td>
                          <td className="text-end">
                            <div className="d-flex gap-1 justify-content-end">
                              <Link
                                to={`/templates/${version.id}/edit`}
                                className="btn btn-sm btn-outline-secondary"
                              >
                                Lihat
                              </Link>
                              <Button
                                size="sm"
                                variant="outline-primary"
                                onClick={() => setRollbackTarget(version)}
                              >
                                Rollback
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </QueryState>
            </Card.Body>
          </Card>

          <Card className="mt-3">
            <Card.Header className="small fw-semibold">Test send</Card.Header>
            <Card.Body>
              <QueryState
                isLoading={testSends.isLoading}
                error={testSends.error}
                skeleton="lines"
                onRetry={() => void testSends.refetch()}
              >
                {(testSends.data?.items ?? []).length === 0 ? (
                  <p className="small text-muted mb-0">Belum ada test send.</p>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-sm align-middle mb-0">
                      <thead>
                        <tr>
                          <th>Waktu</th>
                          <th>Channel</th>
                          <th>Penerima</th>
                          <th>Status</th>
                          <th>Provider</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(testSends.data?.items ?? []).map((item) => (
                          <tr key={item.id}>
                            <td>{formatDateTime(item.createdAt)}</td>
                            <td>{item.channel}</td>
                            <td>{item.recipientMasked}</td>
                            <td>{item.status}</td>
                            <td>{item.providerName ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </QueryState>
            </Card.Body>
          </Card>
        </Col>

        <Col xl={5}>
          <Card>
            <Card.Header className="small fw-semibold">Audit</Card.Header>
            <Card.Body>
              <QueryState
                isLoading={audit.isLoading}
                error={audit.error}
                skeleton="lines"
                onRetry={() => void audit.refetch()}
              >
                {(audit.data?.items ?? []).length === 0 ? (
                  <p className="small text-muted mb-0">Belum ada audit.</p>
                ) : (
                  <ol className="audit-timeline mb-0">
                    {(audit.data?.items ?? []).map((event) => (
                      <li key={event.id}>
                        <div className="d-flex justify-content-between gap-2">
                          <strong className="small">{event.action}</strong>
                          <span className="small text-muted">{formatDateTime(event.createdAt)}</span>
                        </div>
                        <div className="small text-muted">
                          versi {event.templateVersion}
                          {event.actorEmail !== null ? ` · ${event.actorEmail}` : ''}
                        </div>
                        {event.note !== null ? <div className="small">{event.note}</div> : null}
                      </li>
                    ))}
                  </ol>
                )}
              </QueryState>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <ConfirmDialog
        show={rollbackTarget !== null}
        title="Rollback ke versi ini"
        body={`Versi ${rollbackTarget?.version ?? ''} akan disalin menjadi draft baru. Publish tetap dilakukan terpisah agar ada preview dan audit.`}
        confirmLabel="Buat draft rollback"
        busy={rollback.isPending}
        onCancel={() => setRollbackTarget(null)}
        onConfirm={() => {
          if (rollbackTarget !== null) {
            rollback.mutate(rollbackTarget.version);
          }
        }}
      />
    </>
  );
}
