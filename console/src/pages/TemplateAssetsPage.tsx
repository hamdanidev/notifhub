import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Form, Nav, Row, Spinner } from 'react-bootstrap';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import {
  createLayout,
  createPartial,
  createTheme,
  listLayouts,
  listPartials,
  listThemes,
} from '../lib/adminTemplates';
import { describeError, formatDateTime } from '../lib/format';

type AssetType = 'layouts' | 'themes' | 'partials';

const STARTER_LAYOUT = `<!doctype html>
<html lang="{{lang}}" dir="{{dir}}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <style>
    body { margin: 0; padding: 0; }
    @media only screen and (max-width: 480px) {
      .nh-container { width: 100% !important; }
      .nh-pad { padding-left: 16px !important; padding-right: 16px !important; }
    }
    @media (prefers-color-scheme: dark) {
      .nh-body { background: #111827 !important; }
      .nh-surface { background: #1f2937 !important; }
      .nh-text { color: #f9fafb !important; }
    }
  </style>
</head>
<body class="nh-body" style="margin:0;padding:0;background:{{default theme.brand.background "#f4f5f7"}}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">{{preheader}}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{{default theme.brand.background "#f4f5f7"}}">
    <tr>
      <td align="center" style="padding:24px 12px">
        <table role="presentation" class="nh-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:{{default theme.brand.surface "#ffffff"}};border-radius:{{default theme.radius.md "8px"}}">
          <tr>
            <td class="nh-pad nh-text" style="padding:32px;font-family:{{default theme.font.family "Arial, Helvetica, sans-serif"}};font-size:15px;line-height:1.6;color:{{default theme.text.primary "#111827"}}">
              {{{body}}}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

const STARTER_THEME = `{
  "brand": {
    "primary": "#0d6efd",
    "onPrimary": "#ffffff",
    "background": "#f4f5f7",
    "surface": "#ffffff"
  },
  "text": {
    "primary": "#111827",
    "muted": "#6b7280"
  },
  "font": {
    "family": "Arial, Helvetica, sans-serif"
  },
  "radius": {
    "md": "8px"
  }
}`;

export function TemplateAssetsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [activeType, setActiveType] = useState<AssetType>('layouts');
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [tokens, setTokens] = useState('{\n  "brand": {\n    "primary": "#0d6efd",\n    "background": "#ffffff"\n  }\n}');
  const [formError, setFormError] = useState<string | null>(null);

  const layouts = useQuery({ queryKey: ['template-assets', 'layouts'], queryFn: () => listLayouts() });
  const themes = useQuery({ queryKey: ['template-assets', 'themes'], queryFn: () => listThemes() });
  const partials = useQuery({
    queryKey: ['template-assets', 'partials'],
    queryFn: () => listPartials(),
  });

  const create = useMutation({
    mutationFn: async () => {
      if (key.trim().length === 0 || name.trim().length === 0) {
        throw new Error('Key dan nama wajib diisi.');
      }

      if (activeType === 'themes') {
        let parsed: unknown;

        try {
          parsed = JSON.parse(tokens);
        } catch {
          throw new Error('Tokens theme bukan JSON yang valid.');
        }

        if (!isRecord(parsed)) {
          throw new Error('Tokens theme harus berupa objek JSON.');
        }

        return createTheme({ key: key.trim(), name: name.trim(), tokens: parsed });
      }

      if (content.trim().length === 0) {
        throw new Error('Konten aset wajib diisi.');
      }

      return activeType === 'layouts'
        ? createLayout({ key: key.trim(), name: name.trim(), content })
        : createPartial({ key: key.trim(), name: name.trim(), content });
    },
    onSuccess: () => {
      setFormError(null);
      setKey('');
      setName('');
      setContent('');
      void queryClient.invalidateQueries({ queryKey: ['template-assets'] });
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : 'Gagal membuat aset.');
    },
  });

  const rows = useMemo(() => {
    if (activeType === 'layouts') return layouts.data?.items ?? [];
    if (activeType === 'themes') return themes.data?.items ?? [];
    return partials.data?.items ?? [];
  }, [activeType, layouts.data, partials.data, themes.data]);

  const activeQuery = activeType === 'layouts' ? layouts : activeType === 'themes' ? themes : partials;

  return (
    <>
      <PageHeader
        title="Aset template"
        subtitle="Layout, theme, dan partial versioned. Perubahan selalu membuat versi baru."
        actions={
          <Button size="sm" variant="outline-secondary" onClick={() => {
            void layouts.refetch();
            void themes.refetch();
            void partials.refetch();
          }}>
            Refresh
          </Button>
        }
      />

      <Nav variant="tabs" activeKey={activeType} onSelect={(value) => setActiveType((value ?? 'layouts') as AssetType)} className="mb-3">
        <Nav.Item><Nav.Link eventKey="layouts">Layout</Nav.Link></Nav.Item>
        <Nav.Item><Nav.Link eventKey="themes">Theme</Nav.Link></Nav.Item>
        <Nav.Item><Nav.Link eventKey="partials">Partial</Nav.Link></Nav.Item>
      </Nav>

      <Row className="g-3">
        <Col xl={5}>
          <Card>
            <Card.Header className="small fw-semibold">Versi baru</Card.Header>
            <Card.Body>
              <p className="small text-muted">
                Gunakan key yang sama untuk membuat versi berikutnya. Template published tetap
                memakai versi lama sampai draft baru memilih versi ini.
              </p>
              {formError !== null ? <Alert variant="danger" className="py-2 small">{formError}</Alert> : null}
              <Form.Group className="mb-2" controlId="asset-key">
                <Form.Label className="small">Key</Form.Label>
                <Form.Control
                  value={key}
                  maxLength={64}
                  placeholder="mis. base, brand, header"
                  onChange={(event) => setKey(event.target.value)}
                />
              </Form.Group>
              <Form.Group className="mb-2" controlId="asset-name">
                <Form.Label className="small">Nama</Form.Label>
                <Form.Control value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
              </Form.Group>
              {activeType === 'themes' ? (
                <>
                  <div className="d-flex justify-content-end mb-1">
                    <Button
                      size="sm"
                      variant="link"
                      className="p-0"
                      onClick={() => setTokens(STARTER_THEME)}
                    >
                      Isi starter theme
                    </Button>
                  </div>
                  <Form.Group controlId="asset-tokens">
                    <Form.Label className="small">Tokens JSON</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={10}
                      className="font-monospace small"
                      value={tokens}
                      onChange={(event) => setTokens(event.target.value)}
                    />
                  </Form.Group>
                </>
              ) : (
                <Form.Group controlId="asset-content">
                  <Form.Label className="small d-flex justify-content-between">
                    <span>
                      {activeType === 'layouts' ? 'HTML layout (wajib {{{body}}})' : 'HTML partial'}
                    </span>
                    {activeType === 'layouts' ? (
                      <Button
                        size="sm"
                        variant="link"
                        className="p-0"
                        onClick={() => {
                          setKey('base');
                          setName('Base layout');
                          setContent(STARTER_LAYOUT);
                        }}
                      >
                        Isi starter layout
                      </Button>
                    ) : null}
                  </Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={12}
                    className="font-monospace small"
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                  />
                </Form.Group>
              )}
              <Button className="mt-3" size="sm" onClick={() => create.mutate()} disabled={create.isPending}>
                {create.isPending ? <Spinner animation="border" size="sm" /> : 'Buat versi'}
              </Button>
            </Card.Body>
          </Card>
        </Col>
        <Col xl={7}>
          <Card>
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
                        <th>Dibuat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="text-center text-muted py-4">
                            Belum ada aset.
                          </td>
                        </tr>
                      ) : (
                        rows.map((row) => (
                          <tr key={row.id}>
                            <td><code>{row.key}</code></td>
                            <td>{row.name}</td>
                            <td>v{row.version}</td>
                            <td>{formatDateTime(row.createdAt)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </QueryState>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
