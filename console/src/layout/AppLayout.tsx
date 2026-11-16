import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

const NAV_SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Workspace',
    items: [
      { to: '/', label: 'Dashboard', end: true },
      { to: '/notifications', label: 'Notifications' },
      { to: '/templates', label: 'Templates' },
    ],
  },
  {
    title: 'Audience',
    items: [
      { to: '/subscribers', label: 'Subscribers' },
      { to: '/topics', label: 'Topics' },
    ],
  },
  {
    title: 'Developer',
    items: [{ to: '/api-keys', label: 'API keys' }],
  },
];

function pageTitle(pathname: string): string {
  if (pathname === '/') return 'Dashboard';
  if (pathname.startsWith('/notifications')) return 'Notifications';
  if (pathname.startsWith('/templates')) return 'Templates';
  if (pathname.startsWith('/subscribers')) return 'Subscribers';
  if (pathname.startsWith('/topics')) return 'Topics';
  if (pathname.startsWith('/api-keys')) return 'API keys';
  return 'Console';
}

export function AppLayout(): JSX.Element {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.title = `${pageTitle(location.pathname)} · NotifHub`;
  }, [location.pathname]);

  const handleLogout = (): void => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      <aside className={menuOpen ? 'app-sidebar open' : 'app-sidebar'}>
        <div className="app-brand">
          <div className="brand-mark">N</div>
          <div className="brand-text">
            <div className="brand-name">NotifHub</div>
            <div className="brand-sub">Console</div>
          </div>
        </div>

        <nav>
          {NAV_SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="nav-section-title">{section.title}</div>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    isActive ? 'app-nav-link active' : 'app-nav-link'
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="app-sidebar-footer">
          <span className="sidebar-tenant">
            <span className="dot" />
            {session?.admin.tenantId ?? 'tenant'}
          </span>
          <a href="http://localhost:3000/api/docs" target="_blank" rel="noreferrer">
            API documentation
          </a>
          <span>NotifHub v0.7.0</span>
        </div>
      </aside>

      {menuOpen ? (
        <button
          type="button"
          className="app-overlay"
          aria-label="Tutup menu"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <div className="app-main">
        <header className="app-topbar">
          <div className="d-flex align-items-center gap-2">
            <button
              type="button"
              className="app-menu-toggle"
              aria-label="Buka menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Icon name="menu" size={16} />
            </button>
            <span className="app-crumb">Tenant / {pageTitle(location.pathname)}</span>
          </div>

          <div className="app-topbar-right">
            {session !== null ? (
              <span className="account-email">{session.admin.email}</span>
            ) : null}
            <button type="button" className="btn btn-link" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </header>

        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
