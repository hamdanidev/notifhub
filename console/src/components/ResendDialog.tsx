import { Alert, Button, Modal } from 'react-bootstrap';
import type { ResendMode } from '@notifhub/js';
import { ChannelBadge } from './ChannelBadge';

export interface ResendDialogProps {
  show: boolean;
  mode: ResendMode;
  recipientCount: number;
  channels: string[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ResendDialog({
  show,
  mode,
  recipientCount,
  channels,
  busy,
  error,
  onCancel,
  onConfirm,
}: ResendDialogProps): JSX.Element {
  const all = mode === 'all';

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
        <Modal.Title className="h6 mb-0">
          {all ? 'Kirim ulang semua penerima' : 'Kirim ulang yang gagal'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="mb-2">
          Akan dibuat <strong>notification baru</strong> untuk {recipientCount} pasangan
          recipient/channel
          {all ? (
            <>
              {' '}
              non-SMS, <strong>termasuk yang sudah berhasil</strong>.
            </>
          ) : (
            <>
              {' '}
              yang berstatus <code>failed</code>.
            </>
          )}
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
            {all ? (
              <li>
                Penerima yang sebelumnya sudah menerima notifikasi ini akan menerima lagi. Pastikan
                ini memang diinginkan.
              </li>
            ) : null}
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
        <Button
          variant={all ? 'danger' : 'primary'}
          onClick={onConfirm}
          disabled={busy || recipientCount === 0}
        >
          {busy ? 'Mengirim…' : all ? 'Kirim ulang semua' : 'Kirim ulang yang gagal'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
