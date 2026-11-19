import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Form, Row } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { Pagination } from '../../components/Pagination';
import { QueryState } from '../../components/QueryState';
import { describeError, formatDateTime } from '../../lib/format';
import {
  createTenant,
  listTenants,
  resumeTenant,
  suspendTenant,
  type TenantStatus,
  type TenantSummary,
} from '../../lib/platformClient';

const PAGE_SIZE = 20;

export function PlatformTenantsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<TenantStatus | ''>('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [suspending, setSuspending] = useState<TenantSummary | null>(null);

  const query = useQuery({
    queryKey: ['platform-tenants', { status, q, offset }],
    queryFn: () =>
      listTenants({
        ...(status === '' ? {} : { status }),
        ...(q === '' ? {} : { q }),
        limit: PAGE_SIZE,
        offset,
      }),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['platform-tenants'] });
  };

  const create = useMutation({
    mutationFn: () => createTenant({ id: newId.trim(), name: newName.trim() }),
    onSuccess: (tenant) => {
      setCreatedId(tenant.id);
      setNewId('');
      setNewName('');
      invalidate();
    },
  });

  const suspend = useMutation({
    mutationFn: (tenant: TenantSummary) => suspendTenant(tenant.id),
    onSuccess: () => {
      setSuspending(null);
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['platform-tenant'] });
    },
  });

  const resume = useMutation({
    mutationFn: (tenant: TenantSummary) => resumeTenant(tenant.id),
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['platform-tenant'] });
    },
  });

  const columns = useMemo<DataTableColumn<TenantSummary>[]>(
    () => [
      {
        id: 'id',
        header: 'Tenant',
        cell: (row) => <Link to={`/platform/tenants/${row.id}`}>{row.id}</Link>,
      },
      { id: 'name', header: 'Nama', cell: (row) => row.name },
      {
        id: 'status',
        header: 'Status',
        cell: (row) => (
          <span
            className={`status ${row.status === 'active' ? 'status--sent' : 'status--failed'}`}
          >
            {row.status}
          </span>
        ),
      },
      { id: 'admins', header: 'Admin', cell: (row) => row.adminCount },
      { id: 'keys', header: 'API key', cell: (row) => row.apiKeyCount },
      { id: 'created', header: 'Dibuat', cell: (row) => formatDateTime(row.createdAt) },
      {
        id: 'actions',
        header: '',
        cell: (row) => (
          <div className="d-flex justify-content-end gap-2">
            <Link className="btn btn-sm btn-outline-secondary" to={`/platform/tenants/${row.id}`}>
              Detail
            </Link>
            {row.status === 'active' ? (
              <Button size="sm" variant="outline-warning" onClick={() => setSuspending(row)}>
                Suspend
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline-success"
                disabled={resume.isPending}
                onClick={() => resume.mutate(row)}
              >
                Resume
              </Button>
            )}
          </div>
        ),
      },
    ],
    [resume],
  );

  return (
    <>
      <PageHeader
        title="Tenants"
        subtitle="Provisioning dan status tenant. Semua mutasi tercatat di audit."
      />

      <Card className="filter-card mb-3">
        <Card.Body>
          <Card.Title className="h6">Buat tenant</Card.Title>

          {createdId !== null ? (
            <Alert variant="success" dismissible onClose={() => setCreatedId(null)}>
              Tenant <strong>{createdId}</strong> dibuat. Tenant id bersifat permanen; admin tenant
              pertama dapat ditambahkan dari halaman detail.
            </Alert>
          ) : null}

          {create.error !== null ? (
            <Alert variant="danger">{describeError(create.error)}</Alert>
          ) : null}

          <Form
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <Row className="g-2 align-items-end">
              <Col xs={12} md={4}>
                <Form.Label className="small text-muted mb-1">Tenant id</Form.Label>
                <Form.Control
                  value={newId}
                  autoComplete="off"
                  placeholder="mis. acme"
                  onChange={(event) => setNewId(event.target.value)}
                />
                <Form.Text className="text-muted">
                  Huruf kecil, angka, tanda hubung; tidak bisa diubah.
                </Form.Text>
              </Col>
              <Col xs={12} md={5}>
                <Form.Label className="small text-muted mb-1">Nama</Form.Label>
                <Form.Control
                  value={newName}
                  autoComplete="off"
                  placeholder="mis. Acme Corp"
                  onChange={(event) => setNewName(event.target.value)}
                />
              </Col>
              <Col xs={12} md={3}>
                <Button
                  type="submit"
                  className="w-100"
                  disabled={create.isPending || newId.trim() === '' || newName.trim() === ''}
                >
                  {create.isPending ? 'Membuat...' : 'Buat tenant'}
                </Button>
              </Col>
            </Row>
          </Form>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          <Form
            className="mb-3"
            onSubmit={(event) => {
              event.preventDefault();
              setQ(search.trim());
              setOffset(0);
            }}
          >
            <Row className="g-2 align-items-end">
              <Col xs={12} md={5}>
                <Form.Label className="small text-muted mb-1">Cari</Form.Label>
                <Form.Control
                  value={search}
                  placeholder="Tenant id atau nama"
                  onChange={(event) => setSearch(event.target.value)}
                />
              </Col>
              <Col xs={12} md={3}>
                <Form.Label className="small text-muted mb-1">Status</Form.Label>
                <Form.Select
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value as TenantStatus | '');
                    setOffset(0);
                  }}
                >
                  <option value="">Semua</option>
                  <option value="active">active</option>
                  <option value="suspended">suspended</option>
                </Form.Select>
              </Col>
              <Col xs={12} md={2}>
                <Button type="submit" variant="outline-secondary" className="w-100">
                  Terapkan
                </Button>
              </Col>
            </Row>
          </Form>

          {suspend.error !== null ? (
            <Alert variant="danger">{describeError(suspend.error)}</Alert>
          ) : null}
          {resume.error !== null ? (
            <Alert variant="danger">{describeError(resume.error)}</Alert>
          ) : null}

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
              emptyMessage="Belum ada tenant."
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

      <ConfirmDialog
        show={suspending !== null}
        title="Suspend tenant"
        body={`Tenant "${suspending?.id ?? ''}" akan menolak semua request baru (ingest, admin, subscriber) sampai di-resume. Data tidak dihapus.`}
        confirmLabel="Suspend"
        busy={suspend.isPending}
        onCancel={() => setSuspending(null)}
        onConfirm={() => {
          if (suspending !== null) {
            suspend.mutate(suspending);
          }
        }}
      />
    </>
  );
}
