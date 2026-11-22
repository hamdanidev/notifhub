import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImportHtmlDialog } from './ImportHtmlDialog';

const noop = (): void => undefined;

function renderDialog(
  overrides: Partial<Parameters<typeof ImportHtmlDialog>[0]> = {},
): { onApply: ReturnType<typeof vi.fn> } {
  const onApply = vi.fn();

  render(
    <ImportHtmlDialog
      show
      hasExistingBlocks={false}
      existingBlockCount={0}
      onCancel={noop}
      onApply={onApply}
      {...overrides}
    />,
  );

  return { onApply };
}

function typeHtml(value: string): void {
  fireEvent.change(screen.getByLabelText('Tempel HTML'), { target: { value } });
}

describe('ImportHtmlDialog', () => {
  it('keeps Analisis disabled until HTML is provided', () => {
    renderDialog();

    expect(screen.getByRole('button', { name: 'Analisis' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Terapkan' })).toBeDisabled();

    typeHtml('<p>Halo</p>');

    expect(screen.getByRole('button', { name: 'Analisis' })).toBeEnabled();
  });

  it('reports the mapped blocks and applies the document', () => {
    const { onApply } = renderDialog();

    typeHtml('<h2>Halo</h2><p>Pesanan dikirim.</p>');
    fireEvent.click(screen.getByRole('button', { name: 'Analisis' }));

    expect(screen.getByText('2 block · 0 peringatan · 0 error')).toBeVisible();
    expect(screen.getByText('Heading')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Terapkan' }));

    expect(onApply).toHaveBeenCalledTimes(1);

    const [document, issues] = onApply.mock.calls[0] as [
      { version: number; blocks: Array<{ type: string }> },
      unknown[],
    ];

    expect(document.version).toBe(1);
    expect(document.blocks.map((block) => block.type)).toEqual(['heading', 'text']);
    expect(issues).toEqual([]);
  });

  it('blocks Terapkan when the HTML contains an unsafe element', () => {
    const { onApply } = renderDialog();

    typeHtml('<p>Isi</p><script>alert(1)</script>');
    fireEvent.click(screen.getByRole('button', { name: 'Analisis' }));

    expect(screen.getByText(/1 error/)).toBeVisible();
    expect(screen.getByText('import_unsafe_element')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Terapkan' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Terapkan' }));

    expect(onApply).not.toHaveBeenCalled();
  });

  it('asks for confirmation before replacing existing blocks', () => {
    const { onApply } = renderDialog({ hasExistingBlocks: true, existingBlockCount: 3 });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);

    typeHtml('<p>Baru</p>');
    fireEvent.click(screen.getByRole('button', { name: 'Analisis' }));
    fireEvent.click(screen.getByRole('button', { name: 'Terapkan' }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0]).toContain('mengganti 3 block');
    expect(onApply).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Terapkan' }));

    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('rejects a file above the size limit without reading it', () => {
    renderDialog();

    const input = screen.getByLabelText('Berkas HTML (opsional)');
    const oversized = new File(['x'.repeat(300_000)], 'besar.html', { type: 'text/html' });

    fireEvent.change(input, { target: { files: [oversized] } });

    expect(screen.getByText(/melebihi batas 256 KB/)).toBeVisible();
  });

  it('calls onCancel when Batal is pressed', () => {
    const onCancel = vi.fn();

    renderDialog({ onCancel });
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
