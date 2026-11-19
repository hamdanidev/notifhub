import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Alert, Button, Form, Spinner } from 'react-bootstrap';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { loginSchema, type LoginValues } from '../forms/schemas';
import { describeError } from '../lib/format';
import { loadPlatformSession } from '../lib/platformSession';

export function LoginPage(): JSX.Element {
  const { session, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  if (session !== null) {
    return <Navigate to="/" replace />;
  }

  if (loadPlatformSession() !== null) {
    return <Navigate to="/platform/tenants" replace />;
  }

  const onSubmit = async (values: LoginValues): Promise<void> => {
    setError(null);

    try {
      await login(values.email, values.password);
      const state = location.state as { from?: string } | null;
      navigate(state?.from ?? '/', { replace: true });
    } catch (caught: unknown) {
      setError(describeError(caught));
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">N</div>
          <span className="brand-name">NotifHub</span>
        </div>

        <h1>Masuk</h1>
        <p className="login-intro">Gunakan akun tenant admin untuk melanjutkan.</p>

        {error !== null ? <Alert variant="danger">{error}</Alert> : null}

        <Form onSubmit={handleSubmit(onSubmit)} noValidate>
          <Form.Group className="mb-3" controlId="login-email">
            <Form.Label>Email</Form.Label>
            <Form.Control
              type="email"
              autoComplete="username"
              placeholder="admin@notifhub.local"
              isInvalid={errors.email !== undefined}
              {...register('email')}
            />
            {errors.email !== undefined ? (
              <div className="text-danger small mt-1">{errors.email.message}</div>
            ) : null}
          </Form.Group>

          <Form.Group className="mb-4" controlId="login-password">
            <Form.Label>Password</Form.Label>
            <Form.Control
              type="password"
              autoComplete="current-password"
              isInvalid={errors.password !== undefined}
              {...register('password')}
            />
            {errors.password !== undefined ? (
              <div className="text-danger small mt-1">{errors.password.message}</div>
            ) : null}
          </Form.Group>

          <Button type="submit" className="w-100" disabled={isSubmitting}>
            {isSubmitting ? <Spinner animation="border" size="sm" /> : 'Lanjutkan'}
          </Button>
        </Form>

        <p className="login-footnote">
          Login dibatasi 5 percobaan per menit. Sesi mengikuti nilai{' '}
          {'ADMIN_JWT_EXPIRES_IN'}.
        </p>
      </div>
    </div>
  );
}
