import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Card, Col, Form, Row, Table } from 'react-bootstrap';
import { Link, useParams } from 'react-router-dom';
import { ChannelBadge } from '../components/ChannelBadge';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { RefreshControl } from '../components/RefreshControl';
import { ResendFailedDialog } from '../components/ResendFailedDialog';
import { StatusBadge } from '../components/StatusBadge';
import { adminClient } from '../lib/adminClient';
import {
  resendFailedNotification,
  type ResendFailedResult,
} from '../lib/adminResend';
import { asNumber, asString, describeError, formatDateTime } from '../lib/format';

const AUTO_REFRESH_MS = 5_000;
const RECIPIENT_STATUSES = ['', 'pending', 'sent', 'failed', 'read', 'skipped'];

function isInFlightStatus(status: unknown): boolean {
  return status === 'pending' || status === 'partial';
}

function jsonText(value: unknown): string {
  if (value === undefined || value === null) {
    return '—';
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function NotificationDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [recipientStatus, setRecipientStatus] = useState('');
  const [resendOpen, setResendOpen] = useState(false);
  const [resendRequestKey, setResendRequestKey] = useState('');
  const [resendResult, setResendResult] = useState<ResendFailedResult | null>(null);

  const query = useQuery({
    queryKey: ['notification', id],
    queryFn: () => adminClient.getNotification(id ?? ''),
    enabled: id !== undefined,
    refetchInterval: (current) => {
      const status = current.state.data?.notification.overallStatus;
      return isInFlightStatus(status) ? AUTO_REFRESH_MS : false;
    },
  });

  const notification = query.data?.notification ?? {};
  const inFlight = isInFlightStatus(notification.overallStatus);
  const allRecipients = query.data?.recipients ?? [];
  const recipients =
    recipientStatus === ''
      ? allRecipients
      : allRecipients.filter((recipient) => asString(recipient.status) === recipientStatus);
  const failedRecipients = allRecipients.filter(
    (recipient) =>
      asString(recipient.status) === 'failed' && asString(recipient.channel) !== 'sms',
  );
  const failedChannels = [
    ...new Set(failedRecipients.map((recipient) => asString(recipient.channel))),
  ];
  const resendOf = asString(notification.resendOfNotificationId, '');
  const resendMode = asString(notification.resendMode, '');
  const isDeleted = notification.deletedAt !== null && notification.deletedAt !== undefined;

  const resend = useMutation({
    mutationFn: (input: { notificationId: string; requestKey: string }) =>
      resendFailedNotification(input.notificationId, input.requestKey),
    onSuccess: (result) => {
      setResendOpen(false);
      setResendResult(result);
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['notification', id] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const openResend = (): void => {
    if (id === undefined || failedRecipients.length === 0) {
      return;
    }

    setResendRequestKey(crypto.randomUUID());
    setResendResult(null);
    resend.reset();
    setResendOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Notification detail"
        subtitle={id}
        actions={
          <>
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={openResend}
              disabled={
                query.isLoading || resend.isPending || failedRecipients.length === 0 || isDeleted
              }
              title={
                isDeleted
                  ? 'Notification sudah dihapus'
                  : failedRecipients.length === 0
                    ? 'Tidak ada recipient/channel gagal'
                    : undefined
              }
            >
              Kirim ulang yang gagal ({failedRecipients.length})
            </Button>
            <RefreshControl
              isFetching={query.isFetching}
              updatedAt={query.dataUpdatedAt}
              autoRefreshMs={inFlight ? AUTO_REFRESH_MS : undefined}
              onRefresh={() => {
                void query.refetch();
              }}
            />
            <Link to="/notifications" className="btn btn-sm btn-outline-secondary">
              Kembali
            </Link>
          </>
        }
      />

      <QueryState
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => {
          void query.refetch();
        }}
      >
        {resendResult !== null ? (
          <Alert variant="success">
            <div className="fw-semibold mb-1">Pengiriman ulang diterima.</div>
            <div className="small">
              Notification baru:{' '}
              <Link to={`/notifications/${resendResult.notification_id}`}>
                {resendResult.notification_id}
              </Link>{' '}
              · {resendResult.recipient_count} recipient/channel · mode {resendResult.mode}
            </div>
          </Alert>
        ) : null}

        <Card className="mb-3">
          <Card.Body>
            <Row className="g-3">
              <Col xs={12} md={6} lg={3}>
                <div className="small text-muted">Status</div>
                <StatusBadge status={asString(notification.overallStatus, 'pending')} />
              </Col>
              <Col xs={12} md={6} lg={3}>
                <div className="small text-muted">Template</div>
                {asString(notification.templateKey)}
              </Col>
              <Col xs={12} md={6} lg={3}>
                <div className="small text-muted">Priority</div>
                {asNumber(notification.priority)}
              </Col>
              <Col xs={12} md={6} lg={3}>
                <div className="small text-muted">Target</div>
                {asString(notification.targetType)}
              </Col>
              <Col xs={12} md={6} lg={3}>
                <div className="small text-muted">Dibuat</div>
                {formatDateTime(notification.createdAt)}
              </Col>
              <Col xs={12} md={6} lg={3}>
                <div className="small text-muted">Diperbarui</div>
                {formatDateTime(notification.updatedAt)}
              </Col>
              <Col xs={12} md={6} lg={3}>
                <div className="small text-muted">Deleted at</div>
                {formatDateTime(notification.deletedAt)}
              </Col>
              <Col xs={12} md={6} lg={3}>
                <div className="small text-muted">Tenant</div>
                {asString(notification.tenantId)}
              </Col>
              {resendOf !== '' ? (
                <Col xs={12} md={6} lg={3}>
                  <div className="small text-muted">Resend dari</div>
                  <Link to={`/notifications/${resendOf}`}>
                    {resendOf}
                    {resendMode !== '' ? ` (${resendMode})` : ''}
                  </Link>
                </Col>
              ) : null}
            </Row>
          </Card.Body>
        </Card>

        <Row className="g-3 mb-3">
          <Col xs={12} lg={6}>
            <Card className="h-100">
              <Card.Body>
                <Card.Title className="h6">Target snapshot</Card.Title>
                <pre className="json-block">{jsonText(notification.targetSnapshot)}</pre>
              </Card.Body>
            </Card>
          </Col>
          <Col xs={12} lg={6}>
            <Card className="h-100">
              <Card.Body>
                <Card.Title className="h6">Payload</Card.Title>
                <pre className="json-block">{jsonText(notification.payload)}</pre>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        <Card className="mb-3">
          <Card.Body>
            <div className="section-heading">
              <Card.Title className="h6 mb-0">
                Recipients ({recipients.length}/{allRecipients.length})
              </Card.Title>
              <Form.Select
                size="sm"
                className="recipient-filter"
                aria-label="Filter status recipient"
                value={recipientStatus}
                onChange={(event) => setRecipientStatus(event.target.value)}
              >
                {RECIPIENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status === '' ? 'Semua status' : status}
                  </option>
                ))}
              </Form.Select>
            </div>
            <Table hover responsive size="sm" className="mb-0">
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Provider</th>
                  <th>Sent</th>
                  <th>Delivered</th>
                  <th>Read</th>
                  <th>Last error</th>
                </tr>
              </thead>
              <tbody>
                {recipients.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center text-muted py-4">
                      Tidak ada recipient dengan status ini.
                    </td>
                  </tr>
                ) : (
                  recipients.map((recipient) => (
                    <tr key={asString(recipient.id)}>
                      <td>{asString(recipient.recipientId)}</td>
                      <td>
                        <ChannelBadge channel={asString(recipient.channel)} />
                      </td>
                      <td>
                        <StatusBadge status={asString(recipient.status)} />
                      </td>
                      <td>{asNumber(recipient.attempts)}</td>
                      <td>{asString(recipient.providerName)}</td>
                      <td>{formatDateTime(recipient.sentAt)}</td>
                      <td>{formatDateTime(recipient.deliveredAt)}</td>
                      <td>{formatDateTime(recipient.readAt)}</td>
                      <td className="small text-danger">{asString(recipient.lastError)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </Card.Body>
        </Card>

        <Row className="g-3">
          <Col xs={12} lg={6}>
            <Card className="h-100">
              <Card.Body>
                <Card.Title className="h6">Delivery attempts (20 terakhir)</Card.Title>
                <Table hover responsive size="sm" className="mb-0">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Provider</th>
                      <th>Status</th>
                      <th>Duration</th>
                      <th>Waktu</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(query.data?.deliveryAttempts ?? []).map((attempt) => (
                      <tr key={asString(attempt.id)}>
                        <td>{asNumber(attempt.attemptNumber)}</td>
                        <td>{asString(attempt.providerName)}</td>
                        <td>
                          <StatusBadge status={asString(attempt.status)} />
                        </td>
                        <td>{asNumber(attempt.durationMs)} ms</td>
                        <td>{formatDateTime(attempt.occurredAt)}</td>
                        <td className="small text-danger">
                          <div>{asString(attempt.errorName)}</div>
                          {asString(attempt.errorMessage, '') !== '' ? (
                            <div>{asString(attempt.errorMessage)}</div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          </Col>
          <Col xs={12} lg={6}>
            <Card className="h-100">
              <Card.Body>
                <Card.Title className="h6">Delivery events (20 terakhir)</Card.Title>
                <Table hover responsive size="sm" className="mb-0">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Provider</th>
                      <th>Channel</th>
                      <th>Waktu</th>
                      <th>Payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(query.data?.deliveryEvents ?? []).map((event) => (
                      <tr key={asString(event.id)}>
                        <td>{asString(event.eventType)}</td>
                        <td>{asString(event.providerName)}</td>
                        <td>
                          <ChannelBadge channel={asString(event.channel)} />
                        </td>
                        <td>{formatDateTime(event.occurredAt)}</td>
                        <td>
                          <details>
                            <summary className="small">Lihat</summary>
                            <pre className="json-block json-block--inline">
                              {jsonText(event.rawPayload)}
                            </pre>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </QueryState>

      <ResendFailedDialog
        show={resendOpen}
        recipientCount={failedRecipients.length}
        channels={failedChannels}
        busy={resend.isPending}
        error={resend.error === null ? null : describeError(resend.error)}
        onCancel={() => {
          if (!resend.isPending) {
            setResendOpen(false);
          }
        }}
        onConfirm={() => {
          if (id !== undefined && resendRequestKey !== '') {
            resend.mutate({ notificationId: id, requestKey: resendRequestKey });
          }
        }}
      />
    </>
  );
}
