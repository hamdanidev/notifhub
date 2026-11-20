import type { NotificationSummary, OverallStatus } from '@notifhub/js';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Form, Row } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Pagination } from '../components/Pagination';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { RefreshControl } from '../components/RefreshControl';
import { StatusBadge } from '../components/StatusBadge';
import { adminClient } from '../lib/adminClient';
import {
  downloadCsv,
  exportFileName,
  exportNotifications,
  notificationsToCsv,
} from '../lib/adminExport';
import { describeError, formatDateTime } from '../lib/format';

const LIMIT_OPTIONS = [20, 50, 100] as const;
const AUTO_REFRESH_MS = 5_000;
const STATUS_OPTIONS: Array<OverallStatus | ''> = ['', 'pending', 'partial', 'sent', 'failed'];

function hasInFlight(items: NotificationSummary[]): boolean {
  return items.some((item) => item.overallStatus === 'pending' || item.overallStatus === 'partial');
}

export function NotificationsPage(): JSX.Element {
  const [status, setStatus] = useState<OverallStatus | ''>('');
  const [templateKey, setTemplateKey] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState<number>(LIMIT_OPTIONS[0]);
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['notifications', { status, templateKey, search, from, to, limit, offset }],
    queryFn: () =>
      adminClient.listNotifications({
        limit,
        offset,
        ...(status === '' ? {} : { status }),
        ...(templateKey === '' ? {} : { templateKey }),
        ...(search === '' ? {} : { search }),
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
    setSearchInput('');
    setSearch('');
    setFrom('');
    setTo('');
    setOffset(0);
  };

  const handleExport = async (): Promise<void> => {
    setExportError(null);
    setExportNotice(null);
    setExporting(true);

    try {
      const result = await exportNotifications({
        limit: 5_000,
        ...(status === '' ? {} : { status }),
        ...(templateKey === '' ? {} : { templateKey }),
        ...(search === '' ? {} : { search }),
        ...(from === '' ? {} : { from: `${from}T00:00:00.000Z` }),
        ...(to === '' ? {} : { to: `${to}T23:59:59.999Z` }),
      });

      downloadCsv(exportFileName(), notificationsToCsv(result.items));

      setExportNotice(
        result.truncated
          ? `Diekspor ${result.items.length} dari ${result.total} baris (batas 5.000). Persempit filter untuk data lengkap.`
          : `Diekspor ${result.items.length} baris.`,
      );
    } catch (caught: unknown) {
      setExportError(describeError(caught));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Semua notifikasi tenant ini."
        actions={
          <>
            <Link to="/notifications/new" className="btn btn-sm btn-primary">
              Kirim notifikasi
            </Link>
            <Button
              type="button"
              size="sm"
              variant="outline-secondary"
              onClick={() => {
                void handleExport();
              }}
              disabled={exporting}
            >
              {exporting ? 'Menyiapkan…' : 'Export CSV'}
            </Button>
            <RefreshControl
              isFetching={query.isFetching}
              updatedAt={query.dataUpdatedAt}
              autoRefreshMs={autoRefreshMs}
              onRefresh={() => {
                void query.refetch();
              }}
            />
          </>
        }
      />

      {exportError !== null ? <Alert variant="danger">{exportError}</Alert> : null}
      {exportNotice !== null ? <Alert variant="info">{exportNotice}</Alert> : null}

      <Card className="filter-card mb-3">
        <Card.Body>
          <Form
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(searchInput.trim());
              setOffset(0);
            }}
          >
            <Row className="g-2 align-items-end">
              <Col xs={12} md={4}>
                <Form.Label className="small text-muted mb-1">
                  Cari ID notifikasi atau recipient (exact)
                </Form.Label>
                <div className="d-flex gap-2">
                  <Form.Control
                    value={searchInput}
                    maxLength={128}
                    placeholder="UUID notifikasi atau recipient ID"
                    onChange={(event) => setSearchInput(event.target.value)}
                  />
                  <Button type="submit" variant="outline-primary">
                    Cari
                  </Button>
                </div>
              </Col>
              <Col xs={12} md={2}>
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
              <Col xs={12} md={2}>
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
              <Col xs={6} md={1}>
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
              <Col xs={6} md={1}>
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
              <Col xs={6} md={1}>
                <Form.Label className="small text-muted mb-1">Baris</Form.Label>
                <Form.Select
                  value={limit}
                  onChange={(event) => {
                    setLimit(Number(event.target.value));
                    setOffset(0);
                  }}
                >
                  {LIMIT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col xs={6} md={1}>
                <Button
                  type="button"
                  variant="outline-secondary"
                  className="w-100"
                  onClick={resetFilters}
                >
                  Reset
                </Button>
              </Col>
            </Row>
          </Form>
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
              emptyMessage={
                search === ''
                  ? 'Belum ada notifikasi.'
                  : 'Tidak ada notifikasi yang cocok dengan ID/recipient tersebut.'
              }
            />
            <Pagination
              total={query.data?.total ?? 0}
              limit={limit}
              offset={offset}
              onChange={setOffset}
            />
          </QueryState>
        </Card.Body>
      </Card>
    </>
  );
}
