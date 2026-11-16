import type { Channel, Template } from '@notifhub/js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button, Card, Col, Form, Row } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ChannelBadge } from '../components/ChannelBadge';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Pagination } from '../components/Pagination';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { adminClient } from '../lib/adminClient';
import { describeError, formatDateTime } from '../lib/format';

const LIMIT = 20;
const CHANNEL_OPTIONS: Array<Channel | ''> = ['', 'inapp', 'email', 'whatsapp', 'sms'];

export function TemplatesPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [channel, setChannel] = useState<Channel | ''>('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Template | null>(null);

  const query = useQuery({
    queryKey: ['templates', { search, channel, offset }],
    queryFn: () =>
      adminClient.listTemplates({
        limit: LIMIT,
        offset,
        ...(search === '' ? {} : { search }),
        ...(channel === '' ? {} : { channel }),
      }),
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => adminClient.deactivateTemplate(id),
    onSuccess: () => {
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });

  const columns = useMemo<DataTableColumn<Template>[]>(
    () => [
      { id: 'key', header: 'Key', cell: (row) => row.key },
      { id: 'channel', header: 'Channel', cell: (row) => <ChannelBadge channel={row.channel} /> },
      { id: 'locale', header: 'Locale', cell: (row) => row.locale },
      { id: 'version', header: 'Versi', cell: (row) => row.version },
      {
        id: 'active',
        header: 'Aktif',
        cell: (row) => (row.active ? <span className="status status--sent">active</span> : <span className="status status--skipped">inactive</span>),
      },
      {
        id: 'fallback',
        header: 'Fallback',
        cell: (row) => row.fallbackChannel ?? '—',
      },
      { id: 'updatedAt', header: 'Diperbarui', cell: (row) => formatDateTime(row.updatedAt) },
      {
        id: 'actions',
        header: '',
        cell: (row) => (
          <div className="d-flex gap-2 justify-content-end">
            <Link to={`/templates/${row.id}/edit`} className="btn btn-sm btn-outline-primary">
              Edit
            </Link>
            {row.active ? (
              <Button size="sm" variant="outline-danger" onClick={() => setSelected(row)}>
                Nonaktifkan
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Templates"
        subtitle="Template per channel, locale, dan versi."
        actions={
          <Link to="/templates/new" className="btn btn-primary btn-sm">
            Template baru
          </Link>
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
              <Col xs={12} md={5}>
                <Form.Label className="small text-muted mb-1">Cari key</Form.Label>
                <Form.Control
                  value={searchInput}
                  placeholder="mis. test.notification"
                  onChange={(event) => setSearchInput(event.target.value)}
                />
              </Col>
              <Col xs={12} md={3}>
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
        body={`Template "${selected?.key ?? ''}" akan ditandai inactive dan tidak dipakai untuk pengiriman baru.`}
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
