import { useState } from 'react';
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap';
import type { TemplateValidationIssue } from '../lib/templateTypes';

export interface PublishDialogProps {
  show: boolean;
  templateKey: string;
  version: number;
  validation: TemplateValidationIssue[];
  busy: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}

export function PublishDialog({
  show,
  templateKey,
  version,
  validation,
  busy,
  error,
  onCancel,
  onConfirm,
}: PublishDialogProps): JSX.Element {
  const [note, setNote] = useState('');
  const errors = validation.filter((issue) => issue.severity === 'error');
  const warnings = validation.filter((issue) => issue.severity === 'warning');

  return (
    <Modal show={show} onHide={onCancel} centered>
      <Modal.Header closeButton>
        <Modal.Title className="fs-6">Publish template</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="small text-muted">
          <code>{templateKey}</code> versi {version} akan menjadi versi aktif untuk channel,
          locale, dan key ini. Versi published lain akan dinonaktifkan.
        </p>
        {errors.length > 0 ? (
          <Alert variant="danger" className="py-2">
            <div className="fw-semibold small mb-1">Perbaiki error berikut</div>
            <ul className="mb-0 ps-3 small">
              {errors.map((issue) => (
                <li key={`${issue.code}-${issue.path}`}>
                  {issue.path}: {issue.message}
                </li>
              ))}
            </ul>
          </Alert>
        ) : (
          <Alert variant="success" className="py-2 small">
            Validasi server akan dijalankan ulang saat publish.
          </Alert>
        )}
        {warnings.length > 0 ? (
          <Alert variant="warning" className="py-2">
            <div className="fw-semibold small mb-1">Peringatan</div>
            <ul className="mb-0 ps-3 small">
              {warnings.map((issue) => (
                <li key={`${issue.code}-${issue.path}`}>
                  {issue.path}: {issue.message}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {error !== null ? <Alert variant="danger" className="py-2 small">{describe(error)}</Alert> : null}
        <Form.Group controlId="publish-note">
          <Form.Label className="small">Catatan publish (opsional)</Form.Label>
          <Form.Control
            as="textarea"
            rows={2}
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onCancel} disabled={busy}>
          Batal
        </Button>
        <Button variant="primary" onClick={() => onConfirm(note)} disabled={busy || errors.length > 0}>
          {busy ? <Spinner animation="border" size="sm" /> : 'Publish'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Publish gagal.';
}
