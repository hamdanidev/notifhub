import { Button, Modal } from 'react-bootstrap';

export interface ConfirmDialogProps {
  show: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  show,
  title,
  body,
  confirmLabel = 'Lanjutkan',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): JSX.Element {
  return (
    <Modal show={show} onHide={onCancel} centered>
      <Modal.Header closeButton>
        <Modal.Title className="h6 mb-0">{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>{body}</Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onCancel} disabled={busy}>
          Batal
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={busy}>
          {busy ? 'Memproses…' : confirmLabel}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
