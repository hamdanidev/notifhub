import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Form, Modal, Table } from 'react-bootstrap';
import type { TemplateValidationIssue } from '@notifhub/js';
import { blockLabel, type EmailBlock, type EmailBlockDocument } from '../lib/emailBlocks';
import {
  IMPORT_MAX_INPUT_BYTES,
  importHtmlToBlocks,
  type HtmlImportResult,
} from '../lib/htmlImport';

export interface ImportHtmlDialogProps {
  show: boolean;
  hasExistingBlocks: boolean;
  existingBlockCount: number;
  onCancel: () => void;
  onApply: (document: EmailBlockDocument, issues: TemplateValidationIssue[]) => void;
}

export function ImportHtmlDialog({
  show,
  hasExistingBlocks,
  existingBlockCount,
  onCancel,
  onApply,
}: ImportHtmlDialogProps): JSX.Element {
  const [htmlText, setHtmlText] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);

  const [result, setResult] = useState<HtmlImportResult | null>(null);

  useEffect(() => {
    if (show) {
      return;
    }

    setHtmlText('');
    setFileError(null);
    setResult(null);
  }, [show]);

  const errors = result?.issues.filter((issue) => issue.severity === 'error') ?? [];
  const warnings = result?.issues.filter((issue) => issue.severity === 'warning') ?? [];
  const canApply = result !== null && result.document !== null && errors.length === 0;

  const resetResult = (): void => {
    setResult(null);
  };

  const analyze = (): void => {
    setResult(importHtmlToBlocks(htmlText));
  };

  const readFile = async (input: HTMLInputElement): Promise<void> => {
    const file = input.files?.[0];

    if (file === undefined) {
      return;
    }

    if (file.size > IMPORT_MAX_INPUT_BYTES) {
      setFileError(
        `Berkas ${formatBytes(file.size)} melebihi batas ${formatBytes(IMPORT_MAX_INPUT_BYTES)}.`,
      );
      return;
    }

    setFileError(null);

    try {
      const text = await file.text();
      setHtmlText(text);
      resetResult();
    } catch {
      setFileError('Berkas tidak dapat dibaca.');
    }
  };

  const apply = (): void => {
    if (result === null || result.document === null) {
      return;
    }

    if (
      hasExistingBlocks &&
      !window.confirm(
        `Impor akan mengganti ${existingBlockCount} block di editor. Lanjutkan?`,
      )
    ) {
      return;
    }

    onApply(result.document, result.issues);
  };

  return (
    <Modal show={show} onHide={onCancel} centered size="lg" scrollable>
      <Modal.Header closeButton>
        <Modal.Title className="fs-6">Impor HTML ke Visual</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="small text-muted mb-2">
          Tempel body HTML email atau pilih berkas. Hanya heading, paragraf, gambar, tombol, dan
          divider yang diimpor. CSS tidak diimpor; builder memakai theme dan layout yang dipilih.
          Setiap elemen yang dibuang dilaporkan sebelum diterapkan.
        </p>

        <Form.Group controlId="import-html-file" className="mb-2">
          <Form.Label className="small">Berkas HTML (opsional)</Form.Label>
          <Form.Control
            type="file"
            accept=".html,.htm,text/html"
            onChange={(event) => {
              void readFile(event.target as HTMLInputElement);
            }}
          />
        </Form.Group>

        {fileError !== null ? (
          <Alert variant="danger" className="py-2 small">
            {fileError}
          </Alert>
        ) : null}

        <Form.Group controlId="import-html-text" className="mb-2">
          <Form.Label className="small">Tempel HTML</Form.Label>
          <Form.Control
            as="textarea"
            rows={8}
            className="font-monospace small"
            placeholder="<h1>Halo {{nama}}</h1><p>Pesanan sudah dikirim.</p>"
            value={htmlText}
            onChange={(event) => {
              setHtmlText(event.target.value);
              resetResult();
            }}
          />
        </Form.Group>

        <div className="d-flex align-items-center gap-2 mb-2">
          <Button
            size="sm"
            variant="outline-secondary"
            onClick={analyze}
            disabled={htmlText.trim().length === 0}
          >
            Analisis
          </Button>
          <span className="small text-muted">{htmlText.length} karakter</span>
        </div>

        <div aria-live="polite">
          {result !== null ? (
            <Alert
              variant={errors.length > 0 ? 'danger' : warnings.length > 0 ? 'warning' : 'success'}
              className="py-2 small"
            >
              <div className="fw-semibold">
                {result.summary.blocks} block · {warnings.length} peringatan · {errors.length} error
              </div>
              <div className="text-muted">
                CSS dibuang: {result.summary.droppedCssRules} aturan ·{' '}
                {result.summary.droppedStyleAttributes} atribut style ·{' '}
                {result.summary.ignoredElements} elemen diabaikan
              </div>
            </Alert>
          ) : null}
        </div>

        {result?.document !== null && result?.document !== undefined ? (
          <Table size="sm" bordered className="small mb-2">
            <caption className="small text-muted">Hasil pemetaan block</caption>
            <thead>
              <tr>
                <th scope="col" style={{ width: '3rem' }}>
                  #
                </th>
                <th scope="col" style={{ width: '8rem' }}>
                  Tipe
                </th>
                <th scope="col">Ringkasan</th>
              </tr>
            </thead>
            <tbody>
              {result.document.blocks.map((block, index) => (
                <tr key={block.id}>
                  <td>{index + 1}</td>
                  <td>{blockLabel(block.type)}</td>
                  <td className="font-monospace">{excerpt(block)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}

        {result !== null && result.issues.length > 0 ? (
          <ul className="list-unstyled small mb-0">
            {result.issues.map((issue, index) => (
              <li key={`${issue.code}-${issue.path}-${index}`} className="mb-1">
                <Badge bg={issue.severity === 'error' ? 'danger' : 'warning'} text="dark">
                  {issue.severity}
                </Badge>{' '}
                <code>{issue.code}</code> — {issue.message}{' '}
                <span className="text-muted">{issue.path}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onCancel}>
          Batal
        </Button>
        <Button variant="primary" onClick={apply} disabled={!canApply}>
          Terapkan
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

function excerpt(block: EmailBlock): string {
  switch (block.type) {
    case 'heading':
    case 'text':
      return truncate(block.text.replace(/\s+/g, ' '), 80);
    case 'image':
      return block.url.length > 0 ? truncate(block.url, 80) : '(URL kosong)';
    case 'button':
      return truncate(`${block.label} → ${block.url.length > 0 ? block.url : '(URL kosong)'}`, 80);
    case 'divider':
      return '—';
    case 'spacer':
      return `${block.height}px`;
    case 'columns':
      return truncate(`${block.left} | ${block.right}`, 80);
    default:
      return '';
  }
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function formatBytes(value: number): string {
  return `${Math.round(value / 1024)} KB`;
}
