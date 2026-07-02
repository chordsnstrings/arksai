import { useAuth } from '../lib/auth.jsx';

/** The landing page after sign-in — replace with the app's real home. */
export default function Home() {
  const { user } = useAuth();
  return (
    <div className="page">
      <div className="page-hd">
        <div className="titles">
          <div className="eyebrow">__APP_NAME__</div>
          <h1>Welcome, {user?.name?.split(' ')[0] || 'there'}</h1>
          <div className="sub">__APP_DESCRIPTION__</div>
        </div>
      </div>
      <div className="grid grid-3">
        <div className="card"><div className="card-hd"><h3>Getting started</h3></div><p className="muted">This is the scaffolded home page — build the app's real content here.</p></div>
      </div>
    </div>
  );
}
