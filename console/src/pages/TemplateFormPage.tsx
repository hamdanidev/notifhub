import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  Nav,
  Row,
  Spinner,
} from 'react-bootstrap';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { PublishDialog } from '../components/PublishDialog';
import { QueryState } from '../components/QueryState';
import { TemplatePreviewPane } from '../components/TemplatePreviewPane';
import { TemplateStatusBadge } from '../components/TemplateStatusBadge';
import { TestSendDialog } from '../components/TestSendDialog';
import {
  cloneTemplate,
  createTemplate,
  getTemplate,
  listLayouts,
  listPartials,
  listThemes,
  previewInline,
  publishTemplate,
  testSendTemplate,
  updateTemplate,
} from '../lib/adminTemplates';
import { describeError } from '../lib/format';
import type {
  Channel,
  PreviewResult,
  TemplateDirection,
  TemplateFormat,
  TemplateSummary,
  TemplateValidationIssue,
  TestSendResult,
} from '../lib/templateTypes';

interface TemplateFormState {
  key: string;
  channel: Channel;
  locale: string;
  subject: string;
  preheader: string;
  body: string;
  format: TemplateFormat;
  direction: TemplateDirection;
  strictVariables: boolean;
  layoutId: string;
  themeId: string;
  partialIds: string[];
  variablesText: string;
  sampleText: string;
  fallbackChannel: string;
  fallbackProvider: string;
}

const CHANNELS: Channel[] = ['inapp', 'email', 'whatsapp', 'sms'];
const EMPTY_VARIABLES = '{\n  "version": 1,\n  "variables": []\n}';

const SNIPPETS: Array<{ label: string; value: string }> = [
  {
    label: 'Paragraf',
    value: '<p style="margin:0 0 16px 0;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#111111">Teks paragraf di sini.</p>',
  },
  {
    label: 'CTA button',
    value:
      '<p style="margin:24px 0"><a href="{{cta.url}}" style="display:inline-block;padding:12px 20px;background:#0d6efd;color:#ffffff;text-decoration:none;border-radius:6px;font-family:Arial,sans-serif">Lihat detail</a></p>',
  },
  {
    label: 'Divider',
    value: '<hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0">',
  },
  {
    label: 'Spacer',
    value: '<div style="height:24px;line-height:24px;font-size:0">&nbsp;</div>',
  },
  {
    label: 'Gambar',
    value:
      '<img src="{{image.url}}" alt="{{image.alt}}" width="552" style="display:block;width:100%;max-width:552px;height:auto;border:0">',
  },
];

function emptyForm(): TemplateFormState {
  return {
    key: '',
    channel: 'email',
    locale: 'id',
    subject: '',
    preheader: '',
    body: '<p style="font-family:Arial,sans-serif">Halo {{nama}},</p>',
    format: 'html',
    direction: 'auto',
    strictVariables: true,
    layoutId: '',
    themeId: '',
    partialIds: [],
    variablesText:
      '{\n  "version": 1,\n  "variables": [\n    { "key": "nama", "type": "string", "required": true, "example": "Budi" }\n  ]\n}',
    sampleText: '{\n  "nama": "Budi"\n}',
    fallbackChannel: '',
    fallbackProvider: '',
  };
}

function toForm(template: TemplateSummary): TemplateFormState {
  return {
    key: template.key,
    channel: template.channel,
    locale: template.locale,
    subject: template.subject ?? '',
    preheader: template.preheader ?? '',
    body: template.body ?? '',
    format: template.format,
    direction: template.direction,
    strictVariables: template.strictVariables,
    layoutId: template.layoutId ?? '',
    themeId: template.themeId ?? '',
    partialIds: template.partialIds,
    variablesText: JSON.stringify(template.variables ?? { version: 1, variables: [] }, null, 2),
    sampleText: JSON.stringify(template.sampleData ?? {}, null, 2),
    fallbackChannel: template.fallbackChannel ?? '',
    fallbackProvider: template.fallbackProvider ?? '',
  };
}

export function TemplateFormPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const isEdit = id !== undefined;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<TemplateFormState>(emptyForm);
  const [current, setCurrent] = useState<TemplateSummary | null>(null);
  const [validation, setValidation] = useState<TemplateValidationIssue[]>([]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [darkCanvas, setDarkCanvas] = useState(false);
  const [activeTab, setActiveTab] = useState('content');
  const [publishOpen, setPublishOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testResult, setTestResult] = useState<TestSendResult | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const baselineRef = useRef<string>(JSON.stringify(emptyForm()));
  const requestRef = useRef(0);
  const skipBlockerRef = useRef(false);

  const existing = useQuery({
    queryKey: ['template', id],
    queryFn: () => getTemplate(id ?? ''),
    enabled: isEdit,
  });

  const layouts = useQuery({ queryKey: ['template-assets', 'layouts'], queryFn: () => listLayouts() });
  const themes = useQuery({ queryKey: ['template-assets', 'themes'], queryFn: () => listThemes() });
  const partials = useQuery({
    queryKey: ['template-assets', 'partials'],
    queryFn: () => listPartials(),
  });

  useEffect(() => {
    if (existing.data !== undefined) {
      setCurrent(existing.data);
      const next = toForm(existing.data);
      setForm(next);
      baselineRef.current = JSON.stringify(next);
      setValidation([]);
      setPreview(null);
      setPreviewError(null);
    }
  }, [existing.data]);

  useEffect(() => {
    if (!isEdit) {
      const next = emptyForm();
      setForm(next);
      baselineRef.current = JSON.stringify(next);
      setCurrent(null);
    }
  }, [isEdit]);

  const dirty = useMemo(
    () => JSON.stringify(form) !== baselineRef.current,
    [form, baselineRef.current],
  );

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent): void => {
      if (!dirty) {
        return;
      }
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !skipBlockerRef.current &&
      currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      return;
    }

    const leave = window.confirm('Ada perubahan yang belum disimpan. Tinggalkan halaman ini?');

    if (leave) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker]);

  const readOnly = current?.status === 'published';

  const parsed = useMemo(() => {
    try {
      const variables = JSON.parse(form.variablesText) as unknown;
      const sampleData = JSON.parse(form.sampleText) as unknown;

      if (!isRecord(variables) || !Array.isArray(variables.variables)) {
        return { error: 'Variables harus berisi objek dengan array "variables".', variables: null, sampleData: null };
      }

      if (!isRecord(sampleData)) {
        return { error: 'Sample data harus berupa objek JSON.', variables: null, sampleData: null };
      }

      return { error: null, variables, sampleData };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'JSON tidak valid.',
        variables: null,
        sampleData: null,
      };
    }
  }, [form.sampleText, form.variablesText]);

  const buildPreviewInput = useCallback(() => {
    if (parsed.error !== null) {
      throw new Error(parsed.error);
    }

    return {
      channel: form.channel,
      format: form.format,
      subject: form.channel === 'email' ? form.subject : null,
      preheader: form.channel === 'email' ? form.preheader : null,
      body: form.body,
      locale: form.locale,
      direction: form.direction,
      strictVariables: form.strictVariables,
      variables: parsed.variables,
      sampleData: parsed.sampleData,
      layoutId: form.channel === 'email' && form.layoutId !== '' ? form.layoutId : null,
      themeId: form.channel === 'email' && form.themeId !== '' ? form.themeId : null,
      partialIds: form.channel === 'email' ? form.partialIds : [],
    };
  }, [form, parsed]);

  const refreshPreview = useCallback(async () => {
    if (form.body.trim().length === 0) {
      setPreview(null);
      return;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setPreviewLoading(true);
    setPreviewError(null);

    try {
      const result = await previewInline(buildPreviewInput());

      if (requestRef.current === requestId) {
        setPreview(result);
      }
    } catch (error) {
      if (requestRef.current === requestId) {
        setPreviewError(error);
      }
    } finally {
      if (requestRef.current === requestId) {
        setPreviewLoading(false);
      }
    }
  }, [buildPreviewInput, form.body]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshPreview();
    }, 800);

    return () => window.clearTimeout(timer);
  }, [refreshPreview]);

  const save = useMutation({
    mutationFn: async () => {
      if (parsed.error !== null) {
        throw new Error(parsed.error);
      }

      if (isEdit && current === null) {
        throw new Error('Template belum selesai dimuat.');
      }

      const payload = {
        subject: form.channel === 'email' ? form.subject : undefined,
        preheader: form.channel === 'email' ? form.preheader : undefined,
        body: form.body,
        format: form.format,
        direction: form.direction,
        strictVariables: form.strictVariables,
        variables: parsed.variables,
        sampleData: parsed.sampleData,
        layoutId: form.channel === 'email' && form.layoutId !== '' ? form.layoutId : null,
        themeId: form.channel === 'email' && form.themeId !== '' ? form.themeId : null,
        partialIds: form.channel === 'email' ? form.partialIds : [],
        fallbackChannel:
          form.fallbackChannel === '' ? null : (form.fallbackChannel as Channel),
        fallbackProvider: form.fallbackProvider === '' ? null : form.fallbackProvider,
      };

      if (isEdit && current !== null) {
        return updateTemplate(current.id, {
          ...payload,
          expectedRevision: current.revision,
        });
      }

      return createTemplate({
        ...payload,
        key: form.key,
        channel: form.channel,
        locale: form.locale,
        status: 'draft',
      });
    },
    onSuccess: (result) => {
      setActionError(null);
      setValidation(result.validation);
      setCurrent(result);
      const next = toForm(result);
      setForm(next);
      baselineRef.current = JSON.stringify(next);
      setSaveNotice(`Draft tersimpan (revision ${result.revision}).`);
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
      void queryClient.invalidateQueries({ queryKey: ['template', result.id] });
      if (!isEdit) {
        skipBlockerRef.current = true;
        window.setTimeout(() => {
          skipBlockerRef.current = false;
        }, 100);
        navigate(`/templates/${result.id}/edit`);
      }
    },
    onError: (error) => setActionError(error),
  });

  const publish = useMutation({
    mutationFn: async (note: string) => {
      if (current === null) {
        throw new Error('Simpan draft sebelum publish.');
      }

      return publishTemplate(current.id, current.revision, note);
    },
    onSuccess: (result) => {
      setActionError(null);
      setValidation(result.validation);
      setCurrent(result);
      const next = toForm(result);
      setForm(next);
      baselineRef.current = JSON.stringify(next);
      setPublishOpen(false);
      setSaveNotice(`Template dipublish sebagai versi ${result.version}.`);
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
      void queryClient.invalidateQueries({ queryKey: ['template', result.id] });
    },
    onError: (error) => setActionError(error),
  });

  const testSend = useMutation({
    mutationFn: async (recipient: string) => {
      if (current === null) {
        throw new Error('Simpan draft sebelum test kirim.');
      }

      return testSendTemplate(current.id, {
        recipient,
        ...(parsed.sampleData === null ? {} : { sampleData: parsed.sampleData }),
      });
    },
    onSuccess: (result) => {
      setTestResult(result);
      setActionError(null);
    },
    onError: (error) => setActionError(error),
  });

  const clone = useMutation({
    mutationFn: async () => {
      if (current === null) {
        throw new Error('Template belum tersimpan.');
      }

      return cloneTemplate(current.id, {});
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
      navigate(`/templates/${result.id}/edit`);
    },
    onError: (error) => setActionError(error),
  });

  const totalBusy = save.isPending || publish.isPending || clone.isPending || testSend.isPending;

  return (
    <>
      <PageHeader
        title={isEdit ? 'Editor template' : 'Template baru'}
        subtitle={
          current !== null
            ? `${current.key} · ${current.channel} · ${current.locale} · versi ${current.version}`
            : 'Draft baru; simpan sebelum publish atau test kirim.'
        }
        actions={
          <>
            <Link to="/templates" className="btn btn-sm btn-outline-secondary">
              Kembali
            </Link>
            <Link to="/templates/assets" className="btn btn-sm btn-outline-secondary">
              Aset
            </Link>
            {current !== null ? (
              <Link to={`/templates/${current.id}/history`} className="btn btn-sm btn-outline-secondary">
                Riwayat
              </Link>
            ) : null}
            {readOnly ? (
              <Button size="sm" variant="dark" onClick={() => clone.mutate()} disabled={clone.isPending}>
                Buat draft dari versi ini
              </Button>
            ) : (
              <>
                <Button size="sm" variant="outline-primary" onClick={() => save.mutate()} disabled={totalBusy || (isEdit && current === null)}>
                  {save.isPending ? <Spinner animation="border" size="sm" /> : 'Simpan draft'}
                </Button>
                <Button
                  size="sm"
                  variant="dark"
                  onClick={() => setPublishOpen(true)}
                  disabled={totalBusy || current === null || dirty}
                  title={dirty ? 'Simpan draft sebelum publish' : undefined}
                >
                  Publish
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="outline-secondary"
              onClick={() => {
                setTestResult(null);
                setTestOpen(true);
              }}
              disabled={totalBusy || current === null || dirty}
              title={dirty ? 'Simpan draft sebelum test kirim' : undefined}
            >
              Test kirim
            </Button>
          </>
        }
      />

      {current !== null ? (
        <div className="d-flex align-items-center gap-2 mb-3">
          <TemplateStatusBadge status={current.status} />
          <Badge bg="light" text="dark" className="fw-normal">
            revision {current.revision}
          </Badge>
          {readOnly ? (
            <span className="small text-muted">Published read-only. Buat draft untuk mengubah konten.</span>
          ) : null}
          {dirty ? <span className="small text-warning-emphasis">Ada perubahan belum disimpan.</span> : null}
        </div>
      ) : null}

      {saveNotice !== null ? (
        <Alert variant="success" className="py-2" dismissible onClose={() => setSaveNotice(null)}>
          {saveNotice}
        </Alert>
      ) : null}
      {actionError !== null ? (
        <Alert variant="danger" className="py-2" dismissible onClose={() => setActionError(null)}>
          {describeError(actionError)}
        </Alert>
      ) : null}
      {parsed.error !== null ? <Alert variant="warning" className="py-2">{parsed.error}</Alert> : null}
      {validation.length > 0 ? (
        <Alert variant={validation.some((issue) => issue.severity === 'error') ? 'danger' : 'warning'} className="py-2">
          <div className="fw-semibold small mb-1">Validasi template</div>
          <ul className="mb-0 ps-3 small">
            {validation.map((issue) => (
              <li key={`${issue.code}-${issue.path}-${issue.message}`}>
                [{issue.severity}] {issue.path}: {issue.message}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <QueryState
        isLoading={isEdit && existing.isLoading}
        error={isEdit ? existing.error : null}
        skeleton="card"
      >
        <Row className="g-3">
          <Col xl={7}>
            <Card>
              <Card.Header>
                <Nav variant="tabs" activeKey={activeTab} onSelect={(key) => setActiveTab(key ?? 'content')}>
                  <Nav.Item>
                    <Nav.Link eventKey="content">Konten</Nav.Link>
                  </Nav.Item>
                  <Nav.Item>
                    <Nav.Link eventKey="variables">Variabel</Nav.Link>
                  </Nav.Item>
                  <Nav.Item>
                    <Nav.Link eventKey="assets">Aset</Nav.Link>
                  </Nav.Item>
                  <Nav.Item>
                    <Nav.Link eventKey="settings">Pengaturan</Nav.Link>
                  </Nav.Item>
                </Nav>
              </Card.Header>
              <Card.Body>
                {activeTab === 'content' ? (
                  <ContentTab
                    form={form}
                    setForm={setForm}
                    readOnly={readOnly === true}
                    isEdit={isEdit}
                    onInsertSnippet={(value) =>
                      setForm((previous) => ({ ...previous, body: `${previous.body}\n${value}` }))
                    }
                  />
                ) : null}
                {activeTab === 'variables' ? (
                  <VariablesTab
                    form={form}
                    setForm={setForm}
                    readOnly={readOnly === true}
                    parsed={parsed}
                  />
                ) : null}
                {activeTab === 'assets' ? (
                  <AssetsTab
                    form={form}
                    setForm={setForm}
                    readOnly={readOnly === true}
                    layouts={layouts.data?.items ?? []}
                    themes={themes.data?.items ?? []}
                    partials={partials.data?.items ?? []}
                    currentLayout={current?.layout ?? null}
                    currentTheme={current?.theme ?? null}
                  />
                ) : null}
                {activeTab === 'settings' ? (
                  <SettingsTab form={form} setForm={setForm} readOnly={readOnly === true} />
                ) : null}
              </Card.Body>
            </Card>
          </Col>
          <Col xl={5}>
            <TemplatePreviewPane
              preview={preview}
              loading={previewLoading}
              error={previewError}
              viewport={viewport}
              onViewportChange={setViewport}
              darkCanvas={darkCanvas}
              onDarkCanvasChange={setDarkCanvas}
              onRefresh={() => void refreshPreview()}
            />
          </Col>
        </Row>
      </QueryState>

      <PublishDialog
        show={publishOpen}
        templateKey={current?.key ?? form.key}
        version={current?.version ?? 1}
        validation={validation}
        busy={publish.isPending}
        error={publish.error}
        onCancel={() => setPublishOpen(false)}
        onConfirm={(note) => publish.mutate(note)}
      />
      <TestSendDialog
        show={testOpen}
        channel={form.channel}
        busy={testSend.isPending}
        result={testResult}
        error={testSend.error}
        onCancel={() => setTestOpen(false)}
        onSend={(recipient) => testSend.mutate(recipient)}
      />
    </>
  );
}

function ContentTab({
  form,
  setForm,
  readOnly,
  isEdit,
  onInsertSnippet,
}: {
  form: TemplateFormState;
  setForm: Dispatch<SetStateAction<TemplateFormState>>;
  readOnly: boolean;
  isEdit: boolean;
  onInsertSnippet: (value: string) => void;
}): JSX.Element {
  return (
    <>
      <Row className="g-3">
        <Col xs={12} md={5}>
          <Form.Group controlId="template-key">
            <Form.Label>Key</Form.Label>
            <Form.Control
              value={form.key}
              disabled={readOnly || isEdit}
              onChange={(event) => setForm((prev) => ({ ...prev, key: event.target.value }))}
            />
          </Form.Group>
        </Col>
        <Col xs={12} md={3}>
          <Form.Group controlId="template-channel">
            <Form.Label>Channel</Form.Label>
            <Form.Select
              value={form.channel}
              disabled={readOnly || isEdit}
              onChange={(event) => {
                const channel = event.target.value as Channel;
                setForm((prev) => ({
                  ...prev,
                  channel,
                  format: channel === 'email' ? 'html' : 'text',
                  subject: channel === 'email' ? prev.subject : '',
                  preheader: channel === 'email' ? prev.preheader : '',
                  layoutId: channel === 'email' ? prev.layoutId : '',
                  themeId: channel === 'email' ? prev.themeId : '',
                  partialIds: channel === 'email' ? prev.partialIds : [],
                }));
              }}
            >
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
              value={form.locale}
              disabled={readOnly || isEdit}
              onChange={(event) => setForm((prev) => ({ ...prev, locale: event.target.value }))}
            />
          </Form.Group>
        </Col>
        <Col xs={12} md={2}>
          <Form.Group controlId="template-direction">
            <Form.Label>Arah</Form.Label>
            <Form.Select
              value={form.direction}
              disabled={readOnly}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, direction: event.target.value as TemplateDirection }))
              }
            >
              <option value="auto">auto</option>
              <option value="ltr">ltr</option>
              <option value="rtl">rtl</option>
            </Form.Select>
          </Form.Group>
        </Col>
      </Row>

      {form.channel === 'email' ? (
        <Row className="g-3 mt-1">
          <Col xs={12}>
            <Form.Group controlId="template-subject">
              <Form.Label>Subject</Form.Label>
              <Form.Control
                value={form.subject}
                disabled={readOnly}
                maxLength={255}
                onChange={(event) => setForm((prev) => ({ ...prev, subject: event.target.value }))}
              />
            </Form.Group>
          </Col>
          <Col xs={12}>
            <Form.Group controlId="template-preheader">
              <Form.Label>Preheader</Form.Label>
              <Form.Control
                value={form.preheader}
                disabled={readOnly}
                maxLength={200}
                onChange={(event) => setForm((prev) => ({ ...prev, preheader: event.target.value }))}
              />
            </Form.Group>
          </Col>
        </Row>
      ) : null}

      <div className="d-flex align-items-center justify-content-between mt-3 mb-1">
        <Form.Label className="mb-0">Body</Form.Label>
        <div className="d-flex gap-1 flex-wrap">
          {SNIPPETS.map((snippet) => (
            <Button
              key={snippet.label}
              size="sm"
              variant="outline-secondary"
              disabled={readOnly}
              onClick={() => onInsertSnippet(snippet.value)}
            >
              + {snippet.label}
            </Button>
          ))}
        </div>
      </div>
      <Form.Control
        as="textarea"
        rows={16}
        className="font-monospace small"
        value={form.body}
        disabled={readOnly}
        onChange={(event) => setForm((prev) => ({ ...prev, body: event.target.value }))}
      />
      <div className="d-flex justify-content-between small text-muted mt-1">
        <span>
          Handlebars: {'{{var}}'} escape HTML untuk email; {'{{{var}}}'} mentah. Teks memakai nilai
          apa adanya.
        </span>
        <span>{form.body.length} karakter</span>
      </div>
      {form.channel === 'whatsapp' ? (
        <div className={form.body.length > 4096 ? 'small text-danger mt-1' : 'small text-muted mt-1'}>
          WhatsApp: {form.body.length}/4096 karakter
        </div>
      ) : null}
    </>
  );
}

function VariablesTab({
  form,
  setForm,
  readOnly,
  parsed,
}: {
  form: TemplateFormState;
  setForm: Dispatch<SetStateAction<TemplateFormState>>;
  readOnly: boolean;
  parsed: { error: string | null; variables: unknown; sampleData: unknown };
}): JSX.Element {
  const variables = useMemo(() => {
    if (!isRecord(parsed.variables) || !Array.isArray(parsed.variables.variables)) {
      return [];
    }

    return parsed.variables.variables.filter(isRecord);
  }, [parsed.variables]);

  return (
    <>
      <p className="small text-muted">
        Schema variabel menentukan required/optional, tipe, contoh, dan default. Sample data dipakai
        untuk preview dan wajib memenuhi variabel required sebelum publish.
      </p>
      <Row className="g-3">
        <Col xs={12} lg={6}>
          <Form.Group controlId="template-variables">
            <Form.Label>Variables JSON</Form.Label>
            <Form.Control
              as="textarea"
              rows={14}
              className="font-monospace small"
              value={form.variablesText}
              disabled={readOnly}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, variablesText: event.target.value }))
              }
            />
          </Form.Group>
        </Col>
        <Col xs={12} lg={6}>
          <Form.Group controlId="template-sample">
            <Form.Label className="d-flex justify-content-between">
              <span>Sample data JSON</span>
              <Button
                size="sm"
                variant="link"
                className="p-0"
                disabled={readOnly}
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    sampleText: JSON.stringify(buildSampleFromSchema(variables), null, 2),
                  }))
                }
              >
                Isi dari contoh
              </Button>
            </Form.Label>
            <Form.Control
              as="textarea"
              rows={14}
              className="font-monospace small"
              value={form.sampleText}
              disabled={readOnly}
              onChange={(event) => setForm((prev) => ({ ...prev, sampleText: event.target.value }))}
            />
          </Form.Group>
        </Col>
      </Row>
      {variables.length > 0 ? (
        <div className="table-responsive mt-3">
          <table className="table table-sm small">
            <thead>
              <tr>
                <th>Key</th>
                <th>Tipe</th>
                <th>Wajib</th>
                <th>Deskripsi</th>
              </tr>
            </thead>
            <tbody>
              {variables.map((variable) => (
                <tr key={String(variable.key)}>
                  <td>
                    <code>{String(variable.key)}</code>
                  </td>
                  <td>{String(variable.type)}</td>
                  <td>{variable.required === true ? 'ya' : 'tidak'}</td>
                  <td>{typeof variable.description === 'string' ? variable.description : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

function AssetsTab({
  form,
  setForm,
  readOnly,
  layouts,
  themes,
  partials,
  currentLayout,
  currentTheme,
}: {
  form: TemplateFormState;
  setForm: Dispatch<SetStateAction<TemplateFormState>>;
  readOnly: boolean;
  layouts: Array<{ id: string; key: string; version: number; name: string }>;
  themes: Array<{ id: string; key: string; version: number; name: string }>;
  partials: Array<{ id: string; key: string; version: number; name: string }>;
  currentLayout: { id: string; key: string; version: number } | null;
  currentTheme: { id: string; key: string; version: number } | null;
}): JSX.Element {
  if (form.channel !== 'email') {
    return (
      <Alert variant="light" className="small mb-0">
        Layout, theme, dan partial hanya untuk channel email. Template {form.channel} memakai body
        teks polos.
      </Alert>
    );
  }

  return (
    <>
      <p className="small text-muted">
        Aset bersifat immutable per versi; template published tetap memakai versi yang dipilih.
        Buat versi baru di halaman Aset, lalu pilih di sini.
      </p>
      <Row className="g-3">
        <Col xs={12} md={6}>
          <Form.Group controlId="template-layout">
            <Form.Label>Layout</Form.Label>
            <Form.Select
              value={form.layoutId}
              disabled={readOnly}
              onChange={(event) => setForm((prev) => ({ ...prev, layoutId: event.target.value }))}
            >
              <option value="">Tanpa layout</option>
              {currentLayout !== null && !layouts.some((asset) => asset.id === currentLayout.id) ? (
                <option value={currentLayout.id}>
                  {currentLayout.key} v{currentLayout.version} (dipakai)
                </option>
              ) : null}
              {layouts.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name} · {asset.key} v{asset.version}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        </Col>
        <Col xs={12} md={6}>
          <Form.Group controlId="template-theme">
            <Form.Label>Theme</Form.Label>
            <Form.Select
              value={form.themeId}
              disabled={readOnly}
              onChange={(event) => setForm((prev) => ({ ...prev, themeId: event.target.value }))}
            >
              <option value="">Tanpa theme</option>
              {currentTheme !== null && !themes.some((asset) => asset.id === currentTheme.id) ? (
                <option value={currentTheme.id}>
                  {currentTheme.key} v{currentTheme.version} (dipakai)
                </option>
              ) : null}
              {themes.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name} · {asset.key} v{asset.version}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        </Col>
        <Col xs={12}>
          <Form.Group controlId="template-partials">
            <Form.Label>Partial</Form.Label>
            <Form.Select
              multiple
              value={form.partialIds}
              disabled={readOnly}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  partialIds: Array.from(event.target.selectedOptions).map(
                    (option) => option.value,
                  ),
                }))
              }
            >
              {partials.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name} · {asset.key} v{asset.version}
                </option>
              ))}
            </Form.Select>
            <Form.Text className="text-muted">
              Partial direferensikan di body/layout dengan {'{{> key}}'}.
            </Form.Text>
          </Form.Group>
        </Col>
      </Row>
    </>
  );
}

function SettingsTab({
  form,
  setForm,
  readOnly,
}: {
  form: TemplateFormState;
  setForm: Dispatch<SetStateAction<TemplateFormState>>;
  readOnly: boolean;
}): JSX.Element {
  return (
    <Row className="g-3">
      <Col xs={12}>
        <Form.Check
          type="switch"
          id="template-strict"
          label="Strict variables (variabel required wajib ada saat kirim)"
          checked={form.strictVariables}
          disabled={readOnly}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, strictVariables: event.target.checked }))
          }
        />
      </Col>
      <Col xs={12} md={6}>
        <Form.Group controlId="template-fallback-channel">
          <Form.Label>Fallback channel</Form.Label>
          <Form.Select
            value={form.fallbackChannel}
            disabled={readOnly}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, fallbackChannel: event.target.value }))
            }
          >
            <option value="">Tidak ada</option>
            {CHANNELS.filter((channel) => channel !== form.channel).map((channel) => (
              <option key={channel} value={channel}>
                {channel}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
      </Col>
      <Col xs={12} md={6}>
        <Form.Group controlId="template-fallback-provider">
          <Form.Label>Fallback provider</Form.Label>
          <Form.Control
            value={form.fallbackProvider}
            disabled={readOnly}
            placeholder="reserved"
            onChange={(event) =>
              setForm((prev) => ({ ...prev, fallbackProvider: event.target.value }))
            }
          />
        </Form.Group>
      </Col>
      <Col xs={12}>
        <Alert variant="light" className="small mb-0">
          Format ditentukan channel: email html, lainnya text. Perubahan pada versi published harus
          lewat draft baru; editor ini akan meminta clone.
        </Alert>
      </Col>
    </Row>
  );
}

function buildSampleFromSchema(variables: Array<Record<string, unknown>>): Record<string, unknown> {
  const sample: Record<string, unknown> = {};

  for (const variable of variables) {
    const key = typeof variable.key === 'string' ? variable.key : '';
    const example = variable.example;

    if (key.length === 0 || example === undefined) {
      continue;
    }

    const segments = key.split('.');
    let cursor = sample;

    for (const segment of segments.slice(0, -1)) {
      const existing = cursor[segment];

      if (!isRecord(existing)) {
        cursor[segment] = {};
      }

      cursor = cursor[segment] as Record<string, unknown>;
    }

    const last = segments[segments.length - 1];

    if (last !== undefined) {
      cursor[last] = example;
    }
  }

  return sample;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
