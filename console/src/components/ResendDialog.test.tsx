import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResendDialog } from './ResendDialog';

const noop = (): void => undefined;

function renderDialog(
  mode: 'failed' | 'all',
  overrides: Partial<Parameters<typeof ResendDialog>[0]> = {},
): void {
  render(
    <ResendDialog
      show
      mode={mode}
      recipientCount={2}
      channels={['inapp']}
      busy={false}
      error={null}
      onCancel={noop}
      onConfirm={noop}
      {...overrides}
    />,
  );
}

describe('ResendDialog', () => {
  it('explains failed-only resend', () => {
    renderDialog('failed');

    expect(screen.getByText('Kirim ulang yang gagal', { selector: '.modal-title' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Kirim ulang yang gagal' })).toBeEnabled();
    expect(screen.queryByText(/termasuk yang sudah berhasil/i)).toBeNull();
  });

  it('warns that resend-all duplicates successful recipients', () => {
    renderDialog('all');

    expect(
      screen.getByText('Kirim ulang semua penerima', { selector: '.modal-title' }),
    ).toBeVisible();
    expect(screen.getByText(/termasuk yang sudah berhasil/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Kirim ulang semua' })).toBeEnabled();
  });

  it('disables the confirm button while busy', () => {
    renderDialog('failed', { busy: true });

    expect(screen.getByRole('button', { name: 'Mengirim…' })).toBeDisabled();
  });

  it('shows an error without closing the dialog', () => {
    renderDialog('failed', { error: 'queue unavailable' });

    expect(screen.getByText('queue unavailable')).toBeVisible();
    expect(screen.getByText('Kirim ulang yang gagal', { selector: '.modal-title' })).toBeVisible();
  });

  it('does not call onConfirm when the count is zero', () => {
    const onConfirm = vi.fn();
    renderDialog('failed', { recipientCount: 0, onConfirm });

    expect(screen.getByRole('button', { name: 'Kirim ulang yang gagal' })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
