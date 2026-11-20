import { useState } from 'react';
import { Alert, Button, Card, Col, Form, Row } from 'react-bootstrap';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { changePassword } from '../lib/adminAccount';
import { describeError } from '../lib/format';

export function AccountPage(): JSX.Element {
  const { session, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (): Promise<void> => {
    setError(null);

    if (currentPassword.length === 0) {
      setError('Password saat ini wajib diisi.');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password baru minimal 8 karakter.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Konfirmasi password baru tidak cocok.');
      return;
    }

    setPending(true);

    try {
      await changePassword(currentPassword, newPassword);
      // tokenVersion naik di backend: semua sesi lama, termasuk sesi ini, tidak berlaku lagi.
      // Full reload avoids the ProtectedRoute redirect racing with the login banner.
      logout();
      window.location.replace('/login?passwordChanged=1');
    } catch (caught: unknown) {
      setError(describeError(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Akun"
        subtitle="Profil admin dan perubahan password."
      />

      <Row className="g-3">
        <Col xl={5}>
          <Card>
            <Card.Header className="small fw-semibold">Profil</Card.Header>
            <Card.Body>
              <dl className="row mb-0 small">
                <dt className="col-4 text-muted fw-normal">Email</dt>
                <dd className="col-8">{session?.admin.email ?? '—'}</dd>
                <dt className="col-4 text-muted fw-normal">Role</dt>
                <dd className="col-8">{session?.admin.role ?? '—'}</dd>
                <dt className="col-4 text-muted fw-normal">Tenant</dt>
                <dd className="col-8 mb-0">{session?.admin.tenantId ?? '—'}</dd>
              </dl>
            </Card.Body>
          </Card>
        </Col>

        <Col xl={7}>
          <Card>
            <Card.Header className="small fw-semibold">Ubah password</Card.Header>
            <Card.Body>
              {error !== null ? <Alert variant="danger">{error}</Alert> : null}

              <Alert variant="warning" className="small">
                Setelah password berubah, semua sesi admin (termasuk sesi ini) langsung logout dan
                harus masuk lagi dengan password baru.
              </Alert>

              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <Form.Group className="mb-3" controlId="account-current-password">
                  <Form.Label>Password saat ini</Form.Label>
                  <Form.Control
                    type="password"
                    autoComplete="current-password"
                    maxLength={128}
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                  />
                </Form.Group>

                <Form.Group className="mb-3" controlId="account-new-password">
                  <Form.Label>Password baru</Form.Label>
                  <Form.Control
                    type="password"
                    autoComplete="new-password"
                    maxLength={72}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                  />
                  <Form.Text className="text-muted">Minimal 8 karakter, maksimal 72.</Form.Text>
                </Form.Group>

                <Form.Group className="mb-4" controlId="account-confirm-password">
                  <Form.Label>Konfirmasi password baru</Form.Label>
                  <Form.Control
                    type="password"
                    autoComplete="new-password"
                    maxLength={72}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </Form.Group>

                <Button type="submit" disabled={pending}>
                  {pending ? 'Menyimpan…' : 'Ubah password'}
                </Button>
              </Form>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </>
  );
}
