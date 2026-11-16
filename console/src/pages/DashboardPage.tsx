import type { OverallStatus } from '@notifhub/js';
import { useQuery } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import { Card, Col, Row, Table } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { RefreshControl } from '../components/RefreshControl';
import { StatusBadge } from '../components/StatusBadge';
import { adminClient } from '../lib/adminClient';
import { formatDateTime, formatDay } from '../lib/format';

const STATUSES: OverallStatus[] = ['pending', 'partial', 'sent', 'failed'];
const AUTO_REFRESH_MS = 60_000;

export function DashboardPage(): JSX.Element {
  const pending = useQuery({
    queryKey: ['dashboard', 'status', 'pending'],
    queryFn: () => adminClient.listNotifications({ status: 'pending', limit: 1 }),
    refetchInterval: AUTO_REFRESH_MS,
  });
  const partial = useQuery({
    queryKey: ['dashboard', 'status', 'partial'],
    queryFn: () => adminClient.listNotifications({ status: 'partial', limit: 1 }),
    refetchInterval: AUTO_REFRESH_MS,
  });
  const sent = useQuery({
    queryKey: ['dashboard', 'status', 'sent'],
    queryFn: () => adminClient.listNotifications({ status: 'sent', limit: 1 }),
    refetchInterval: AUTO_REFRESH_MS,
  });
  const failed = useQuery({
    queryKey: ['dashboard', 'status', 'failed'],
    queryFn: () => adminClient.listNotifications({ status: 'failed', limit: 1 }),
    refetchInterval: AUTO_REFRESH_MS,
  });
  const recent = useQuery({
    queryKey: ['dashboard', 'recent'],
    queryFn: () => adminClient.listNotifications({ limit: 100 }),
    refetchInterval: AUTO_REFRESH_MS,
  });

  const totals: Record<OverallStatus, number> = {
    pending: pending.data?.total ?? 0,
    partial: partial.data?.total ?? 0,
    sent: sent.data?.total ?? 0,
    failed: failed.data?.total ?? 0,
  };
  const totalAll = STATUSES.reduce((sum, status) => sum + totals[status], 0);
  const maxStatus = Math.max(1, ...STATUSES.map((status) => totals[status]));

  const days = Array.from({ length: 14 }, (_, index) =>
    format(subDays(new Date(), 13 - index), 'yyyy-MM-dd'),
  );
  const perDay = new Map<string, number>(days.map((day) => [day, 0]));

  for (const item of recent.data?.items ?? []) {
    const day = formatDay(item.createdAt);

    if (perDay.has(day)) {
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
  }

  const barData = days.map((day) => ({ day: day.slice(5), count: perDay.get(day) ?? 0 }));

  const error = pending.error ?? partial.error ?? sent.error ?? failed.error ?? recent.error;
  const isLoading =
    pending.isLoading || partial.isLoading || sent.isLoading || failed.isLoading || recent.isLoading;
  const isFetching =
    pending.isFetching || partial.isFetching || sent.isFetching || failed.isFetching || recent.isFetching;
  const updatedAt = Math.max(
    pending.dataUpdatedAt,
    partial.dataUpdatedAt,
    sent.dataUpdatedAt,
    failed.dataUpdatedAt,
    recent.dataUpdatedAt,
  );

  const refreshAll = (): void => {
    void pending.refetch();
    void partial.refetch();
    void sent.refetch();
    void failed.refetch();
    void recent.refetch();
  };

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Aktivitas pengiriman notifikasi untuk tenant ini."
        actions={
          <>
            <RefreshControl
              isFetching={isFetching}
              updatedAt={updatedAt}
              autoRefreshMs={AUTO_REFRESH_MS}
              onRefresh={refreshAll}
            />
            <Link to="/notifications" className="btn btn-outline-secondary btn-sm">
              Lihat notifikasi
            </Link>
            <Link to="/templates/new" className="btn btn-primary btn-sm">
              Template baru
            </Link>
          </>
        }
      />

      <QueryState isLoading={isLoading} error={error}>
        <div className="stat-strip">
          <div className="stat-cell">
            <div className="stat-label">Total</div>
            <div className="stat-value">{totalAll}</div>
            <div className="stat-note">{totals.partial} terkirim sebagian</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Sent</div>
            <div className="stat-value">{totals.sent}</div>
            <div className="stat-note">seluruh recipient terkirim</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Pending</div>
            <div className="stat-value">{totals.pending}</div>
            <div className="stat-note">menunggu worker</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Failed</div>
            <div className="stat-value">{totals.failed}</div>
            <div className="stat-note">perlu ditangani</div>
          </div>
        </div>

        <Row className="g-3 mb-3">
          <Col xs={12} lg={8}>
            <Card className="h-100">
              <Card.Body>
                <div className="section-heading">
                  <div>
                    <h2>Volume</h2>
                    <div className="section-sub">14 hari terakhir</div>
                  </div>
                </div>
                <div style={{ height: 250 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData} barSize={16}>
                      <CartesianGrid stroke="#f2f1f0" vertical={false} />
                      <XAxis
                        dataKey="day"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        stroke="#a8a29e"
                      />
                      <YAxis
                        allowDecimals={false}
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        stroke="#a8a29e"
                        width={26}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(28, 25, 23, 0.04)' }}
                        contentStyle={{
                          borderRadius: 8,
                          border: '1px solid #e7e5e4',
                          fontSize: 12,
                          boxShadow: 'none',
                        }}
                      />
                      <Bar dataKey="count" fill="#2563eb" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="section-sub mt-2">
                  Agregasi client-side dari 100 notifikasi terbaru.
                </div>
              </Card.Body>
            </Card>
          </Col>
          <Col xs={12} lg={4}>
            <Card className="h-100">
              <Card.Body>
                <div className="section-heading">
                  <div>
                    <h2>Status</h2>
                    <div className="section-sub">Sepanjang waktu</div>
                  </div>
                </div>
                <div className="status-list">
                  {STATUSES.map((status) => (
                    <div className="status-row" key={status}>
                      <StatusBadge status={status} />
                      <div className="bar">
                        <span
                          style={{
                            width: `${Math.round((totals[status] / maxStatus) * 100)}%`,
                          }}
                        />
                      </div>
                      <div className="count">{totals[status]}</div>
                    </div>
                  ))}
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        <Card>
          <Card.Body>
            <div className="section-heading">
              <div>
                <h2>Notifikasi terbaru</h2>
                <div className="section-sub">5 terakhir</div>
              </div>
              <Link to="/notifications" className="btn btn-link">
                Lihat semua
              </Link>
            </div>
            <Table hover responsive size="sm" className="mb-0">
              <thead>
                <tr>
                  <th>Dibuat</th>
                  <th>Template</th>
                  <th>Status</th>
                  <th>Penerima</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(recent.data?.items ?? []).slice(0, 5).map((item) => (
                  <tr key={item.id}>
                    <td className="text-muted">{formatDateTime(item.createdAt)}</td>
                    <td>{item.templateKey}</td>
                    <td>
                      <StatusBadge status={item.overallStatus} />
                    </td>
                    <td>{item.recipientCount}</td>
                    <td className="text-end">
                      <Link to={`/notifications/${item.id}`} className="btn btn-link">
                        Detail
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      </QueryState>
    </>
  );
}
