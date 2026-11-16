import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button, Card, Col, Form, Row } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { ChannelBadge } from '../components/ChannelBadge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { QueryState } from '../components/QueryState';
import { RefreshControl } from '../components/RefreshControl';
import { TemplateStatusBadge } from '../components/TemplateStatusBadge';
import {
  activateTemplate,
  cloneTemplate,
  deactivateTemplate,
  listTemplates,
} from '../lib/adminTemplates';
import { describeError, formatDateTime } from '../lib/format';
import type { Channel, TemplateStatus, TemplateSummary } from '../lib/templateTypes';

const LIMIT = 20;
const CHANNEL_OPTIONS: Array<Channel | ''> = ['', 'inapp', 'email', 'whatsapp', 'sms'];
const STATUS_OPTIONS: Array<TemplateStatus | ''> = ['', 'draft', 'published'];

export function TemplatesPage(): JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [channel, setChannel] = useState<Channel | ''>('');
  const [status, setStatus] = useState<TemplateStatus | ''>('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<TemplateSummary | null>(null);

  const query = useQuery({
    queryKey: ['templates', { search, channel, status, offset }],
    queryFn: () =>
      listTemplates({
        limit: LIMIT,
        offset,
        ...(search === '' ? {} : { search }),
        ...(channel === '' ? {} : { channel }),
        ...(status === '' ? {} : { status }),
      }),
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => deactivateTemplate(id),
    onSuccess: () => {
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });

  const activate = useMutation({
    mutationFn: (id: string) => activateTemplate(id),
    onSuccess: () => {
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });

  const clone = useMutation({
    mutationFn: (id: string) => cloneTemplate(id, {}),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
      navigate(`/templates/${result.id}/edit`);
    },
  });

  const columns = useMemo<DataTableColumn<TemplateSummary>[]>(
    () => [
      { id: 'key', header: 'Key', cell: (row) => <code>{row.key}</code> },
      { id: 'channel', header: 'Channel', cell: (row) => <ChannelBadge channel={row.channel} /> },
      { id: 'locale', header: 'Locale', cell: (row) => row.locale },
      { id: 'version', header: 'Versi', cell: (row) => row.version },
      {
        id: 'status',
        header: 'Status',
        cell: (row) => <TemplateStatusBadge status={row.status} />,
      },
      { id: 'format', header: 'Format', cell: (row) => row.format },
      {
        id: 'active',
        header: 'Aktif',
        cell: (row) =>
          row.active ? (
            <span className="status status--sent">active</span>
          ) : (
            <span className="status status--skipped">inactive</span>
          ),
      },
      { id: 'updatedAt', header: 'Diperbarui', cell: (row) => formatDateTime(row.updatedAt) },
      {
        id: 'actions',
        header: '',
        cell: (row) => (
          <div className="d-flex gap-2 justify-content-end flex-wrap">
            <Link to={`/templates/${row.id}/edit`} className="btn btn-sm btn-outline-primary">
              {row.status === 'draft' ? 'Edit' : 'Lihat'}
            </Link>
            <Button
              size="sm"
              variant="outline-secondary"
              onClick={() => clone.mutate(row.id)}
              disabled={clone.isPending}
            >
              Clone
            </Button>
            {row.status === 'draft' ? (
              <Link to={`/templates/${row.id}/edit`} className="btn btn-sm btn-dark">
                Publish…
              </Link>
            ) : row.active ? (
              <Button size="sm" variant="outline-danger" onClick={() => setSelected(row)}>
                Nonaktifkan
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline-success"
                onClick={() => activate.mutate(row.id)}
                disabled={activate.isPending}
              >
                Aktifkan
              </Button>
            )}
            <Link to={`/templates/${row.id}/history`} className="btn btn-sm btn-outline-secondary">
              Riwayat
            </Link>
          </div>
        ),
      },
    ],
    [activate.isPending, clone],
  );

  return (
    <>
      <PageHeader
        title="Templates"
        subtitle="Draft, publish, aset email, variabel, preview, dan test send."
        actions={
          <>
            <RefreshControl
              isFetching={query.isFetching}
              updatedAt={query.dataUpdatedAt}
              onRefresh={() => {
                void query.refetch();
              }}
            />
            <Link to="/templates/assets" className="btn btn-outline-secondary btn-sm">
              Aset template
            </Link>
            <Link to="/templates/new" className="btn btn-primary btn-sm">
              Template baru
            </Link>
          </>
        }
      />

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
                <Form.Label className="small text-muted mb-1">Cari key</Form.Label>
                <Form.Control
                  value={searchInput}
                  placeholder="mis. order.shipped"
                  onChange={(event) => setSearchInput(event.target.value)}
                />
              </Col>
              <Col xs={12} md={2}>
                <Form.Label className="small text-muted mb-1">Channel</Form.Label>
                <Form.Select
                  value={channel}
                  onChange={(event) => {
                    setChannel(event.target.value as Channel | '');
                    setOffset(0);
                  }}
                >
                  {CHANNEL_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option === '' ? 'Semua' : option}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col xs={12} md={2}>
                <Form.Label className="small text-muted mb-1">Status</Form.Label>
                <Form.Select
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value as TemplateStatus | '');
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
                <Button type="submit" variant="outline-secondary" className="w-100">
                  Cari
                </Button>
              </Col>
              <Col xs={12} md={2}>
                <Button
                  variant="outline-secondary"
                  className="w-100"
                  onClick={() => {
                    setSearchInput('');
                    setSearch('');
                    setChannel('');
                    setStatus('');
                    setOffset(0);
                  }}
                >
                  Reset
                </Button>
              </Col>
            </Row>
          </Form>
        </Card.Body>
      </Card>

      {clone.error !== null ? (
        <div className="alert alert-danger">{describeError(clone.error)}</div>
      ) : null}
      {activate.error !== null ? (
        <div className="alert alert-danger">{describeError(activate.error)}</div>
      ) : null}

      <Card>
        <Card.Body>
          {deactivate.error !== null ? (
            <div className="alert alert-danger">{describeError(deactivate.error)}</div>
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
              emptyMessage="Belum ada template."
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

      <ConfirmDialog
        show={selected !== null}
        title="Nonaktifkan template"
        body={`Template "${selected?.key ?? ''}" versi ${selected?.version ?? ''} akan ditandai inactive dan tidak dipakai untuk pengiriman baru.`}
        confirmLabel="Nonaktifkan"
        busy={deactivate.isPending}
        onCancel={() => setSelected(null)}
        onConfirm={() => {
          if (selected !== null) {
            deactivate.mutate(selected.id);
          }
        }}
      />
    </>
  );
}
