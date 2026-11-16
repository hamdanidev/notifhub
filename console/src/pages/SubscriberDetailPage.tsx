import type { Channel } from '@notifhub/js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Form, Row } from 'react-bootstrap';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { RefreshControl } from '../components/RefreshControl';
import { CHANNELS, isValidQuietHoursPair } from '../forms/schemas';
import { adminClient } from '../lib/adminClient';
import { describeError, formatDateTime } from '../lib/format';

interface PreferenceDraft {
  enabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string;
}

type Drafts = Record<Channel, PreferenceDraft>;

function defaultDraft(timezone: string): PreferenceDraft {
  return { enabled: true, quietHoursStart: '', quietHoursEnd: '', timezone };
}

function emptyDrafts(timezone: string): Drafts {
  return {
    inapp: defaultDraft(timezone),
    email: defaultDraft(timezone),
    whatsapp: defaultDraft(timezone),
    sms: defaultDraft(timezone),
  };
}

export function SubscriberDetailPage(): JSX.Element {
  const { externalId } = useParams<{ externalId: string }>();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Drafts>(() => emptyDrafts('Asia/Jakarta'));

  const subscriber = useQuery({
    queryKey: ['subscriber', externalId],
    queryFn: () => adminClient.getSubscriber(externalId ?? ''),
    enabled: externalId !== undefined,
  });

  const preferences = useQuery({
    queryKey: ['subscriber', externalId, 'preferences'],
    queryFn: () => adminClient.listPreferences(externalId ?? ''),
    enabled: externalId !== undefined,
  });

  useEffect(() => {
    if (subscriber.data === undefined) {
      return;
    }

    const next = emptyDrafts(subscriber.data.timezone);

    for (const preference of preferences.data ?? []) {
      next[preference.channel] = {
        enabled: preference.enabled,
        quietHoursStart: preference.quietHoursStart ?? '',
        quietHoursEnd: preference.quietHoursEnd ?? '',
        timezone: preference.timezone,
      };
    }

    setDrafts(next);
  }, [subscriber.data, preferences.data]);

  const save = useMutation({
    mutationFn: async (channel: Channel) => {
      const draft = drafts[channel];

      if (!isValidQuietHoursPair(draft.quietHoursStart, draft.quietHoursEnd)) {
        throw new Error('Quiet hours harus diisi berpasangan dengan format HH:mm.');
      }

      return adminClient.upsertPreference(externalId ?? '', channel, {
        enabled: draft.enabled,
        quietHoursStart: draft.quietHoursStart === '' ? undefined : draft.quietHoursStart,
        quietHoursEnd: draft.quietHoursEnd === '' ? undefined : draft.quietHoursEnd,
        timezone: draft.timezone,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['subscriber', externalId, 'preferences'] });
    },
  });

  const updateDraft = (channel: Channel, patch: Partial<PreferenceDraft>): void => {
    setDrafts((previous) => ({
      ...previous,
      [channel]: { ...previous[channel], ...patch },
    }));
  };

  return (
    <>
      <PageHeader
        title="Subscriber detail"
        subtitle={externalId}
        actions={
          <>
            <RefreshControl
              isFetching={subscriber.isFetching || preferences.isFetching}
              updatedAt={Math.max(subscriber.dataUpdatedAt, preferences.dataUpdatedAt)}
              onRefresh={() => {
                void subscriber.refetch();
                void preferences.refetch();
              }}
            />
            <Link to="/subscribers" className="btn btn-sm btn-outline-secondary">
              Kembali
            </Link>
          </>
        }
      />

      <QueryState
        isLoading={subscriber.isLoading}
        error={subscriber.error}
        onRetry={() => {
          void subscriber.refetch();
        }}
      >
        {subscriber.data !== undefined ? (
          <Card className="mb-3">
            <Card.Body>
              <Row className="g-3">
                <Col xs={12} md={4}>
                  <div className="small text-muted">External ID</div>
                  {subscriber.data.externalId}
                </Col>
                <Col xs={12} md={4}>
                  <div className="small text-muted">Email</div>
                  {subscriber.data.email ?? '—'}
                </Col>
                <Col xs={12} md={4}>
                  <div className="small text-muted">Phone</div>
                  {subscriber.data.phone ?? '—'}
                </Col>
                <Col xs={12} md={4}>
                  <div className="small text-muted">Locale</div>
                  {subscriber.data.locale ?? '—'}
                </Col>
                <Col xs={12} md={4}>
                  <div className="small text-muted">Timezone</div>
                  {subscriber.data.timezone}
                </Col>
                <Col xs={12} md={4}>
                  <div className="small text-muted">Diperbarui</div>
                  {formatDateTime(subscriber.data.updatedAt)}
                </Col>
              </Row>
            </Card.Body>
          </Card>
        ) : null}

        <Card>
          <Card.Body>
            <Card.Title className="h6 mb-3">Notification preferences</Card.Title>

            {save.error !== null ? (
              <Alert variant="danger">{describeError(save.error)}</Alert>
            ) : null}

            <QueryState
              isLoading={preferences.isLoading}
              error={preferences.error}
              onRetry={() => {
                void preferences.refetch();
              }}
            >
              {CHANNELS.map((channel) => {
                const draft = drafts[channel];

                return (
                  <Row className="g-2 align-items-end border-bottom py-3" key={channel}>
                    <Col xs={12} md={2}>
                      <div className="fw-semibold text-capitalize">{channel}</div>
                      <Form.Check
                        type="switch"
                        id={`pref-enabled-${channel}`}
                        label="Enabled"
                        checked={draft.enabled}
                        onChange={(event) =>
                          updateDraft(channel, { enabled: event.target.checked })
                        }
                      />
                    </Col>
                    <Col xs={6} md={2}>
                      <Form.Label className="small text-muted mb-1">Quiet start</Form.Label>
                      <Form.Control
                        size="sm"
                        placeholder="22:00"
                        value={draft.quietHoursStart}
                        onChange={(event) =>
                          updateDraft(channel, { quietHoursStart: event.target.value })
                        }
                      />
                    </Col>
                    <Col xs={6} md={2}>
                      <Form.Label className="small text-muted mb-1">Quiet end</Form.Label>
                      <Form.Control
                        size="sm"
                        placeholder="07:00"
                        value={draft.quietHoursEnd}
                        onChange={(event) =>
                          updateDraft(channel, { quietHoursEnd: event.target.value })
                        }
                      />
                    </Col>
                    <Col xs={12} md={3}>
                      <Form.Label className="small text-muted mb-1">Timezone</Form.Label>
                      <Form.Control
                        size="sm"
                        value={draft.timezone}
                        onChange={(event) => updateDraft(channel, { timezone: event.target.value })}
                      />
                    </Col>
                    <Col xs={12} md={3} className="text-md-end">
                      <Button
                        size="sm"
                        onClick={() => save.mutate(channel)}
                        disabled={save.isPending}
                      >
                        Simpan {channel}
                      </Button>
                    </Col>
                  </Row>
                );
              })}
            </QueryState>
          </Card.Body>
        </Card>
      </QueryState>
    </>
  );
}
