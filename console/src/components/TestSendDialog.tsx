import { useEffect, useState } from 'react';
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap';
import type { Channel, TestSendResult } from '@notifhub/js';

export interface TestSendDialogProps {
  show: boolean;
  channel: Channel;
  busy: boolean;
  result: TestSendResult | null;
  error: unknown;
  onCancel: () => void;
  onSend: (recipient: string) => void;
}

export function TestSendDialog({
  show,
  channel,
  busy,
  result,
  error,
  onCancel,
  onSend,
}: TestSendDialogProps): JSX.Element {
  const [recipient, setRecipient] = useState('');

  useEffect(() => {
    if (!show) {
      setRecipient('');
    }
  }, [show]);

  const supported = channel === 'email' || channel === 'whatsapp';

  return (
    <Modal show={show} onHide={onCancel} centered>
      <Modal.Header closeButton>
        <Modal.Title className="fs-6">Test kirim</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {!supported ? (
          <Alert variant="warning" className="small">
            Test kirim hanya didukung untuk email dan WhatsApp. Gunakan preview untuk channel{' '}
            {channel}.
          </Alert>
        ) : (
          <>
            <p className="small text-muted">
              Test kirim memakai versi template tersimpan, melewati preferensi/quiet hours, dan
              dicatat pada audit. Mode runtime backend tetap berlaku (development log-only,
              staging catch-all, production alamat asli).
            </p>
            <Form.Group controlId="test-send-recipient">
              <Form.Label className="small">
                {channel === 'email' ? 'Alamat email' : 'Nomor WhatsApp (E.164)'}
              </Form.Label>
              <Form.Control
                value={recipient}
                placeholder={channel === 'email' ? 'qa@example.com' : '+628123456789'}
                onChange={(event) => setRecipient(event.target.value)}
              />
            </Form.Group>
          </>
        )}
        {result !== null ? (
          <Alert variant={result.status === 'failed' ? 'danger' : 'success'} className="mt-3 small">
            Status <strong>{result.status}</strong> · provider {result.provider} · mode{' '}
            {result.mode} · penerima {result.recipientMasked}
            {result.providerMessageId !== null ? ` · id ${result.providerMessageId}` : ''}
            {result.error !== undefined ? ` · ${result.error}` : ''}
          </Alert>
        ) : null}
        {error !== null ? (
          <Alert variant="danger" className="mt-3 small">
            {error instanceof Error ? error.message : 'Test kirim gagal.'}
          </Alert>
        ) : null}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onCancel} disabled={busy}>
          Tutup
        </Button>
        <Button
          variant="primary"
          onClick={() => onSend(recipient.trim())}
          disabled={busy || !supported || recipient.trim().length === 0}
        >
          {busy ? <Spinner animation="border" size="sm" /> : 'Kirim test'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
