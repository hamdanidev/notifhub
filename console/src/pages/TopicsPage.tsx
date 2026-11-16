import type { TopicSummary } from '@notifhub/js';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button, Card, Col, Form, Row } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Pagination } from '../components/Pagination';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { adminClient } from '../lib/adminClient';
import { formatDateTime } from '../lib/format';

const LIMIT = 20;

export function TopicsPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [openKey, setOpenKey] = useState('');

  const query = useQuery({
    queryKey: ['topics', { search, offset }],
    queryFn: () =>
      adminClient.listTopics({ limit: LIMIT, offset, ...(search === '' ? {} : { search }) }),
  });

  const columns = useMemo<DataTableColumn<TopicSummary>[]>(
    () => [
      { id: 'key', header: 'Key', cell: (row) => row.key },
      { id: 'mode', header: 'Mode', cell: (row) => row.mode },
      {
        id: 'timeBound',
        header: 'Time-bound',
        cell: (row) => (row.isTimeBound ? 'ya' : 'tidak'),
      },
      { id: 'members', header: 'Members', cell: (row) => row.memberCount },
      { id: 'createdAt', header: 'Dibuat', cell: (row) => formatDateTime(row.createdAt) },
      {
        id: 'actions',
        header: '',
        cell: (row) => (
          <Link
            to={`/topics/${encodeURIComponent(row.key)}`}
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
        title="Topics"
        subtitle="Topic dibuat otomatis saat membership pertama di-push."
      />

      <Card className="filter-card mb-3">
        <Card.Body>
          <Row className="g-2 align-items-end">
            <Col xs={12} md={4}>
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  setSearch(searchInput.trim());
                  setOffset(0);
                }}
              >
                <Form.Label className="small text-muted mb-1">Cari key</Form.Label>
                <div className="d-flex gap-2">
                  <Form.Control
                    value={searchInput}
                    placeholder="mis. shift:gudang"
                    onChange={(event) => setSearchInput(event.target.value)}
                  />
                  <Button type="submit" variant="outline-secondary">
                    Cari
                  </Button>
                </div>
              </Form>
            </Col>
            <Col xs={12} md={5}>
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  const key = openKey.trim();

                  if (key.length > 0) {
                    navigate(`/topics/${encodeURIComponent(key)}`);
                  }
                }}
              >
                <Form.Label className="small text-muted mb-1">Buka / buat topic</Form.Label>
                <div className="d-flex gap-2">
                  <Form.Control
                    value={openKey}
                    placeholder="key topic"
                    onChange={(event) => setOpenKey(event.target.value)}
                  />
                  <Button type="submit" variant="primary">
                    Buka
                  </Button>
                </div>
              </Form>
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
              rowKey={(row) => row.key}
              emptyMessage="Belum ada topic."
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
