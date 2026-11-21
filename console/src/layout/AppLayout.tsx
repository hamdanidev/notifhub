import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { BrandMark } from '../components/BrandMark';
import { Icon, type IconName } from '../components/Icon';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}

const NAV_SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Workspace',
    items: [
      { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
      { to: '/notifications', label: 'Notifications', icon: 'bell' },
      { to: '/templates', label: 'Templates', icon: 'template' },
      { to: '/templates/assets', label: 'Aset template', icon: 'layers' },
    ],
  },
  {
    title: 'Audience',
    items: [
      { to: '/subscribers', label: 'Subscribers', icon: 'users' },
      { to: '/topics', label: 'Topics', icon: 'layers' },
    ],
  },
  {
    title: 'Developer',
    items: [{ to: '/api-keys', label: 'API keys', icon: 'key' }],
  },
  {
    title: 'Operations',
    items: [{ to: '/audit', label: 'Audit', icon: 'shield' }],
  },
];

const SIDEBAR_STORAGE_KEY = 'notifhub.console.sidebarCollapsed';
const MOBILE_QUERY = '(max-width: 959.98px)';

function pageTitle(pathname: string): string {
  if (pathname === '/') return 'Dashboard';
  if (pathname.startsWith('/notifications')) return 'Notifications';
  if (pathname.startsWith('/templates')) return 'Templates';
  if (pathname.startsWith('/subscribers')) return 'Subscribers';
  if (pathname.startsWith('/topics')) return 'Topics';
  if (pathname.startsWith('/api-keys')) return 'API keys';
  if (pathname.startsWith('/audit')) return 'Audit';
  if (pathname.startsWith('/account')) return 'Akun';
  return 'Console';
}

function initialCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function initialMobile(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches;
}

export function AppLayout(): JSX.Element {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [isMobile, setIsMobile] = useState(initialMobile);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const onChange = (): void => {
      setIsMobile(media.matches);

      if (!media.matches) {
        setMenuOpen(false);
      }
    };

    media.addEventListener('change', onChange);

    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      // localStorage can be unavailable in private/embedded contexts.
    }
  }, [collapsed]);

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

  const handleSidebarToggle = (): void => {
    if (isMobile) {
      setMenuOpen((open) => !open);
      return;
    }

    setCollapsed((value) => !value);
  };

  const sidebarToggleLabel = isMobile
    ? menuOpen
      ? 'Tutup menu'
      : 'Buka menu'
    : collapsed
      ? 'Perluas sidebar'
      : 'Ciutkan sidebar';

  return (
    <div className={`app-shell${collapsed && !isMobile ? ' sidebar-collapsed' : ''}`}>
      <aside
        className={`app-sidebar${menuOpen ? ' open' : ''}${collapsed && !isMobile ? ' collapsed' : ''}`}
        aria-label="Navigasi utama"
      >
        <div className="app-brand">
          <BrandMark />
          <div className="brand-text">
            <div className="brand-name">NotifHub</div>
            <div className="brand-sub">Console</div>
          </div>
          {!isMobile && !collapsed ? (
            <button
              type="button"
              className="sidebar-collapse-toggle"
              aria-label="Ciutkan sidebar"
              title="Ciutkan sidebar"
              onClick={handleSidebarToggle}
            >
              <Icon name="chevron-left" size={15} />
            </button>
          ) : null}
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
                  title={collapsed && !isMobile ? item.label : undefined}
                  aria-label={item.label}
                  className={({ isActive }) => {
                    const active =
                      item.to === '/templates'
                        ? isActive && !location.pathname.startsWith('/templates/assets')
                        : isActive;

                    return active ? 'app-nav-link active' : 'app-nav-link';
                  }}
                >
                  <Icon name={item.icon} size={16} />
                  <span className="nav-label">{item.label}</span>
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
          <span>NotifHub v0.11.0</span>
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
            {isMobile || collapsed ? (
              <button
                type="button"
                className="app-menu-toggle"
                aria-label={sidebarToggleLabel}
                title={sidebarToggleLabel}
                aria-expanded={isMobile ? menuOpen : !collapsed}
                onClick={handleSidebarToggle}
              >
                <Icon
                  name={
                    isMobile
                      ? menuOpen
                        ? 'x'
                        : 'menu'
                      : 'chevron-right'
                  }
                  size={16}
                />
              </button>
            ) : null}
            <span className="app-crumb">Tenant / {pageTitle(location.pathname)}</span>
          </div>

          <div className="app-topbar-right">
            {session !== null ? (
              <Link
                to="/account"
                className="account-email text-reset text-decoration-none"
                title="Akun dan ubah password"
              >
                {session.admin.email}
              </Link>
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
