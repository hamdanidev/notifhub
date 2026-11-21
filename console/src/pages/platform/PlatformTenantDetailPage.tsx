import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Form, Modal, Row } from 'react-bootstrap';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { platformClient } from '../../lib/platformApiClient';
import { describeError, formatDateTime } from '../../lib/format';
import type { TenantAdmin } from '@notifhub/js';

export function PlatformTenantDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const tenantId = id ?? '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [passwordTarget, setPasswordTarget] = useState<TenantAdmin | null>(null);
  const [passwordValue, setPasswordValue] = useState('');
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const tenant = useQuery({
    queryKey: ['platform-tenant', tenantId],
    queryFn: () => platformClient.getTenant(tenantId),
    enabled: tenantId.length > 0,
  });

  const admins = useQuery({
    queryKey: ['platform-tenant-admins', tenantId],
    queryFn: () => platformClient.listTenantAdmins(tenantId),
    enabled: tenantId.length > 0,
  });

  useEffect(() => {
    if (tenant.data !== undefined) {
      setName(tenant.data.name);
    }
  }, [tenant.data]);

  const invalidateTenant = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['platform-tenant', tenantId] });
    void queryClient.invalidateQueries({ queryKey: ['platform-tenants'] });
  };

  const invalidateAdmins = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['platform-tenant-admins', tenantId] });
  };

  const rename = useMutation({
    mutationFn: () => platformClient.renameTenant(tenantId, name.trim()),
    onSuccess: invalidateTenant,
  });

  const setStatus = useMutation({
    mutationFn: (action: 'suspend' | 'resume') =>
      action === 'suspend' ? platformClient.suspendTenant(tenantId) : platformClient.resumeTenant(tenantId),
    onSuccess: () => {
      setSuspendOpen(false);
      invalidateTenant();
    },
  });

  const createAdmin = useMutation({
    mutationFn: () =>
      platformClient.createTenantAdmin(tenantId, {
        email: adminEmail.trim(),
        password: adminPassword,
      }),
    onSuccess: () => {
      setAdminEmail('');
      setAdminPassword('');
      invalidateAdmins();
      invalidateTenant();
    },
  });

  const resetPassword = useMutation({
    mutationFn: () => {
      if (passwordTarget === null) {
        throw new Error('Tidak ada admin yang dipilih.');
      }

      return platformClient.updateTenantAdmin(tenantId, passwordTarget.id, { password: passwordValue });
    },
    onSuccess: () => {
      setPasswordTarget(null);
      setPasswordValue('');
      invalidateAdmins();
    },
  });

  const toggleAdmin = useMutation({
    mutationFn: (admin: TenantAdmin) =>
      platformClient.updateTenantAdmin(tenantId, admin.id, { active: !admin.active }),
    onSuccess: () => {
      invalidateAdmins();
      invalidateTenant();
    },
  });

  const remove = useMutation({
    mutationFn: () => platformClient.deleteTenant(tenantId),
    onSuccess: () => {
      setDeleteOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['platform-tenants'] });
      navigate('/platform/tenants', { replace: true });
    },
  });

  const adminColumns = useMemo<DataTableColumn<TenantAdmin>[]>(
    () => [
      { id: 'email', header: 'Email', cell: (row) => row.email },
      {
        id: 'active',
        header: 'Status',
        cell: (row) => (
          <span className={`status ${row.active ? 'status--sent' : 'status--skipped'}`}>
            {row.active ? 'active' : 'inactive'}
          </span>
        ),
      },
      { id: 'lastLogin', header: 'Login terakhir', cell: (row) => formatDateTime(row.lastLoginAt) },
      {
        id: 'actions',
        header: '',
        cell: (row) => (
          <div className="d-flex justify-content-end gap-2">
            <Button
              size="sm"
              variant="outline-secondary"
              onClick={() => {
                setPasswordTarget(row);
                setPasswordValue('');
              }}
            >
              Reset password
            </Button>
            <Button
              size="sm"
              variant={row.active ? 'outline-danger' : 'outline-success'}
              disabled={toggleAdmin.isPending}
              onClick={() => toggleAdmin.mutate(row)}
            >
              {row.active ? 'Nonaktifkan' : 'Aktifkan'}
            </Button>
          </div>
        ),
      },
    ],
    [toggleAdmin],
  );

  if (tenantId.length === 0) {
    return <Alert variant="danger">Tenant id tidak ada di URL.</Alert>;
  }

  const tenantData = tenant.data;
  const hasData =
    tenantData !== undefined && (tenantData.adminCount > 0 || tenantData.apiKeyCount > 0);

  return (
    <>
      <PageHeader
        title={`Tenant ${tenantId}`}
        subtitle="Detail tenant, status, dan akun admin tenant."
        actions={
          <Link className="btn btn-sm btn-outline-secondary" to="/platform/tenants">
            Kembali
          </Link>
        }
      />

      <QueryState
        isLoading={tenant.isLoading}
        error={tenant.error}
        skeleton="card"
        onRetry={() => {
          void tenant.refetch();
        }}
      >
        {tenantData !== undefined ? (
          <Card className="mb-3">
            <Card.Body>
              <Row className="g-3 align-items-center">
                <Col xs={12} md={5}>
                  <div className="text-muted small">Nama</div>
                  <div className="fw-semibold">{tenantData.name}</div>
                  <div className="text-muted small mt-2">
                    Dibuat {formatDateTime(tenantData.createdAt)} · {tenantData.adminCount} admin ·{' '}
                    {tenantData.apiKeyCount} API key
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="text-muted small">Status</div>
                  <span
                    className={`status ${
                      tenantData.status === 'active' ? 'status--sent' : 'status--failed'
                    }`}
                  >
                    {tenantData.status}
                  </span>
                  {tenantData.suspendedAt !== null ? (
                    <div className="text-muted small mt-1">
                      Sejak {formatDateTime(tenantData.suspendedAt)}
                    </div>
                  ) : null}
                </Col>
                <Col xs={12} md={3} className="text-md-end">
                  {tenantData.status === 'active' ? (
                    <Button variant="outline-warning" onClick={() => setSuspendOpen(true)}>
                      Suspend
                    </Button>
                  ) : (
                    <Button
                      variant="outline-success"
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate('resume')}
                    >
                      Resume
                    </Button>
                  )}
                </Col>
              </Row>
            </Card.Body>
          </Card>
        ) : null}
      </QueryState>

      {setStatus.error !== null ? (
        <Alert variant="danger">{describeError(setStatus.error)}</Alert>
      ) : null}

      <Row className="g-3">
        <Col xs={12} lg={4}>
          <Card>
            <Card.Body>
              <Card.Title className="h6">Ubah nama</Card.Title>
              {rename.error !== null ? (
                <Alert variant="danger">{describeError(rename.error)}</Alert>
              ) : null}
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  rename.mutate();
                }}
              >
                <Form.Group className="mb-2" controlId="tenant-name">
                  <Form.Label className="small text-muted mb-1">Nama tenant</Form.Label>
                  <Form.Control
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Form.Group>
                <Button
                  type="submit"
                  size="sm"
                  disabled={rename.isPending || name.trim() === '' || name === tenantData?.name}
                >
                  Simpan
                </Button>
              </Form>
            </Card.Body>
          </Card>

          <Card className="mt-3 border-danger">
            <Card.Body>
              <Card.Title className="h6 text-danger">Hapus tenant</Card.Title>
              <p className="small text-muted mb-2">
                Hanya tenant tanpa data (admin, API key, subscriber, notifikasi, template) yang
                dapat dihapus. Tenant <code>default</code> dilindungi.
              </p>
              <Button
                variant="outline-danger"
                size="sm"
                disabled={hasData}
                onClick={() => setDeleteOpen(true)}
              >
                Hapus tenant
              </Button>
              {hasData ? (
                <div className="small text-muted mt-2">
                  Tenant masih punya data; gunakan Suspend.
                </div>
              ) : null}
              {remove.error !== null ? (
                <Alert variant="danger" className="mt-2 mb-0">
                  {describeError(remove.error)}
                </Alert>
              ) : null}
            </Card.Body>
          </Card>
        </Col>

        <Col xs={12} lg={8}>
          <Card className="mb-3">
            <Card.Body>
              <Card.Title className="h6">Tambah admin tenant</Card.Title>
              {createAdmin.error !== null ? (
                <Alert variant="danger">{describeError(createAdmin.error)}</Alert>
              ) : null}
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  createAdmin.mutate();
                }}
              >
                <Row className="g-2 align-items-end">
                  <Col xs={12} md={5}>
                    <Form.Label className="small text-muted mb-1">Email</Form.Label>
                    <Form.Control
                      type="email"
                      autoComplete="off"
                      value={adminEmail}
                      onChange={(event) => setAdminEmail(event.target.value)}
                    />
                  </Col>
                  <Col xs={12} md={4}>
                    <Form.Label className="small text-muted mb-1">Password awal</Form.Label>
                    <Form.Control
                      type="password"
                      autoComplete="new-password"
                      value={adminPassword}
                      onChange={(event) => setAdminPassword(event.target.value)}
                    />
                  </Col>
                  <Col xs={12} md={3}>
                    <Button
                      type="submit"
                      className="w-100"
                      disabled={
                        createAdmin.isPending ||
                        adminEmail.trim() === '' ||
                        adminPassword.length < 8
                      }
                    >
                      Tambah
                    </Button>
                  </Col>
                </Row>
                <Form.Text className="text-muted">
                  Serahkan password lewat kanal aman; belum ada undangan email.
                </Form.Text>
              </Form>
            </Card.Body>
          </Card>

          <Card>
            <Card.Body>
              {toggleAdmin.error !== null ? (
                <Alert variant="danger">{describeError(toggleAdmin.error)}</Alert>
              ) : null}
              <QueryState
                isLoading={admins.isLoading}
                error={admins.error}
                skeleton="table"
                onRetry={() => {
                  void admins.refetch();
                }}
              >
                <DataTable
                  columns={adminColumns}
                  rows={admins.data ?? []}
                  rowKey={(row) => row.id}
                  emptyMessage="Belum ada admin tenant."
                />
              </QueryState>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <ConfirmDialog
        show={suspendOpen}
        title="Suspend tenant"
        body="Semua request baru untuk tenant ini akan ditolak sampai di-resume. Data tetap tersimpan dan job yang sudah antre tetap diproses."
        confirmLabel="Suspend"
        busy={setStatus.isPending}
        onCancel={() => setSuspendOpen(false)}
        onConfirm={() => setStatus.mutate('suspend')}
      />

      <ConfirmDialog
        show={deleteOpen}
        title="Hapus tenant"
        body={`Tenant "${tenantId}" akan dihapus permanen. Aksi ini tidak dapat dibatalkan.`}
        confirmLabel="Hapus"
        busy={remove.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => remove.mutate()}
      />

      <Modal
        show={passwordTarget !== null}
        onHide={() => setPasswordTarget(null)}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title className="h6 mb-0">Reset password</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="small text-muted">
            Password baru untuk <strong>{passwordTarget?.email ?? ''}</strong>.
          </p>
          <Form.Control
            type="password"
            autoComplete="new-password"
            value={passwordValue}
            placeholder="Minimal 8 karakter"
            onChange={(event) => setPasswordValue(event.target.value)}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="outline-secondary"
            onClick={() => setPasswordTarget(null)}
            disabled={resetPassword.isPending}
          >
            Batal
          </Button>
          <Button
            variant="primary"
            disabled={resetPassword.isPending || passwordValue.length < 8}
            onClick={() => resetPassword.mutate()}
          >
            {resetPassword.isPending ? 'Menyimpan...' : 'Simpan'}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
