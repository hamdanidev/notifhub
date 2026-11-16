import { zodResolver } from '@hookform/resolvers/zod';
import type { Channel } from '@notifhub/js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Alert, Button, Card, Col, Form, Row, Spinner } from 'react-bootstrap';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { CHANNELS, templateSchema, type TemplateValues } from '../forms/schemas';
import { adminClient } from '../lib/adminClient';
import { describeError } from '../lib/format';

export function TemplateFormPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const isEdit = id !== undefined;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const existing = useQuery({
    queryKey: ['template', id],
    queryFn: () => adminClient.getTemplate(id ?? ''),
    enabled: isEdit,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TemplateValues>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      key: '',
      channel: 'inapp',
      locale: 'id',
      subject: '',
      body: '',
      version: '1',
      fallbackChannel: '',
      fallbackProvider: '',
    },
  });

  useEffect(() => {
    if (existing.data !== undefined) {
      reset({
        key: existing.data.key,
        channel: existing.data.channel as TemplateValues['channel'],
        locale: existing.data.locale,
        subject: existing.data.subject ?? '',
        body: existing.data.body,
        version: String(existing.data.version),
        fallbackChannel: (existing.data.fallbackChannel ?? '') as TemplateValues['fallbackChannel'],
        fallbackProvider: existing.data.fallbackProvider ?? '',
      });
    }
  }, [existing.data, reset]);

  const create = useMutation({
    mutationFn: async (values: TemplateValues) =>
      adminClient.createTemplate({
        key: values.key,
        channel: values.channel,
        locale: values.locale,
        subject: values.subject === '' ? undefined : values.subject,
        body: values.body,
        version: values.version !== undefined && values.version !== '' ? Number(values.version) : 1,
        fallbackChannel:
          values.fallbackChannel === '' || values.fallbackChannel === undefined
            ? undefined
            : (values.fallbackChannel as Channel),
        fallbackProvider:
          values.fallbackProvider === '' || values.fallbackProvider === undefined
            ? undefined
            : values.fallbackProvider,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
      navigate('/templates');
    },
  });

  const update = useMutation({
    mutationFn: async (values: TemplateValues) =>
      adminClient.updateTemplate(id ?? '', {
        subject: values.subject === '' ? undefined : values.subject,
        body: values.body,
        fallbackChannel:
          values.fallbackChannel === '' || values.fallbackChannel === undefined
            ? undefined
            : (values.fallbackChannel as Channel),
        fallbackProvider:
          values.fallbackProvider === '' || values.fallbackProvider === undefined
            ? undefined
            : values.fallbackProvider,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
      void queryClient.invalidateQueries({ queryKey: ['template', id] });
      navigate('/templates');
    },
  });

  const onSubmit = async (values: TemplateValues): Promise<void> => {
    if (isEdit) {
      await update.mutateAsync(values);
    } else {
      await create.mutateAsync(values);
    }
  };

  const mutationError = isEdit ? update.error : create.error;
  const busy = isSubmitting || create.isPending || update.isPending;

  return (
    <>
      <PageHeader
        title={isEdit ? 'Edit template' : 'Template baru'}
        subtitle="Subject dan body dirender dengan Handlebars; gunakan {{{var}}} untuk HTML mentah."
        actions={
          <Link to="/templates" className="btn btn-sm btn-outline-secondary">
            Kembali
          </Link>
        }
      />

      <QueryState
        isLoading={isEdit && existing.isLoading}
        error={isEdit ? existing.error : null}
      >
        <Card>
          <Card.Body>
            {mutationError !== null ? (
              <Alert variant="danger">{describeError(mutationError)}</Alert>
            ) : null}

            <Form onSubmit={handleSubmit(onSubmit)} noValidate>
              <Row className="g-3">
                <Col xs={12} md={4}>
                  <Form.Group controlId="template-key">
                    <Form.Label>Key</Form.Label>
                    <Form.Control
                      isInvalid={errors.key !== undefined}
                      disabled={isEdit}
                      {...register('key')}
                    />
                    <Form.Control.Feedback type="invalid">{errors.key?.message}</Form.Control.Feedback>
                  </Form.Group>
                </Col>
                <Col xs={12} md={3}>
                  <Form.Group controlId="template-channel">
                    <Form.Label>Channel</Form.Label>
                    <Form.Select disabled={isEdit} {...register('channel')}>
                      {CHANNELS.map((channel) => (
                        <option key={channel} value={channel}>
                          {channel}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col xs={12} md={2}>
                  <Form.Group controlId="template-locale">
                    <Form.Label>Locale</Form.Label>
                    <Form.Control
                      isInvalid={errors.locale !== undefined}
                      disabled={isEdit}
                      {...register('locale')}
                    />
                    <Form.Control.Feedback type="invalid">
                      {errors.locale?.message}
                    </Form.Control.Feedback>
                  </Form.Group>
                </Col>
                <Col xs={12} md={3}>
                  <Form.Group controlId="template-version">
                    <Form.Label>Versi</Form.Label>
                    <Form.Control
                      type="number"
                      min={1}
                      disabled={isEdit}
                      {...register('version')}
                    />
                  </Form.Group>
                </Col>

                <Col xs={12}>
                  <Form.Group controlId="template-subject">
                    <Form.Label>Subject</Form.Label>
                    <Form.Control
                      isInvalid={errors.subject !== undefined}
                      {...register('subject')}
                    />
                    <Form.Control.Feedback type="invalid">
                      {errors.subject?.message}
                    </Form.Control.Feedback>
                  </Form.Group>
                </Col>

                <Col xs={12}>
                  <Form.Group controlId="template-body">
                    <Form.Label>Body</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={8}
                      className="font-monospace"
                      isInvalid={errors.body !== undefined}
                      {...register('body')}
                    />
                    <Form.Control.Feedback type="invalid">
                      {errors.body?.message}
                    </Form.Control.Feedback>
                    <Form.Text className="text-muted">
                      Contoh: Halo {'{{nama}}'}, pesanan Anda sudah dikirim.
                    </Form.Text>
                  </Form.Group>
                </Col>

                <Col xs={12} md={4}>
                  <Form.Group controlId="template-fallback-channel">
                    <Form.Label>Fallback channel</Form.Label>
                    <Form.Select {...register('fallbackChannel')}>
                      <option value="">Tidak ada</option>
                      {CHANNELS.map((channel) => (
                        <option key={channel} value={channel}>
                          {channel}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col xs={12} md={4}>
                  <Form.Group controlId="template-fallback-provider">
                    <Form.Label>Fallback provider</Form.Label>
                    <Form.Control
                      placeholder="reserved"
                      isInvalid={errors.fallbackProvider !== undefined}
                      {...register('fallbackProvider')}
                    />
                  </Form.Group>
                </Col>
              </Row>

              <div className="d-flex gap-2 mt-4">
                <Button type="submit" disabled={busy}>
                  {busy ? <Spinner animation="border" size="sm" /> : 'Simpan'}
                </Button>
                <Button
                  type="button"
                  variant="outline-secondary"
                  onClick={() => navigate('/templates')}
                  disabled={busy}
                >
                  Batal
                </Button>
              </div>
            </Form>
          </Card.Body>
        </Card>
      </QueryState>
    </>
  );
}
