import type { Subscriber } from '@notifhub/js';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button, Card, Col, Form, Row } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Pagination } from '../components/Pagination';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { RefreshControl } from '../components/RefreshControl';
import { adminClient } from '../lib/adminClient';
import { formatDateTime } from '../lib/format';

const LIMIT = 20;

export function SubscribersPage(): JSX.Element {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);

  const query = useQuery({
    queryKey: ['subscribers', { search, offset }],
    queryFn: () =>
      adminClient.listSubscribers({
        limit: LIMIT,
        offset,
        ...(search === '' ? {} : { search }),
      }),
  });

  const columns = useMemo<DataTableColumn<Subscriber>[]>(
    () => [
      { id: 'externalId', header: 'External ID', cell: (row) => row.externalId },
      { id: 'email', header: 'Email', cell: (row) => row.email ?? '—' },
      { id: 'locale', header: 'Locale', cell: (row) => row.locale ?? '—' },
      { id: 'timezone', header: 'Timezone', cell: (row) => row.timezone },
      { id: 'updatedAt', header: 'Diperbarui', cell: (row) => formatDateTime(row.updatedAt) },
      {
        id: 'actions',
        header: '',
        cell: (row) => (
          <Link
            to={`/subscribers/${encodeURIComponent(row.externalId)}`}
            className="btn btn-sm btn-outline-primary"
          >
            Detail
          </Link>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Subscribers"
        subtitle="Data subscriber push-sync dari consumer (bukan directory service)."
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
              setSearch(searchInput.trim());
              setOffset(0);
            }}
          >
            <Row className="g-2 align-items-end">
              <Col xs={12} md={6}>
                <Form.Label className="small text-muted mb-1">Cari</Form.Label>
                <Form.Control
                  value={searchInput}
                  placeholder="external id atau email"
                  onChange={(event) => setSearchInput(event.target.value)}
                />
              </Col>
              <Col xs={12} md={2}>
                <Button type="submit" variant="outline-secondary" className="w-100">
                  Cari
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
              emptyMessage="Belum ada subscriber."
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
