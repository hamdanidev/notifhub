import { useEffect } from 'react';
import { Button, Container, Nav, Navbar } from 'react-bootstrap';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { clearPlatformSession, loadPlatformSession } from '../lib/platformSession';

/** Chrome for the platform lane: separate navigation from the tenant console. */
export function PlatformLayout(): JSX.Element {
  const navigate = useNavigate();
  const session = loadPlatformSession();

  useEffect(() => {
    document.title = 'Platform - NotifHub';
  }, []);

  const handleLogout = (): void => {
    clearPlatformSession();
    navigate('/platform/login', { replace: true });
  };

  return (
    <div className="platform-shell">
      <Navbar bg="dark" variant="dark" expand="sm" className="mb-4">
        <Container fluid>
          <Navbar.Brand as={NavLink} to="/platform/tenants">
            NotifHub <span className="text-secondary">Platform</span>
          </Navbar.Brand>
          <Navbar.Toggle aria-controls="platform-nav" />
          <Navbar.Collapse id="platform-nav">
            <Nav className="me-auto">
              <Nav.Link as={NavLink} to="/platform/tenants">
                Tenants
              </Nav.Link>
              <Nav.Link as={NavLink} to="/platform/audit">
                Audit
              </Nav.Link>
            </Nav>
            <div className="d-flex align-items-center gap-3">
              <span className="text-white-50 small">{session?.admin.email ?? ''}</span>
              <Button size="sm" variant="outline-light" onClick={handleLogout}>
                Logout
              </Button>
            </div>
          </Navbar.Collapse>
        </Container>
      </Navbar>

      <main className="container-fluid px-4 pb-5">
        <Outlet />
      </main>
    </div>
  );
}
