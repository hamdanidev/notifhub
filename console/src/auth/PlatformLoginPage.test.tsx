import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PlatformLoginPage } from './PlatformLoginPage';

vi.mock('../lib/platformApiClient', () => ({
  platformClient: { login: vi.fn() },
}));

vi.mock('../lib/platformSession', () => ({
  loadPlatformSession: () => null,
  savePlatformSession: vi.fn(),
}));

describe('PlatformLoginPage', () => {
  it('renders the platform login shell and the tenant link', () => {
    render(
      <MemoryRouter initialEntries={['/platform/login']}>
        <PlatformLoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Kendali lintas tenant.')).toBeInTheDocument();
    expect(screen.getByText('Masuk ke platform')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kembali ke login tenant admin' })).toBeInTheDocument();
  });
});
