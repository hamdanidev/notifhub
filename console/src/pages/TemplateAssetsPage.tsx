import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
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
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import {
  createLayout,
  createPartial,
  createTheme,
  deleteLayout,
  deletePartial,
  deleteTheme,
  getLayout,
  getPartial,
  getTheme,
  listLayouts,
  listPartials,
  listThemes,
} from '../lib/adminTemplates';
import {
  DEFAULT_LAYOUT_OPTIONS,
  DEFAULT_PARTIAL_OPTIONS,
  DEFAULT_THEME_FORM,
  FONT_OPTIONS,
  LAYOUT_PRESETS,
  PARTIAL_PRESETS,
  buildLayoutHtml,
  buildPartialHtml,
  renderAssetPreview,
  themeFormFromTokens,
  themeTokensFromForm,
  type LayoutOptions,
  type LayoutPresetId,
  type PartialOptions,
  type PartialPresetId,
  type ThemeFormValues,
} from '../lib/emailDesign';
import { describeError, formatDateTime } from '../lib/format';

type AssetType = 'themes' | 'layouts' | 'partials';

interface AssetRow {
  id: string;
  key: string;
  name: string;
  version: number;
  usageCount: number;
  createdAt: string;
}

const DEFAULT_KEYS: Record<AssetType, { key: string; name: string }> = {
  themes: { key: 'brand', name: 'Brand theme' },
  layouts: { key: 'base', name: 'Base layout' },
  partials: { key: 'header', name: 'Header' },
};

export function TemplateAssetsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [activeType, setActiveType] = useState<AssetType>('themes');
  const [key, setKey] = useState(DEFAULT_KEYS.themes.key);
  const [name, setName] = useState(DEFAULT_KEYS.themes.name);
  const [advanced, setAdvanced] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingAssetId, setLoadingAssetId] = useState<string | null>(null);

  const [themeForm, setThemeForm] = useState<ThemeFormValues>(DEFAULT_THEME_FORM);
  const [themeJson, setThemeJson] = useState(
    JSON.stringify(themeTokensFromForm(DEFAULT_THEME_FORM), null, 2),
  );
  const [layoutPreset, setLayoutPreset] = useState<LayoutPresetId>('transactional');
  const [layoutOptions, setLayoutOptions] = useState<LayoutOptions>(DEFAULT_LAYOUT_OPTIONS);
  const [layoutContent, setLayoutContent] = useState('');
  const [partialPreset, setPartialPreset] = useState<PartialPresetId>('header');
  const [partialOptions, setPartialOptions] = useState<PartialOptions>(DEFAULT_PARTIAL_OPTIONS);
  const [partialContent, setPartialContent] = useState('');

  const layouts = useQuery({ queryKey: ['template-assets', 'layouts'], queryFn: () => listLayouts() });
  const themes = useQuery({ queryKey: ['template-assets', 'themes'], queryFn: () => listThemes() });
  const partials = useQuery({
    queryKey: ['template-assets', 'partials'],
    queryFn: () => listPartials(),
  });

  useEffect(() => {
    const defaults = DEFAULT_KEYS[activeType];
    setKey(defaults.key);
    setName(defaults.name);
    setAdvanced(false);
    setFormError(null);
    setNotice(null);
  }, [activeType]);

  const themeTokens = useMemo<Record<string, unknown>>(() => {
    if (activeType === 'themes' && advanced) {
      try {
        const parsed: unknown = JSON.parse(themeJson);

        if (isRecord(parsed)) {
          return parsed;
        }
      } catch {
        // handled by the form error on save; preview falls back to the form values
      }
    }

    return themeTokensFromForm(themeForm);
  }, [activeType, advanced, themeForm, themeJson]);

  const activeContent = useMemo(() => {
    if (activeType === 'layouts') {
      return advanced && layoutContent.trim().length > 0
        ? layoutContent
        : buildLayoutHtml(layoutPreset, layoutOptions);
    }

    if (activeType === 'partials') {
      return advanced && partialContent.trim().length > 0
        ? partialContent
        : buildPartialHtml(partialPreset, partialOptions);
    }

    return '';
  }, [
    activeType,
    advanced,
    layoutContent,
    layoutOptions,
    layoutPreset,
    partialContent,
    partialOptions,
    partialPreset,
  ]);

  const previewHtml = useMemo(() => {
    if (activeType === 'themes') {
      return renderAssetPreview(
        buildLayoutHtml('transactional', DEFAULT_LAYOUT_OPTIONS),
        themeTokens,
      );
    }

    if (activeType === 'layouts') {
      return renderAssetPreview(activeContent, themeTokens);
    }

    return renderAssetPreview(activeContent, themeTokens, { partial: true });
  }, [activeContent, activeType, themeTokens]);

  const create = useMutation({
    mutationFn: async () => {
      if (key.trim().length === 0 || name.trim().length === 0) {
        throw new Error('Key dan nama wajib diisi.');
      }

      if (activeType === 'themes') {
        const tokens = advanced
          ? parseJsonRecord(themeJson, 'Tokens theme')
          : themeTokensFromForm(themeForm);

        return createTheme({ key: key.trim(), name: name.trim(), tokens });
      }

      if (activeType === 'layouts') {
        const content = advanced ? layoutContent : buildLayoutHtml(layoutPreset, layoutOptions);

        if (content.trim().length === 0) {
          throw new Error('Konten layout wajib diisi.');
        }

        return createLayout({ key: key.trim(), name: name.trim(), content });
      }

      const content = advanced ? partialContent : buildPartialHtml(partialPreset, partialOptions);

      if (content.trim().length === 0) {
        throw new Error('Konten partial wajib diisi.');
      }

      return createPartial({ key: key.trim(), name: name.trim(), content });
    },
    onSuccess: (asset) => {
      setFormError(null);
      setNotice(`Versi baru dibuat: ${asset.key} v${asset.version}.`);
      void queryClient.invalidateQueries({ queryKey: ['template-assets'] });
    },
    onError: (error) => {
      setFormError(describeError(error));
      setNotice(null);
    },
  });

  const remove = useMutation({
    mutationFn: async (input: { type: AssetType; row: AssetRow }) => {
      if (input.type === 'themes') {
        return deleteTheme(input.row.id);
      }

      if (input.type === 'layouts') {
        return deleteLayout(input.row.id);
      }

      return deletePartial(input.row.id);
    },
    onSuccess: (_result, input) => {
      setFormError(null);
      setNotice(`Dihapus: ${input.row.key} v${input.row.version}.`);
      void queryClient.invalidateQueries({ queryKey: ['template-assets'] });
    },
    onError: (error) => {
      setFormError(describeError(error));
      setNotice(null);
    },
  });

  const loadAsset = async (row: AssetRow): Promise<void> => {    setLoadingAssetId(row.id);
    setFormError(null);
    setNotice(null);

    try {
      if (activeType === 'themes') {
        const detail = await getTheme(row.id);
        setThemeForm(themeFormFromTokens(detail.tokens));
        setThemeJson(JSON.stringify(detail.tokens ?? {}, null, 2));
        setAdvanced(false);
      } else if (activeType === 'layouts') {
        const detail = await getLayout(row.id);
        setLayoutContent(detail.content ?? '');
        setAdvanced(true);
      } else {
        const detail = await getPartial(row.id);
        setPartialContent(detail.content ?? '');
        setAdvanced(true);
      }

      setKey(row.key);
      setName(row.name);
      setNotice(`Dimuat: ${row.key} v${row.version}. Simpan untuk membuat versi baru.`);
    } catch (error) {
      setFormError(describeError(error));
    } finally {
      setLoadingAssetId(null);
    }
  };

  const rows = useMemo<AssetRow[]>(() => {
    const source =
      activeType === 'themes'
        ? (themes.data?.items ?? [])
        : activeType === 'layouts'
          ? (layouts.data?.items ?? [])
          : (partials.data?.items ?? []);

    return source.map((asset) => ({
      id: asset.id,
      key: asset.key,
      name: asset.name,
      version: asset.version,
      usageCount: asset.usageCount,
      createdAt: asset.createdAt,
    }));
  }, [activeType, layouts.data, partials.data, themes.data]);

  const activeQuery = activeType === 'themes' ? themes : activeType === 'layouts' ? layouts : partials;

  return (
    <>
      <PageHeader
        title="Aset template"
        subtitle="Theme, layout, dan partial tanpa menulis kode untuk kasus umum."
        actions={
          <>
            <Button
              size="sm"
              variant="outline-secondary"
              onClick={() => {
                void layouts.refetch();
                void themes.refetch();
                void partials.refetch();
              }}
            >
              Refresh
            </Button>
          </>
        }
      />

      <Nav
        variant="tabs"
        activeKey={activeType}
        onSelect={(value) => setActiveType((value ?? 'themes') as AssetType)}
        className="mb-3"
      >
        <Nav.Item><Nav.Link eventKey="themes">Theme</Nav.Link></Nav.Item>
        <Nav.Item><Nav.Link eventKey="layouts">Layout</Nav.Link></Nav.Item>
        <Nav.Item><Nav.Link eventKey="partials">Partial</Nav.Link></Nav.Item>
      </Nav>

      {notice !== null ? (
        <Alert variant="success" className="py-2" dismissible onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      ) : null}
      {formError !== null ? (
        <Alert variant="danger" className="py-2" dismissible onClose={() => setFormError(null)}>
          {formError}
        </Alert>
      ) : null}

      <Row className="g-3">
        <Col xl={7}>
          <Card>
            <Card.Header className="d-flex justify-content-between align-items-center">
              <span className="small fw-semibold">
                {activeType === 'themes'
                  ? 'Editor theme'
                  : activeType === 'layouts'
                    ? 'Editor layout'
                    : 'Editor partial'}
              </span>
              <Badge bg="light" text="dark" className="fw-normal">
                versi baru dari key yang sama
              </Badge>
            </Card.Header>
            <Card.Body>
              <Row className="g-3">
                <Col xs={12} md={5}>
                  <Form.Group controlId="asset-key">
                    <Form.Label className="small">Key</Form.Label>
                    <Form.Control
                      value={key}
                      maxLength={64}
                      onChange={(event) => setKey(event.target.value)}
                    />
                  </Form.Group>
                </Col>
                <Col xs={12} md={7}>
                  <Form.Group controlId="asset-name">
                    <Form.Label className="small">Nama</Form.Label>
                    <Form.Control
                      value={name}
                      maxLength={120}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </Form.Group>
                </Col>
              </Row>

              <div className="d-flex justify-content-end mt-3">
                <Form.Check
                  type="switch"
                  id="asset-advanced"
                  label="Mode advanced (JSON/HTML)"
                  checked={advanced}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setAdvanced(next);

                    if (activeType === 'themes') {
                      if (next) {
                        setThemeJson(JSON.stringify(themeTokensFromForm(themeForm), null, 2));
                      } else {
                        try {
                          const parsed: unknown = JSON.parse(themeJson);

                          if (isRecord(parsed)) {
                            setThemeForm(themeFormFromTokens(parsed));
                          }
                        } catch {
                          setFormError('JSON theme tidak valid.');
                        }
                      }
                    } else if (activeType === 'layouts' && next && layoutContent.trim().length === 0) {
                      setLayoutContent(buildLayoutHtml(layoutPreset, layoutOptions));
                    } else if (
                      activeType === 'partials' &&
                      next &&
                      partialContent.trim().length === 0
                    ) {
                      setPartialContent(buildPartialHtml(partialPreset, partialOptions));
                    }
                  }}
                />
              </div>

              <div className="mt-3">
                {activeType === 'themes' ? (
                  advanced ? (
                    <Form.Group controlId="theme-json">
                      <Form.Label className="small">Tokens JSON</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={18}
                        className="font-monospace small"
                        value={themeJson}
                        onChange={(event) => setThemeJson(event.target.value)}
                      />
                    </Form.Group>
                  ) : (
                    <ThemeFormFields form={themeForm} setForm={setThemeForm} />
                  )
                ) : null}

                {activeType === 'layouts' ? (
                  <LayoutFormFields
                    preset={layoutPreset}
                    setPreset={setLayoutPreset}
                    options={layoutOptions}
                    setOptions={setLayoutOptions}
                    advanced={advanced}
                    content={layoutContent}
                    setContent={setLayoutContent}
                  />
                ) : null}

                {activeType === 'partials' ? (
                  <PartialFormFields
                    preset={partialPreset}
                    setPreset={setPartialPreset}
                    options={partialOptions}
                    setOptions={setPartialOptions}
                    advanced={advanced}
                    content={partialContent}
                    setContent={setPartialContent}
                  />
                ) : null}
              </div>

              <div className="d-flex gap-2 mt-3">
                <Button onClick={() => create.mutate()} disabled={create.isPending}>
                  {create.isPending ? <Spinner animation="border" size="sm" /> : 'Buat versi baru'}
                </Button>
                <Button
                  variant="outline-secondary"
                  onClick={() => {
                    setKey(DEFAULT_KEYS[activeType].key);
                    setName(DEFAULT_KEYS[activeType].name);
                    setAdvanced(false);
                    setFormError(null);
                    setNotice(null);
                  }}
                  disabled={create.isPending}
                >
                  Reset form
                </Button>
              </div>
            </Card.Body>
          </Card>
        </Col>

        <Col xl={5}>
          <Card className="template-preview-card">
            <Card.Header className="d-flex justify-content-between align-items-center">
              <span className="small fw-semibold">Preview aset</span>
              <span className="small text-muted">sandbox</span>
            </Card.Header>
            <Card.Body className="template-preview-canvas">
              <div className="preview-frame-wrap">
                <iframe
                  title="Preview aset template"
                  sandbox=""
                  referrerPolicy="no-referrer"
                  srcDoc={previewHtml}
                  className="preview-frame"
                />
              </div>
              <p className="small text-muted mt-2 mb-0">
                Preview memakai sample data. Tema aktual diterapkan saat template memakai aset ini.
              </p>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Card className="mt-3">
        <Card.Header className="small fw-semibold">Versi aset</Card.Header>
        <Card.Body>
          <QueryState
            isLoading={activeQuery.isLoading}
            error={activeQuery.error}
            skeleton="table"
            onRetry={() => void activeQuery.refetch()}
          >
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Nama</th>
                    <th>Versi</th>
                    <th>Dipakai</th>
                    <th>Dibuat</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center text-muted py-4">
                        Belum ada aset.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr key={row.id}>
                        <td><code>{row.key}</code></td>
                        <td>{row.name}</td>
                        <td>v{row.version}</td>
                        <td>
                          {row.usageCount > 0 ? (
                            <Badge bg="secondary" className="fw-normal">
                              {row.usageCount} template
                            </Badge>
                          ) : (
                            <span className="text-muted small">0</span>
                          )}
                        </td>
                        <td>{formatDateTime(row.createdAt)}</td>
                        <td className="text-end">
                          <div className="d-flex justify-content-end gap-1">
                            <Button
                              size="sm"
                              variant="outline-secondary"
                              onClick={() => void loadAsset(row)}
                              disabled={loadingAssetId !== null}
                            >
                              {loadingAssetId === row.id ? (
                                <Spinner animation="border" size="sm" />
                              ) : (
                                'Muat'
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline-danger"
                              disabled={row.usageCount > 0 || remove.isPending}
                              title={
                                row.usageCount > 0
                                  ? 'Aset masih dipakai template dan tidak dapat dihapus'
                                  : 'Hapus versi aset ini'
                              }
                              aria-label={`Hapus ${row.key} v${row.version}`}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Hapus ${row.key} v${row.version}? Tindakan ini permanen.`,
                                  )
                                ) {
                                  remove.mutate({ type: activeType, row });
                                }
                              }}
                            >
                              Hapus
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </QueryState>
        </Card.Body>
      </Card>
    </>
  );
}

function ThemeFormFields({
  form,
  setForm,
}: {
  form: ThemeFormValues;
  setForm: (value: ThemeFormValues) => void;
}): JSX.Element {
  const set = <K extends keyof ThemeFormValues>(field: K, value: ThemeFormValues[K]): void => {
    setForm({ ...form, [field]: value });
  };

  return (
    <>
      <p className="small text-muted">
        Atur warna, font, dan button. Nilai ini disimpan sebagai token theme dan dipakai layout/partial.
      </p>
      <Row className="g-3">
        <ColorField label="Brand primary" value={form.primary} onChange={(value) => set('primary', value)} />
        <ColorField label="On primary" value={form.onPrimary} onChange={(value) => set('onPrimary', value)} />
        <ColorField label="Background" value={form.background} onChange={(value) => set('background', value)} />
        <ColorField label="Surface / card" value={form.surface} onChange={(value) => set('surface', value)} />
        <ColorField label="Text primary" value={form.textPrimary} onChange={(value) => set('textPrimary', value)} />
        <ColorField label="Text muted" value={form.textMuted} onChange={(value) => set('textMuted', value)} />
        <Col xs={12} md={7}>
          <Form.Group controlId="theme-font">
            <Form.Label className="small">Font family</Form.Label>
            <Form.Select
              value={form.fontFamily}
              onChange={(event) => set('fontFamily', event.target.value)}
            >
              {!FONT_OPTIONS.includes(form.fontFamily) ? (
                <option value={form.fontFamily}>Custom: {form.fontFamily}</option>
              ) : null}
              {FONT_OPTIONS.map((font) => (
                <option key={font} value={font}>{font}</option>
              ))}
            </Form.Select>
          </Form.Group>
        </Col>
        <Col xs={6} md={2}>
          <Form.Group controlId="theme-font-size">
            <Form.Label className="small">Base</Form.Label>
            <Form.Control value={form.fontSizeBase} onChange={(event) => set('fontSizeBase', event.target.value)} />
          </Form.Group>
        </Col>
        <Col xs={6} md={3}>
          <Form.Group controlId="theme-heading-size">
            <Form.Label className="small">Heading</Form.Label>
            <Form.Control value={form.fontSizeHeading} onChange={(event) => set('fontSizeHeading', event.target.value)} />
          </Form.Group>
        </Col>
        <Col xs={6} md={3}>
          <Form.Group controlId="theme-radius">
            <Form.Label className="small">Radius card</Form.Label>
            <Form.Control value={form.radius} onChange={(event) => set('radius', event.target.value)} />
          </Form.Group>
        </Col>
        <ColorField label="Button background" value={form.buttonBackground} onChange={(value) => set('buttonBackground', value)} />
        <ColorField label="Button text" value={form.buttonText} onChange={(value) => set('buttonText', value)} />
        <Col xs={6} md={3}>
          <Form.Group controlId="theme-button-radius">
            <Form.Label className="small">Button radius</Form.Label>
            <Form.Control value={form.buttonRadius} onChange={(event) => set('buttonRadius', event.target.value)} />
          </Form.Group>
        </Col>
        <Col xs={6} md={3}>
          <Form.Group controlId="theme-button-px">
            <Form.Label className="small">Padding X</Form.Label>
            <Form.Control value={form.buttonPaddingX} onChange={(event) => set('buttonPaddingX', event.target.value)} />
          </Form.Group>
        </Col>
        <Col xs={6} md={3}>
          <Form.Group controlId="theme-button-py">
            <Form.Label className="small">Padding Y</Form.Label>
            <Form.Control value={form.buttonPaddingY} onChange={(event) => set('buttonPaddingY', event.target.value)} />
          </Form.Group>
        </Col>
      </Row>
    </>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <Col xs={12} md={4}>
      <Form.Group>
        <Form.Label className="small">{label}</Form.Label>
        <div className="d-flex gap-2">
          <Form.Control
            type="color"
            value={toHex(value)}
            onChange={(event) => onChange(event.target.value)}
            style={{ width: 48, padding: 2 }}
            aria-label={`${label} color picker`}
          />
          <Form.Control value={value} onChange={(event) => onChange(event.target.value)} />
        </div>
      </Form.Group>
    </Col>
  );
}

function LayoutFormFields({
  preset,
  setPreset,
  options,
  setOptions,
  advanced,
  content,
  setContent,
}: {
  preset: LayoutPresetId;
  setPreset: (preset: LayoutPresetId) => void;
  options: LayoutOptions;
  setOptions: (options: LayoutOptions) => void;
  advanced: boolean;
  content: string;
  setContent: (content: string) => void;
}): JSX.Element {
  return (
    <>
      <PresetPicker
        items={LAYOUT_PRESETS}
        value={preset}
        onChange={(value) => setPreset(value as LayoutPresetId)}
        disabled={advanced}
      />
      {advanced ? (
        <Form.Group controlId="layout-html">
          <Form.Label className="small">HTML layout (advanced)</Form.Label>
          <Form.Control
            as="textarea"
            rows={18}
            className="font-monospace small"
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
          <Form.Text className="text-muted">Wajib memuat tepat satu {'{{{body}}}'}.</Form.Text>
        </Form.Group>
      ) : (
        <Row className="g-3">
          <Col xs={12}>
            <Form.Group controlId="layout-brand">
              <Form.Label className="small">Nama brand</Form.Label>
              <Form.Control
                value={options.brandName}
                onChange={(event) => setOptions({ ...options, brandName: event.target.value })}
              />
            </Form.Group>
          </Col>
          <Col xs={12}>
            <Form.Group controlId="layout-logo">
              <Form.Label className="small">Logo URL</Form.Label>
              <Form.Control
                value={options.logoUrl}
                placeholder="https://..."
                onChange={(event) => setOptions({ ...options, logoUrl: event.target.value })}
              />
            </Form.Group>
          </Col>
          <Col xs={12}>
            <Form.Group controlId="layout-footer">
              <Form.Label className="small">Teks footer</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={options.footerText}
                onChange={(event) => setOptions({ ...options, footerText: event.target.value })}
              />
            </Form.Group>
          </Col>
          <Col xs={12}>
            <Form.Group controlId="layout-unsubscribe">
              <Form.Label className="small">URL unsubscribe</Form.Label>
              <Form.Control
                value={options.unsubscribeUrl}
                placeholder="https://..."
                onChange={(event) => setOptions({ ...options, unsubscribeUrl: event.target.value })}
              />
            </Form.Group>
          </Col>
        </Row>
      )}
    </>
  );
}

function PartialFormFields({
  preset,
  setPreset,
  options,
  setOptions,
  advanced,
  content,
  setContent,
}: {
  preset: PartialPresetId;
  setPreset: (preset: PartialPresetId) => void;
  options: PartialOptions;
  setOptions: (options: PartialOptions) => void;
  advanced: boolean;
  content: string;
  setContent: (content: string) => void;
}): JSX.Element {
  return (
    <>
      <PresetPicker
        items={PARTIAL_PRESETS}
        value={preset}
        onChange={(value) => setPreset(value as PartialPresetId)}
        disabled={advanced}
      />
      {advanced ? (
        <Form.Group controlId="partial-html">
          <Form.Label className="small">HTML partial (advanced)</Form.Label>
          <Form.Control
            as="textarea"
            rows={16}
            className="font-monospace small"
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
        </Form.Group>
      ) : (
        <Row className="g-3">
          {preset === 'header' ? (
            <>
              <Col xs={12}>
                <Form.Group controlId="partial-brand">
                  <Form.Label className="small">Nama brand</Form.Label>
                  <Form.Control value={options.brandName} onChange={(event) => setOptions({ ...options, brandName: event.target.value })} />
                </Form.Group>
              </Col>
              <Col xs={12}>
                <Form.Group controlId="partial-logo">
                  <Form.Label className="small">Logo URL</Form.Label>
                  <Form.Control value={options.logoUrl} placeholder="https://..." onChange={(event) => setOptions({ ...options, logoUrl: event.target.value })} />
                </Form.Group>
              </Col>
              <Col xs={12}>
                <Form.Group controlId="partial-tagline">
                  <Form.Label className="small">Tagline</Form.Label>
                  <Form.Control value={options.tagline} onChange={(event) => setOptions({ ...options, tagline: event.target.value })} />
                </Form.Group>
              </Col>
            </>
          ) : null}
          {preset === 'footer' ? (
            <>
              <Col xs={12}>
                <Form.Group controlId="partial-footer">
                  <Form.Label className="small">Teks footer</Form.Label>
                  <Form.Control as="textarea" rows={3} value={options.footerText} onChange={(event) => setOptions({ ...options, footerText: event.target.value })} />
                </Form.Group>
              </Col>
              <Col xs={12}>
                <Form.Group controlId="partial-unsubscribe">
                  <Form.Label className="small">URL unsubscribe</Form.Label>
                  <Form.Control value={options.unsubscribeUrl} placeholder="https://..." onChange={(event) => setOptions({ ...options, unsubscribeUrl: event.target.value })} />
                </Form.Group>
              </Col>
            </>
          ) : null}
          {preset === 'cta' ? (
            <>
              <Col xs={12}>
                <Form.Group controlId="partial-cta-label">
                  <Form.Label className="small">Label tombol</Form.Label>
                  <Form.Control value={options.ctaLabel} onChange={(event) => setOptions({ ...options, ctaLabel: event.target.value })} />
                </Form.Group>
              </Col>
              <Col xs={12}>
                <Form.Group controlId="partial-cta-url">
                  <Form.Label className="small">URL tombol</Form.Label>
                  <Form.Control value={options.ctaUrl} placeholder="{{cta.url}} atau https://..." onChange={(event) => setOptions({ ...options, ctaUrl: event.target.value })} />
                </Form.Group>
              </Col>
            </>
          ) : null}
          {preset === 'signature' ? (
            <>
              <Col xs={12}>
                <Form.Group controlId="partial-person-name">
                  <Form.Label className="small">Nama</Form.Label>
                  <Form.Control value={options.personName} onChange={(event) => setOptions({ ...options, personName: event.target.value })} />
                </Form.Group>
              </Col>
              <Col xs={12}>
                <Form.Group controlId="partial-person-role">
                  <Form.Label className="small">Jabatan</Form.Label>
                  <Form.Control value={options.personRole} onChange={(event) => setOptions({ ...options, personRole: event.target.value })} />
                </Form.Group>
              </Col>
            </>
          ) : null}
        </Row>
      )}
    </>
  );
}

function PresetPicker({
  items,
  value,
  onChange,
  disabled,
}: {
  items: Array<{ id: string; label: string; description: string }>;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <div className="d-flex flex-wrap gap-2 mb-3">
      {items.map((item) => (
        <Button
          key={item.id}
          size="sm"
          variant={value === item.id ? 'dark' : 'outline-secondary'}
          onClick={() => onChange(item.id)}
          disabled={disabled}
          title={item.description}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
}

function parseJsonRecord(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} bukan JSON yang valid.`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`${label} harus berupa objek JSON.`);
  }

  return parsed;
}

function toHex(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
