import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoginShell } from './LoginShell';

describe('LoginShell', () => {
  it('renders tenant context, ledger example, and the form child', () => {
    const { container } = render(
      <LoginShell
        lane="tenant"
        eyebrow="Tenant admin"
        title="Masuk ke workspace"
        intro="Gunakan akun tenant admin untuk melanjutkan."
        headline="Setiap notifikasi punya jejak."
        lede="Antrean, pengiriman, dan status baca dalam satu tempat."
      >
        <button type="button">Masuk</button>
      </LoginShell>,
    );

    expect(screen.getByText('Setiap notifikasi punya jejak.')).toBeInTheDocument();
    expect(screen.getByText('Tenant console')).toBeInTheDocument();
    expect(screen.getByText('IN-APP')).toBeInTheDocument();
    expect(screen.queryByText('Contoh alur')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Masuk' })).toBeInTheDocument();
    expect(container.querySelector('.login-page--tenant')).not.toBeNull();
    expect(container.querySelector('.login-context')).not.toBeNull();
  });

  it('renders platform lane with tenant actions and an alert slot', () => {
    const { container } = render(
      <LoginShell
        lane="platform"
        eyebrow="Platform admin"
        title="Masuk ke platform"
        intro="Gunakan akun platform admin untuk mengelola tenant."
        headline="Kendali lintas tenant."
        lede="Provisioning, suspend, dan audit lintas tenant."
        alert={<div role="alert">Email atau password salah.</div>}
      >
        <form aria-label="form platform" />
      </LoginShell>,
    );

    expect(screen.getByText('Platform lane')).toBeInTheDocument();
    expect(screen.getByText('PROVISION')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Email atau password salah.');
    expect(container.querySelector('.login-page--platform')).not.toBeNull();
  });
});
