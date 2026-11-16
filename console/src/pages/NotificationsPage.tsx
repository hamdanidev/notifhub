import type { NotificationSummary, OverallStatus } from '@notifhub/js';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button, Card, Col, Form, Row } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Pagination } from '../components/Pagination';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { RefreshControl } from '../components/RefreshControl';
import { StatusBadge } from '../components/StatusBadge';
import { adminClient } from '../lib/adminClient';
import { formatDateTime } from '../lib/format';

const LIMIT = 20;
const AUTO_REFRESH_MS = 5_000;
const STATUS_OPTIONS: Array<OverallStatus | ''> = ['', 'pending', 'partial', 'sent', 'failed'];

function hasInFlight(items: NotificationSummary[]): boolean {
  return items.some((item) => item.overallStatus === 'pending' || item.overallStatus === 'partial');
}

export function NotificationsPage(): JSX.Element {
  const [status, setStatus] = useState<OverallStatus | ''>('');
  const [templateKey, setTemplateKey] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);

  const query = useQuery({
    queryKey: ['notifications', { status, templateKey, from, to, offset }],
    queryFn: () =>
      adminClient.listNotifications({
        limit: LIMIT,
        offset,
        ...(status === '' ? {} : { status }),
        ...(templateKey === '' ? {} : { templateKey }),
        ...(from === '' ? {} : { from: `${from}T00:00:00.000Z` }),
        ...(to === '' ? {} : { to: `${to}T23:59:59.999Z` }),
      }),
    refetchInterval: (current) =>
      hasInFlight(current.state.data?.items ?? []) ? AUTO_REFRESH_MS : false,
  });

  const autoRefreshMs = hasInFlight(query.data?.items ?? []) ? AUTO_REFRESH_MS : undefined;

  const columns = useMemo<DataTableColumn<NotificationSummary>[]>(
    () => [
      { id: 'createdAt', header: 'Dibuat', cell: (row) => formatDateTime(row.createdAt) },
      { id: 'template', header: 'Template', cell: (row) => row.templateKey },
      {
        id: 'status',
        header: 'Status',
        cell: (row) => <StatusBadge status={row.overallStatus} />,
      },
      { id: 'priority', header: 'Priority', cell: (row) => row.priority },
      { id: 'target', header: 'Target', cell: (row) => row.targetType },
      {
        id: 'recipients',
        header: 'Penerima',
        cell: (row) =>
          `${row.recipientCount} (sent ${row.sentCount} / failed ${row.failedCount} / pending ${row.pendingCount})`,
      },
      {
        id: 'actions',
        header: '',
        cell: (row) => (
          <Link to={`/notifications/${row.id}`} className="btn btn-sm btn-outline-primary">
            Detail
          </Link>
        ),
      },
    ],
    [],
  );

  const resetFilters = (): void => {
    setStatus('');
    setTemplateKey('');
    setFrom('');
    setTo('');
    setOffset(0);
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Semua notifikasi tenant ini."
        actions={
          <RefreshControl
            isFetching={query.isFetching}
            updatedAt={query.dataUpdatedAt}
            autoRefreshMs={autoRefreshMs}
            onRefresh={() => {
              void query.refetch();
            }}
          />
        }
      />

      <Card className="filter-card mb-3">
        <Card.Body>
          <Row className="g-2 align-items-end">
            <Col xs={12} md={3}>
              <Form.Label className="small text-muted mb-1">Status</Form.Label>
              <Form.Select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as OverallStatus | '');
                  setOffset(0);
                }}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option === '' ? 'Semua' : option}
                  </option>
                ))}
              </Form.Select>
            </Col>
            <Col xs={12} md={3}>
              <Form.Label className="small text-muted mb-1">Template key</Form.Label>
              <Form.Control
                value={templateKey}
                placeholder="mis. test.notification"
                onChange={(event) => {
                  setTemplateKey(event.target.value);
                  setOffset(0);
                }}
              />
            </Col>
            <Col xs={6} md={2}>
              <Form.Label className="small text-muted mb-1">Dari</Form.Label>
              <Form.Control
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setOffset(0);
                }}
              />
            </Col>
            <Col xs={6} md={2}>
              <Form.Label className="small text-muted mb-1">Sampai</Form.Label>
              <Form.Control
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  setOffset(0);
                }}
              />
            </Col>
            <Col xs={12} md={2}>
              <Button variant="outline-secondary" className="w-100" onClick={resetFilters}>
                Reset
              </Button>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          <QueryState
            isLoading={query.isLoading}
            error={query.error}
            skeleton="table"
            onRetry={() => {
              void query.refetch();
            }}
          >
            <DataTable
              columns={columns}
              rows={query.data?.items ?? []}
              rowKey={(row) => row.id}
              emptyMessage="Belum ada notifikasi."
            />
            <Pagination
              total={query.data?.total ?? 0}
              limit={LIMIT}
              offset={offset}
              onChange={setOffset}
            />
          </QueryState>
        </Card.Body>
      </Card>
    </>
  );
}
