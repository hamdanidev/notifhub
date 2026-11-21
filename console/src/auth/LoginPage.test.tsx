import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    session: null,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

describe('LoginPage', () => {
  it('renders the tenant login shell and form', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Setiap notifikasi punya jejak.')).toBeInTheDocument();
    expect(screen.getByText('Masuk ke workspace')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Masuk' })).toBeInTheDocument();
  });
});
