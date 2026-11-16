import { isNotifHubError } from '@notifhub/js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Form, Row, Table } from 'react-bootstrap';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { RefreshControl } from '../components/RefreshControl';
import { adminClient } from '../lib/adminClient';
import { describeError, formatDateTime } from '../lib/format';

type MutationMode = 'replace' | 'add';

export function TopicDetailPage(): JSX.Element {
  const { key } = useParams<{ key: string }>();
  const topicKey = key ?? '';
  const queryClient = useQueryClient();

  const [membersText, setMembersText] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [isTimeBound, setIsTimeBound] = useState(false);

  const topic = useQuery({
    queryKey: ['topic', topicKey],
    queryFn: () => adminClient.getTopic(topicKey),
    enabled: topicKey.length > 0,
    retry: false,
  });

  const members = useQuery({
    queryKey: ['topic', topicKey, 'members'],
    queryFn: () => adminClient.listTopicMembers(topicKey, true),
    enabled: topicKey.length > 0,
    retry: false,
  });

  useEffect(() => {
    if (members.data !== undefined) {
      setMembersText(members.data.members.map((member) => member.recipientId).join('\n'));
    }
  }, [members.data]);

  useEffect(() => {
    if (topic.data !== undefined) {
      setIsTimeBound(topic.data.isTimeBound);
    }
  }, [topic.data]);

  const mutate = useMutation({
    mutationFn: async (mode: MutationMode) => {
      const recipientIds = membersText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (recipientIds.length === 0) {
        throw new Error('Minimal satu recipientId diperlukan.');
      }

      const body = {
        members: recipientIds.map((recipientId) => ({ recipientId })),
        ...(expiresAt === ''
          ? {}
          : { expiresAt: new Date(expiresAt).toISOString() }),
        isTimeBound,
      };

      return mode === 'replace'
        ? adminClient.replaceTopicMembers(topicKey, body)
        : adminClient.addTopicMembers(topicKey, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['topic', topicKey] });
      void queryClient.invalidateQueries({ queryKey: ['topics'] });
    },
  });

  const topicMissing =
    topic.error !== null && topic.error !== undefined && isNotifHubError(topic.error) && topic.error.code === 'not_found';

  return (
    <>
      <PageHeader
        title="Topic detail"
        subtitle={topicKey}
        actions={
          <>
            <RefreshControl
              isFetching={topic.isFetching || members.isFetching}
              updatedAt={Math.max(topic.dataUpdatedAt, members.dataUpdatedAt)}
              onRefresh={() => {
                void topic.refetch();
                void members.refetch();
              }}
            />
            <Link to="/topics" className="btn btn-sm btn-outline-secondary">
              Kembali
            </Link>
          </>
        }
      />

      {topicMissing ? (
        <Alert variant="info">
          Topic belum ada. Simpan membership di bawah untuk membuat topic ini.
        </Alert>
      ) : null}

      <QueryState
        isLoading={topic.isLoading || members.isLoading}
        error={topicMissing ? null : (topic.error ?? members.error)}
        onRetry={() => {
          void topic.refetch();
          void members.refetch();
        }}
      >
        {topic.data !== undefined ? (
          <Card className="mb-3">
            <Card.Body>
              <Row className="g-3">
                <Col xs={12} md={3}>
                  <div className="small text-muted">Key</div>
                  {topic.data.key}
                </Col>
                <Col xs={12} md={3}>
                  <div className="small text-muted">Mode</div>
                  {topic.data.mode}
                </Col>
                <Col xs={12} md={3}>
                  <div className="small text-muted">Time-bound</div>
                  {topic.data.isTimeBound ? 'ya' : 'tidak'}
                </Col>
                <Col xs={12} md={3}>
                  <div className="small text-muted">Members</div>
                  {topic.data.memberCount} (expired {topic.data.expiredCount})
                </Col>
              </Row>
            </Card.Body>
          </Card>
        ) : null}

        <Card className="mb-3">
          <Card.Body>
            <Card.Title className="h6">Membership editor</Card.Title>
            <p className="text-muted small">
              Satu recipientId per baris. Replace mengganti seluruh membership; Add hanya
              menambah/memperbarui. Time-bound topic mewajibkan expiresAt.
            </p>

            {mutate.error !== null ? (
              <Alert variant="danger">{describeError(mutate.error)}</Alert>
            ) : null}

            <Form
              onSubmit={(event) => {
                event.preventDefault();
                mutate.mutate('replace');
              }}
            >
              <Row className="g-3">
                <Col xs={12} md={5}>
                  <Form.Group controlId="topic-members">
                    <Form.Label>Recipient IDs</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={6}
                      className="font-monospace"
                      value={membersText}
                      onChange={(event) => setMembersText(event.target.value)}
                    />
                  </Form.Group>
                </Col>
                <Col xs={12} md={4}>
                  <Form.Group controlId="topic-expires">
                    <Form.Label>expiresAt (opsional)</Form.Label>
                    <Form.Control
                      type="datetime-local"
                      value={expiresAt}
                      onChange={(event) => setExpiresAt(event.target.value)}
                    />
                    <Form.Text className="text-muted">
                      Diterapkan sebagai default untuk semua member.
                    </Form.Text>
                  </Form.Group>
                  <Form.Check
                    className="mt-3"
                    type="switch"
                    id="topic-time-bound"
                    label="Topic time-bound"
                    checked={isTimeBound}
                    onChange={(event) => setIsTimeBound(event.target.checked)}
                  />
                </Col>
                <Col xs={12} md={3} className="d-flex flex-column gap-2 justify-content-end">
                  <Button type="submit" disabled={mutate.isPending}>
                    Replace membership
                  </Button>
                  <Button
                    type="button"
                    variant="outline-primary"
                    disabled={mutate.isPending}
                    onClick={() => mutate.mutate('add')}
                  >
                    Add / update
                  </Button>
                </Col>
              </Row>
            </Form>
          </Card.Body>
        </Card>

        <Card>
          <Card.Body>
            <Card.Title className="h6">Members</Card.Title>
            <Table hover responsive size="sm" className="mb-0">
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Ditambahkan</th>
                  <th>Expires</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(members.data?.members ?? []).map((member) => {
                  const expired =
                    member.expiresAt !== null &&
                    new Date(member.expiresAt).getTime() <= Date.now();

                  return (
                    <tr key={member.recipientId}>
                      <td>{member.recipientId}</td>
                      <td>{formatDateTime(member.addedAt)}</td>
                      <td>{formatDateTime(member.expiresAt)}</td>
                      <td>
                        {expired ? (
                          <span className="status status--skipped">expired</span>
                        ) : (
                          <span className="status status--sent">active</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      </QueryState>
    </>
  );
}
