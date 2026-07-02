import { useAuth } from '../lib/auth.jsx';
import { Icon } from './Icons.jsx';
import Avatar from './Avatar.jsx';

/** The app frame: icon rail on mobile (labels hidden by the responsive layer), full sidebar
 *  on desktop, breadcrumb topbar. Nav renders from the generated module registry. */
export default function AppShell({ page, onNavigate, pages, children }) {
  const { user, logout } = useAuth();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">__APP_INITIAL__</div>
          <div className="brand-name">__APP_NAME__</div>
        </div>
        <nav className="nav">
          {pages.map((p) => (
            <button key={p.key} className={`nav-item ${page === p.key ? 'active' : ''}`} onClick={() => onNavigate(p.key)}>
              <Icon name={p.icon} size={15} /> <span className="label">{p.label}</span>
            </button>
          ))}
          <button className="nav-item" onClick={logout}>
            <Icon name="logout" size={15} /> <span className="label">Sign out</span>
          </button>
        </nav>
        <div className="sidebar-footer">
          {user && (
            <div className="user-chip">
              <Avatar name={user.name} color={user.avatarColor || '#e8b059'} />
              <div className="meta">
                <div className="name">{user.name}</div>
                <div className="email">{user.email}</div>
              </div>
            </div>
          )}
        </div>
      </aside>
      <section className="main">
        <header className="topbar">
          <div className="crumbs">
            <span>__APP_NAME__</span>
            <span className="sep">/</span>
            <span className="current">{(pages.find((p) => p.key === page) || pages[0]).label}</span>
          </div>
          <div className="spacer" />
          <Avatar name={user?.name} color={user?.avatarColor || '#e8b059'} size="xs" />
        </header>
        <main className="main-scroll">{children}</main>
      </section>
    </div>
  );
}
