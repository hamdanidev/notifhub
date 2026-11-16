import { Alert, Button, Modal } from 'react-bootstrap';
import { ChannelBadge } from './ChannelBadge';

export interface ResendFailedDialogProps {
  show: boolean;
  recipientCount: number;
  channels: string[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ResendFailedDialog({
  show,
  recipientCount,
  channels,
  busy,
  error,
  onCancel,
  onConfirm,
}: ResendFailedDialogProps): JSX.Element {
  return (
    <Modal
      show={show}
      onHide={() => {
        if (!busy) {
          onCancel();
        }
      }}
      centered
    >
      <Modal.Header closeButton={!busy}>
        <Modal.Title className="h6 mb-0">Kirim ulang yang gagal</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="mb-2">
          Akan dibuat <strong>notification baru</strong> untuk {recipientCount} pasangan
          recipient/channel yang berstatus <code>failed</code>.
        </p>
        <div className="d-flex gap-1 flex-wrap mb-3">
          {channels.map((channel) => (
            <ChannelBadge key={channel} channel={channel} />
          ))}
        </div>

        <Alert variant="warning" className="small mb-0">
          <div className="fw-semibold mb-1">Yang perlu diketahui</div>
          <ul className="mb-0 ps-3">
            <li>Template dirender ulang dari versi aktif saat ini.</li>
            <li>Preferensi recipient dievaluasi ulang; channel bisa menjadi skipped.</li>
            <li>
              Inline override email/phone/locale/timezone dari ingest awal tidak tersimpan; data
              Subscriber saat ini yang dipakai.
            </li>
            <li>Notification asli tidak berubah dan tetap menjadi jejak audit.</li>
          </ul>
        </Alert>

        {error !== null ? (
          <Alert variant="danger" className="small mt-3 mb-0">
            {error}
          </Alert>
        ) : null}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onCancel} disabled={busy}>
          Batal
        </Button>
        <Button variant="primary" onClick={onConfirm} disabled={busy || recipientCount === 0}>
          {busy ? 'Mengirim…' : 'Kirim ulang yang gagal'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
