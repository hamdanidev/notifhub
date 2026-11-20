import type { ApiKeySummary } from '@notifhub/js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Form, Row } from 'react-bootstrap';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { RefreshControl } from '../components/RefreshControl';
import { adminClient } from '../lib/adminClient';
import { describeError, formatDateTime } from '../lib/format';

export function ApiKeysPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [origins, setOrigins] = useState('');
  const [subscriberJwtSecret, setSubscriberJwtSecret] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<ApiKeySummary | null>(null);

  const query = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => adminClient.listApiKeys(),
  });

  const create = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();

      if (trimmed.length === 0) {
        throw new Error('Nama API key wajib diisi.');
      }

      const allowedOrigins = origins
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);
      const secret = subscriberJwtSecret.trim();

      if (secret.length > 0 && secret.length < 32) {
        throw new Error('Subscriber JWT secret minimal 32 karakter.');
      }

      return adminClient.createApiKey({
        name: trimmed,
        ...(allowedOrigins.length === 0 ? {} : { allowedOrigins }),
        ...(secret.length === 0 ? {} : { subscriberJwtSecret: secret }),
      });
    },
    onSuccess: (result) => {
      setCreatedKey(result.key);
      setName('');
      setOrigins('');
      setSubscriberJwtSecret('');
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => adminClient.revokeApiKey(id),
    onSuccess: () => {
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const columns = useMemo<DataTableColumn<ApiKeySummary>[]>(
    () => [
      { id: 'name', header: 'Nama', cell: (row) => row.name },
      {
        id: 'active',
        header: 'Status',
        cell: (row) => (row.active ? <span className="status status--sent">active</span> : <span className="status status--skipped">revoked</span>),
      },
      { id: 'lastUsed', header: 'Terakhir dipakai', cell: (row) => formatDateTime(row.lastUsedAt) },
      { id: 'createdAt', header: 'Dibuat', cell: (row) => formatDateTime(row.createdAt) },
      {
        id: 'actions',
        header: '',
        cell: (row) =>
          row.active ? (
            <div className="text-end">
              <Button size="sm" variant="outline-danger" onClick={() => setSelected(row)}>
                Revoke
              </Button>
            </div>
          ) : null,
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="API Keys"
        subtitle="Key untuk autentikasi service-to-service (X-API-Key)."
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
          <Card.Title className="h6">Buat API key</Card.Title>

          {createdKey !== null ? (
            <Alert variant="success">
              <div className="fw-semibold mb-1">Simpan key ini sekarang — hanya ditampilkan sekali.</div>
              <div className="code-block mb-2">{createdKey}</div>
              <div className="d-flex gap-2">
                <Button
                  size="sm"
                  variant="outline-success"
                  onClick={() => {
                    void navigator.clipboard.writeText(createdKey).catch(() => undefined);
                  }}
                >
                  Copy
                </Button>
                <Button size="sm" variant="outline-secondary" onClick={() => setCreatedKey(null)}>
                  Tutup
                </Button>
              </div>
            </Alert>
          ) : null}

          {create.error !== null ? <Alert variant="danger">{describeError(create.error)}</Alert> : null}

          <Form
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <Row className="g-2 align-items-end">
              <Col xs={12} md={3}>
                <Form.Label className="small text-muted mb-1">Nama</Form.Label>
                <Form.Control
                  value={name}
                  placeholder="mis. order-service"
                  onChange={(event) => setName(event.target.value)}
                />
              </Col>
              <Col xs={12} md={4}>
                <Form.Label className="small text-muted mb-1">
                  Allowed origins (opsional, pisahkan koma)
                </Form.Label>
                <Form.Control
                  value={origins}
                  placeholder="https://app.example.com"
                  onChange={(event) => setOrigins(event.target.value)}
                />
              </Col>
              <Col xs={12} md={3}>
                <Form.Label className="small text-muted mb-1">
                  Subscriber JWT secret (opsional)
                </Form.Label>
                <Form.Control
                  type="password"
                  autoComplete="new-password"
                  maxLength={128}
                  value={subscriberJwtSecret}
                  placeholder="min. 32 karakter"
                  onChange={(event) => setSubscriberJwtSecret(event.target.value)}
                />
                <Form.Text className="text-muted">
                  Kosongkan untuk memakai fallback SUBSCRIBER_JWT_SECRET.
                </Form.Text>
              </Col>
              <Col xs={12} md={2}>
                <Button type="submit" className="w-100" disabled={create.isPending}>
                  {create.isPending ? 'Membuat…' : 'Buat key'}
                </Button>
              </Col>
            </Row>
          </Form>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          {revoke.error !== null ? (
            <Alert variant="danger">{describeError(revoke.error)}</Alert>
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
              rows={query.data ?? []}
              rowKey={(row) => row.id}
              emptyMessage="Belum ada API key."
            />
          </QueryState>
        </Card.Body>
      </Card>

      <ConfirmDialog
        show={selected !== null}
        title="Revoke API key"
        body={`Key "${selected?.name ?? ''}" tidak dapat dipakai lagi setelah di-revoke.`}
        confirmLabel="Revoke"
        busy={revoke.isPending}
        onCancel={() => setSelected(null)}
        onConfirm={() => {
          if (selected !== null) {
            revoke.mutate(selected.id);
          }
        }}
      />
    </>
  );
}
