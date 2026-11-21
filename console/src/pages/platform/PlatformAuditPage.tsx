import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button, Card, Col, Form, Row } from 'react-bootstrap';
import { DataTable, type DataTableColumn } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { Pagination } from '../../components/Pagination';
import { QueryState } from '../../components/QueryState';
import { platformClient } from '../../lib/adminClient';
import { formatDateTime } from '../../lib/format';
import type { PlatformAuditEvent } from '@notifhub/js';

const PAGE_SIZE = 50;

const AUDIT_ACTIONS = [
  'tenant.created',
  'tenant.renamed',
  'tenant.suspended',
  'tenant.resumed',
  'tenant.deleted',
  'tenant.admin.created',
  'tenant.admin.updated',
  'tenant.admin.deactivated',
  'tenant.admin.password_reset',
] as const;

export function PlatformAuditPage(): JSX.Element {
  const [tenantIdInput, setTenantIdInput] = useState('');
  const [actionInput, setActionInput] = useState('');
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [filters, setFilters] = useState({
    tenantId: '',
    action: '',
    from: '',
    to: '',
  });
  const [offset, setOffset] = useState(0);

  const query = useQuery({
    queryKey: ['platform-audit', { ...filters, offset }],
    queryFn: () =>
      platformClient.listAuditEvents({
        ...(filters.tenantId === '' ? {} : { tenantId: filters.tenantId }),
        ...(filters.action === '' ? {} : { action: filters.action }),
        ...(filters.from === '' ? {} : { from: filters.from }),
        ...(filters.to === '' ? {} : { to: filters.to }),
        limit: PAGE_SIZE,
        offset,
      }),
  });

  const columns = useMemo<DataTableColumn<PlatformAuditEvent>[]>(
    () => [
      { id: 'occurredAt', header: 'Waktu', cell: (row) => formatDateTime(row.occurredAt) },
      { id: 'action', header: 'Aksi', cell: (row) => <code>{row.action}</code> },
      { id: 'tenantId', header: 'Tenant', cell: (row) => row.tenantId ?? '-' },
      { id: 'actor', header: 'Aktor', cell: (row) => row.actorEmail },
      {
        id: 'target',
        header: 'Target',
        cell: (row) => `${row.targetType}:${row.targetId}`,
      },
      { id: 'requestId', header: 'Request', cell: (row) => row.requestId ?? '-' },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Audit platform"
        subtitle="Jejak append-only untuk semua mutasi tenant, admin, dan status."
      />

      <Card className="filter-card mb-3">
        <Card.Body>
          <Form
            onSubmit={(event) => {
              event.preventDefault();
              setFilters({
                tenantId: tenantIdInput.trim(),
                action: actionInput,
                from: fromInput,
                to: toInput,
              });
              setOffset(0);
            }}
          >
            <Row className="g-2 align-items-end">
              <Col xs={12} md={3}>
                <Form.Label className="small text-muted mb-1">Tenant id</Form.Label>
                <Form.Control
                  value={tenantIdInput}
                  autoComplete="off"
                  placeholder="mis. acme"
                  onChange={(event) => setTenantIdInput(event.target.value)}
                />
              </Col>
              <Col xs={12} md={3}>
                <Form.Label className="small text-muted mb-1">Aksi</Form.Label>
                <Form.Select
                  value={actionInput}
                  onChange={(event) => setActionInput(event.target.value)}
                >
                  <option value="">Semua aksi</option>
                  {AUDIT_ACTIONS.map((action) => (
                    <option key={action} value={action}>
                      {action}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col xs={6} md={2}>
                <Form.Label className="small text-muted mb-1">Dari</Form.Label>
                <Form.Control
                  type="date"
                  value={fromInput}
                  onChange={(event) => setFromInput(event.target.value)}
                />
              </Col>
              <Col xs={6} md={2}>
                <Form.Label className="small text-muted mb-1">Sampai</Form.Label>
                <Form.Control
                  type="date"
                  value={toInput}
                  onChange={(event) => setToInput(event.target.value)}
                />
              </Col>
              <Col xs={12} md={2}>
                <Button type="submit" variant="outline-secondary" className="w-100">
                  Terapkan
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
              emptyMessage="Belum ada event audit untuk filter ini."
            />
            <Pagination
              total={query.data?.total ?? 0}
              limit={query.data?.limit ?? PAGE_SIZE}
              offset={offset}
              onChange={setOffset}
            />
          </QueryState>
        </Card.Body>
      </Card>
    </>
  );
}
