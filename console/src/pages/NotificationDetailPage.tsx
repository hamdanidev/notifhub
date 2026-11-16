import { useQuery } from '@tanstack/react-query';
import { Card, Col, Row, Table } from 'react-bootstrap';
import { Link, useParams } from 'react-router-dom';
import { ChannelBadge } from '../components/ChannelBadge';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { StatusBadge } from '../components/StatusBadge';
import { adminClient } from '../lib/adminClient';
import { asNumber, asString, formatDateTime } from '../lib/format';

export function NotificationDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();

  const query = useQuery({
    queryKey: ['notification', id],
    queryFn: () => adminClient.getNotification(id ?? ''),
    enabled: id !== undefined,
  });

  const notification = query.data?.notification ?? {};

  return (
    <>
      <PageHeader
        title="Notification detail"
        subtitle={id}
        actions={
          <Link to="/notifications" className="btn btn-sm btn-outline-secondary">
            Kembali
          </Link>
        }
      />

      <QueryState
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => {
          void query.refetch();
        }}
      >
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
            </Row>
          </Card.Body>
        </Card>

        <Card className="mb-3">
          <Card.Body>
            <Card.Title className="h6">Recipients</Card.Title>
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
                {(query.data?.recipients ?? []).map((recipient) => (
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
                ))}
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
                        <td className="small text-danger">{asString(attempt.errorName)}</td>
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
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </QueryState>
    </>
  );
}
