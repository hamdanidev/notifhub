import { useRef, useState, type ChangeEvent } from 'react';
import { Form, Spinner } from 'react-bootstrap';
import { uploadTemplateImage } from '../lib/adminTemplates';

export interface TemplateImageUploadProps {
  onUploaded: (url: string) => void;
  helpText?: string;
}

/**
 * Compact multipart upload control shared by image blocks, layout logos and partial logos.
 * The parent keeps the URL in its own form state so manual URLs remain supported.
 */
export function TemplateImageUpload({
  onUploaded,
  helpText = 'Atau unggah PNG/JPEG/WebP/GIF (maksimum 5 MB, tanpa SVG).',
}: TemplateImageUploadProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];

    if (file === undefined) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const asset = await uploadTemplateImage(file);
      onUploaded(asset.url);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload gambar gagal.');
    } finally {
      setBusy(false);

      if (inputRef.current !== null) {
        inputRef.current.value = '';
      }
    }
  };

  return (
    <div>
      <div className="d-flex align-items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          className="form-control form-control-sm"
          accept="image/png,image/jpeg,image/webp,image/gif"
          aria-label="Unggah gambar template"
          disabled={busy}
          onChange={(event) => void handleFile(event)}
        />
        {busy ? <Spinner animation="border" size="sm" /> : null}
      </div>
      <Form.Text className="text-muted">{helpText}</Form.Text>
      {error !== null ? <div className="small text-danger mt-1">{error}</div> : null}
    </div>
  );
}
