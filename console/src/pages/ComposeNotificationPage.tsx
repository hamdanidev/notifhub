import type { Channel } from '@notifhub/js';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Card, Col, Form, Row } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { adminClient } from '../lib/adminClient';
import { composeNotification, type ComposePriority } from '../lib/adminCompose';
import { describeError } from '../lib/format';

const CHANNELS: Channel[] = ['inapp', 'email', 'whatsapp'];
const PRIORITIES: ComposePriority[] = ['low', 'normal', 'high'];

function splitEntries(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseData(raw: string): Record<string, unknown> {
  if (raw.trim() === '') {
    return {};
  }

  const parsed: unknown = JSON.parse(raw);

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Data harus berupa objek JSON.');
  }

  return parsed as Record<string, unknown>;
}

export function ComposeNotificationPage(): JSX.Element {
  const [templateKey, setTemplateKey] = useState('');
  const [recipients, setRecipients] = useState('');
  const [topics, setTopics] = useState('');
  const [channels, setChannels] = useState<Channel[]>(['inapp']);
  const [data, setData] = useState('{}');
  const [priority, setPriority] = useState<ComposePriority>('normal');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const templates = useQuery({
    queryKey: ['templates', 'active-for-compose'],
    queryFn: () => adminClient.listTemplates({ active: true, limit: 100 }),
  });

  const templateKeys = [
    ...new Set((templates.data?.items ?? []).map((template) => template.key)),
  ].sort();

  const compose = useMutation({
    mutationFn: () => {
      const recipientIds = splitEntries(recipients);
      const topicKeys = splitEntries(topics);

      if (templateKey.trim() === '') {
        throw new Error('Template key wajib diisi.');
      }

      if (recipientIds.length === 0 && topicKeys.length === 0) {
        throw new Error('Isi minimal satu recipient atau topic.');
      }

      if (channels.length === 0) {
        throw new Error('Pilih minimal satu channel.');
      }

      return composeNotification({
        requestKey: crypto.randomUUID(),
        templateKey: templateKey.trim(),
        ...(recipientIds.length === 0 ? {} : { recipients: recipientIds }),
        ...(topicKeys.length === 0 ? {} : { topics: topicKeys }),
        channels,
        data: parseData(data),
        priority,
      });
    },
    onSuccess: (response) => {
      setResult(response.notification_id);
      setError(null);
    },
    onError: (caught: unknown) => {
      setError(describeError(caught));
      setResult(null);
    },
  });

  const toggleChannel = (channel: Channel): void => {
    setChannels((current) =>
      current.includes(channel) ? current.filter((item) => item !== channel) : [...current, channel],
    );
  };

  return (
    <>
      <PageHeader
        title="Kirim notifikasi"
        subtitle="Compose dari console; tenant diambil dari sesi admin."
        actions={
          <Link to="/notifications" className="btn btn-sm btn-outline-secondary">
            Kembali
          </Link>
        }
      />

      {result !== null ? (
        <Alert variant="success">
          Notifikasi diterima:{' '}
          <Link to={`/notifications/${result}`}>{result}</Link>
        </Alert>
      ) : null}

      {error !== null ? <Alert variant="danger">{error}</Alert> : null}

      <Card>
        <Card.Body>
          <QueryState
            isLoading={templates.isLoading}
            error={templates.error}
            skeleton="lines"
            onRetry={() => void templates.refetch()}
          >
            <Form
              onSubmit={(event) => {
                event.preventDefault();
                setError(null);
                setResult(null);
                compose.mutate();
              }}
            >
              <Row className="g-3">
                <Col xs={12} md={6}>
                  <Form.Group controlId="compose-template">
                    <Form.Label>Template key</Form.Label>
                    <Form.Control
                      list="compose-template-keys"
                      value={templateKey}
                      placeholder="mis. order.shipped"
                      onChange={(event) => setTemplateKey(event.target.value)}
                    />
                    <datalist id="compose-template-keys">
                      {templateKeys.map((key) => (
                        <option key={key} value={key} />
                      ))}
                    </datalist>
                    <Form.Text className="text-muted">
                      {templateKeys.length === 0
                        ? 'Belum ada template aktif; buat template terlebih dahulu.'
                        : `${templateKeys.length} template aktif tersedia.`}
                    </Form.Text>
                  </Form.Group>
                </Col>
                <Col xs={12} md={6}>
                  <Form.Group controlId="compose-priority">
                    <Form.Label>Priority</Form.Label>
                    <Form.Select
                      value={priority}
                      onChange={(event) => setPriority(event.target.value as ComposePriority)}
                    >
                      {PRIORITIES.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>

                <Col xs={12} md={6}>
                  <Form.Group controlId="compose-recipients">
                    <Form.Label>Recipient IDs (pisahkan koma/baris)</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={4}
                      value={recipients}
                      placeholder={'user-1\nuser-2'}
                      onChange={(event) => setRecipients(event.target.value)}
                    />
                  </Form.Group>
                </Col>
                <Col xs={12} md={6}>
                  <Form.Group controlId="compose-topics">
                    <Form.Label>Topics (opsional)</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={4}
                      value={topics}
                      placeholder={'shift:gudang'}
                      onChange={(event) => setTopics(event.target.value)}
                    />
                  </Form.Group>
                </Col>

                <Col xs={12} md={6}>
                  <Form.Group controlId="compose-channels">
                    <Form.Label>Channel</Form.Label>
                    <div>
                      {CHANNELS.map((channel) => (
                        <Form.Check
                          key={channel}
                          inline
                          type="checkbox"
                          id={`compose-channel-${channel}`}
                          label={channel}
                          checked={channels.includes(channel)}
                          onChange={() => toggleChannel(channel)}
                        />
                      ))}
                    </div>
                  </Form.Group>
                </Col>
                <Col xs={12} md={6}>
                  <Form.Group controlId="compose-data">
                    <Form.Label>Data (JSON)</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={4}
                      value={data}
                      onChange={(event) => setData(event.target.value)}
                    />
                  </Form.Group>
                </Col>

                <Col xs={12}>
                  <Button type="submit" disabled={compose.isPending}>
                    {compose.isPending ? 'Mengirim…' : 'Kirim notifikasi'}
                  </Button>
                </Col>
              </Row>
            </Form>
          </QueryState>
        </Card.Body>
      </Card>
    </>
  );
}
