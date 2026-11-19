import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import { clearPlatformSession, loadPlatformSession } from '../lib/platformSession';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

const NAV_SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Manage',
    items: [
      { to: '/platform/tenants', label: 'Tenants', icon: 'layers' },
      { to: '/platform/audit', label: 'Audit', icon: 'shield' },
    ],
  },
];

const SIDEBAR_STORAGE_KEY = 'notifhub.console.platformSidebarCollapsed';
const MOBILE_QUERY = '(max-width: 959.98px)';

function pageTitle(pathname: string): string {
  if (pathname.startsWith('/platform/tenants/')) return 'Tenant detail';
  if (pathname.startsWith('/platform/tenants')) return 'Tenants';
  if (pathname.startsWith('/platform/audit')) return 'Audit';
  return 'Platform';
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

/**
 * Chrome for the platform lane.
 *
 * It deliberately reuses the tenant console's layout language (sidebar, topbar, content width)
 * so both surfaces feel like one product, with a teal accent, a "Platform" brand sub-label, and
 * its own navigation/session so the two lanes stay visually and functionally distinguishable.
 */
export function PlatformLayout(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const session = loadPlatformSession();
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
    document.title = `${pageTitle(location.pathname)} - NotifHub Platform`;
  }, [location.pathname]);

  const handleLogout = (): void => {
    clearPlatformSession();
    navigate('/platform/login', { replace: true });
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
    <div
      className={`app-shell platform-shell${collapsed && !isMobile ? ' sidebar-collapsed' : ''}`}
    >
      <aside
        className={`app-sidebar${menuOpen ? ' open' : ''}${collapsed && !isMobile ? ' collapsed' : ''}`}
        aria-label="Navigasi platform"
      >
        <div className="app-brand">
          <div className="brand-mark">P</div>
          <div className="brand-text">
            <div className="brand-name">NotifHub</div>
            <div className="brand-sub">Platform</div>
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
                  title={collapsed && !isMobile ? item.label : undefined}
                  aria-label={item.label}
                  className={({ isActive }) => (isActive ? 'app-nav-link active' : 'app-nav-link')}
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
            platform lane
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
                  name={isMobile ? (menuOpen ? 'x' : 'menu') : 'chevron-right'}
                  size={16}
                />
              </button>
            ) : null}
            <span className="app-crumb">Platform / {pageTitle(location.pathname)}</span>
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
