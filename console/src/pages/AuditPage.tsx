import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button, Card, Col, Form, Row } from 'react-bootstrap';
import type { AdminAuditEvent } from '@notifhub/js';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { QueryState } from '../components/QueryState';
import { RefreshControl } from '../components/RefreshControl';
import { adminClient } from '../lib/adminClient';
import { formatDateTime } from '../lib/format';

const LIMIT = 50;

function metadataText(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function AuditPage(): JSX.Element {
  const [actionInput, setActionInput] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);

  const query = useQuery({
    queryKey: ['admin-audit', { action, from, to, offset }],
    queryFn: () =>
      adminClient.listAudit({
        limit: LIMIT,
        offset,
        ...(action === '' ? {} : { action }),
        ...(from === '' ? {} : { from: `${from}T00:00:00.000Z` }),
        ...(to === '' ? {} : { to: `${to}T23:59:59.999Z` }),
      }),
  });

  const columns = useMemo<DataTableColumn<AdminAuditEvent>[]>(
    () => [
      {
        id: 'occurredAt',
        header: 'Waktu',
        cell: (row) => formatDateTime(row.occurredAt),
      },
      {
        id: 'actor',
        header: 'Actor',
        cell: (row) => <span title={row.actorAdminId}>{row.actorEmail}</span>,
      },
      {
        id: 'action',
        header: 'Action',
        cell: (row) => <code>{row.action}</code>,
      },
      {
        id: 'target',
        header: 'Target',
        cell: (row) => (
          <span title={row.targetId}>
            {row.targetType}: {row.targetId}
          </span>
        ),
      },
      {
        id: 'metadata',
        header: 'Metadata',
        cell: (row) => (
          <details>
            <summary className="small">Lihat</summary>
            <pre className="json-block json-block--inline">{metadataText(row.metadata)}</pre>
          </details>
        ),
      },
    ],
    [],
  );

  const resetFilters = (): void => {
    setActionInput('');
    setAction('');
    setFrom('');
    setTo('');
    setOffset(0);
  };

  return (
    <>
      <PageHeader
        title="Audit"
        subtitle="Jejak aksi admin tenant ini (append-only)."
        actions={
          <RefreshControl
            isFetching={query.isFetching}
            updatedAt={query.dataUpdatedAt}
            onRefresh={() => {
              void query.refetch();
            }}
          />
        }
      />

      <Card className="filter-card mb-3">
        <Card.Body>
          <Form
            onSubmit={(event) => {
              event.preventDefault();
              setAction(actionInput.trim());
              setOffset(0);
            }}
          >
            <Row className="g-2 align-items-end">
              <Col xs={12} md={4}>
                <Form.Label className="small text-muted mb-1">Action</Form.Label>
                <div className="d-flex gap-2">
                  <Form.Control
                    value={actionInput}
                    maxLength={80}
                    placeholder="mis. admin.template.published"
                    onChange={(event) => setActionInput(event.target.value)}
                  />
                  <Button type="submit" variant="outline-primary">
                    Cari
                  </Button>
                </div>
              </Col>
              <Col xs={6} md={3}>
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
              <Col xs={6} md={3}>
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
                <Button type="button" variant="outline-secondary" className="w-100" onClick={resetFilters}>
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
                action === ''
                  ? 'Belum ada audit event.'
                  : 'Tidak ada audit event untuk action tersebut.'
              }
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
