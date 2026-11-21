import { zodResolver } from '@hookform/resolvers/zod';
import { isNotifHubError } from '@notifhub/js';
import { useState } from 'react';
import { Alert, Button, Form, Spinner } from 'react-bootstrap';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { loginSchema, type LoginValues } from '../forms/schemas';
import { platformClient } from '../lib/platformApiClient';
import { describeError } from '../lib/format';
import { loadPlatformSession, savePlatformSession } from '../lib/platformSession';
import { LoginShell } from './LoginShell';

function platformLoginError(error: unknown): string {
  if (isNotifHubError(error)) {
    if (error.code === 'unauthorized') return 'Email atau password salah.';
    if (error.code === 'forbidden') return 'Akun ini bukan platform admin yang aktif.';
    if (error.code === 'rate_limited') return 'Terlalu banyak percobaan. Coba lagi sebentar.';
  }

  return describeError(error);
}

/** Separate login form for the platform lane; the tenant login form is `/login`. */
export function PlatformLoginPage(): JSX.Element {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  if (loadPlatformSession() !== null) {
    return <Navigate to="/platform/tenants" replace />;
  }

  const onSubmit = async (values: LoginValues): Promise<void> => {
    setError(null);

    try {
      const result = await platformClient.login(values.email, values.password);
      savePlatformSession(result.accessToken, result.expiresIn, result.admin);
      navigate('/platform/tenants', { replace: true });
    } catch (caught: unknown) {
      setError(platformLoginError(caught));
    }
  };

  return (
    <LoginShell
      lane="platform"
      eyebrow="Platform admin"
      title="Masuk ke platform"
      intro="Gunakan akun platform admin untuk mengelola tenant."
      headline="Kendali lintas tenant."
      lede="Provisioning, suspend, dan audit lintas tenant. Masuk dengan akun platform admin untuk melanjutkan."
      alert={error !== null ? <Alert variant="danger">{error}</Alert> : null}
    >
      <Form onSubmit={handleSubmit(onSubmit)} noValidate>
        <Form.Group className="mb-3" controlId="platform-login-email">
          <Form.Label>Email</Form.Label>
          <Form.Control
            type="email"
            autoComplete="username"
            placeholder="ops@notifhub.local"
            isInvalid={errors.email !== undefined}
            {...register('email')}
          />
          {errors.email !== undefined ? (
            <div className="text-danger small mt-1">{errors.email.message}</div>
          ) : null}
        </Form.Group>

        <Form.Group className="mb-4" controlId="platform-login-password">
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
          {isSubmitting ? (
            <>
              <Spinner animation="border" size="sm" className="me-2" /> Masuk...
            </>
          ) : (
            'Masuk'
          )}
        </Button>
      </Form>
      <p className="login-back">
        <Link to="/login">Kembali ke login tenant admin</Link>
      </p>
    </LoginShell>
  );
}
