import { useMemo } from 'react';
import { Alert, Badge, Button, ButtonGroup, Card, Spinner } from 'react-bootstrap';
import type { PreviewResult } from '../lib/templateTypes';

export interface TemplatePreviewPaneProps {
  preview: PreviewResult | null;
  loading: boolean;
  error: unknown;
  viewport: 'desktop' | 'mobile';
  onViewportChange: (viewport: 'desktop' | 'mobile') => void;
  darkCanvas: boolean;
  onDarkCanvasChange: (dark: boolean) => void;
  onRefresh: () => void;
}

export function TemplatePreviewPane({
  preview,
  loading,
  error,
  viewport,
  onViewportChange,
  darkCanvas,
  onDarkCanvasChange,
  onRefresh,
}: TemplatePreviewPaneProps): JSX.Element {
  const width = viewport === 'mobile' ? 375 : 600;
  const errorMessage = useMemo(() => describePreviewError(error), [error]);

  return (
    <Card className="template-preview-card">
      <Card.Header className="d-flex flex-wrap align-items-center justify-content-between gap-2">
        <div className="d-flex align-items-center gap-2">
          <strong className="small">Preview</strong>
          {preview !== null ? (
            <Badge bg="light" text="dark" className="fw-normal">
              {preview.renderMs} ms · {Math.round(preview.bytes / 1024)} KB
            </Badge>
          ) : null}
        </div>
        <div className="d-flex align-items-center gap-2">
          <ButtonGroup size="sm">
            <Button
              variant={viewport === 'desktop' ? 'dark' : 'outline-secondary'}
              onClick={() => onViewportChange('desktop')}
            >
              Desktop
            </Button>
            <Button
              variant={viewport === 'mobile' ? 'dark' : 'outline-secondary'}
              onClick={() => onViewportChange('mobile')}
            >
              Mobile
            </Button>
          </ButtonGroup>
          <Button
            size="sm"
            variant={darkCanvas ? 'dark' : 'outline-secondary'}
            onClick={() => onDarkCanvasChange(!darkCanvas)}
            title="Latar preview untuk memeriksa kontras"
          >
            {darkCanvas ? 'Latar gelap' : 'Latar terang'}
          </Button>
          <Button size="sm" variant="outline-secondary" onClick={onRefresh} disabled={loading}>
            {loading ? <Spinner animation="border" size="sm" /> : 'Render'}
          </Button>
        </div>
      </Card.Header>
      <Card.Body className={darkCanvas ? 'template-preview-canvas template-preview-canvas--dark' : 'template-preview-canvas'}>
        {errorMessage !== null ? <Alert variant="danger">{errorMessage}</Alert> : null}
        {preview === null ? (
          <p className="text-muted small mb-0">Belum ada preview. Klik Render atau ubah konten.</p>
        ) : (
          <>
            {preview.subject !== null ? (
              <div className="preview-subject">
                <span className="text-muted small">Subject</span>
                <div>{preview.subject}</div>
              </div>
            ) : null}
            {preview.preheader !== null ? (
              <div className="preview-preheader">
                <span className="text-muted small">Preheader</span>
                <div>{preview.preheader}</div>
              </div>
            ) : null}
            <div className="preview-frame-wrap" style={{ width, maxWidth: '100%' }}>
              {preview.html !== null ? (
                <iframe
                  title="Preview template"
                  sandbox=""
                  referrerPolicy="no-referrer"
                  srcDoc={preview.html}
                  className="preview-frame"
                />
              ) : (
                <pre className="preview-text">{preview.text ?? preview.body}</pre>
              )}
            </div>
            {preview.html !== null && preview.text !== null ? (
              <details className="mt-2">
                <summary className="small text-muted">Plain text (otomatis)</summary>
                <pre className="preview-text mt-2">{preview.text}</pre>
              </details>
            ) : null}
            <div className="small text-muted mt-2">
              Locale {preview.resolved.locale} · arah {preview.resolved.direction}
              {preview.resolved.layout !== null
                ? ` · layout ${preview.resolved.layout.key} v${preview.resolved.layout.version}`
                : ' · tanpa layout'}
              {preview.resolved.theme !== null
                ? ` · theme ${preview.resolved.theme.key} v${preview.resolved.theme.version}`
                : ''}
            </div>
            {preview.missingVariables.length > 0 ? (
              <Alert variant="warning" className="mt-2 mb-0 py-2">
                Variabel belum terisi: {preview.missingVariables.join(', ')}
              </Alert>
            ) : null}
            {preview.errors.length > 0 ? (
              <Alert variant="danger" className="mt-2 mb-0 py-2">
                <div className="fw-semibold small mb-1">Error</div>
                <ul className="mb-0 ps-3 small">
                  {preview.errors.map((issue) => (
                    <li key={`${issue.code}-${issue.path}-${issue.message}`}>
                      {issue.path}: {issue.message}
                    </li>
                  ))}
                </ul>
              </Alert>
            ) : null}
            {preview.warnings.length > 0 ? (
              <Alert variant="warning" className="mt-2 mb-0 py-2">
                <div className="fw-semibold small mb-1">Peringatan</div>
                <ul className="mb-0 ps-3 small">
                  {preview.warnings.map((issue) => (
                    <li key={`${issue.code}-${issue.path}-${issue.message}`}>
                      {issue.path}: {issue.message}
                    </li>
                  ))}
                </ul>
              </Alert>
            ) : null}
          </>
        )}
      </Card.Body>
    </Card>
  );
}

function describePreviewError(error: unknown): string | null {
  if (error === null || error === undefined) {
    return null;
  }

  return error instanceof Error ? error.message : 'Preview gagal dirender.';
}
