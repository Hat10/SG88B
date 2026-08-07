import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Couple } from '../components';

export default function PageLogin() {
  const { signIn } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const err = await signIn(email, password);
    if (err) setError('Feil e-post eller passord.');
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
    }}>
      <div style={{ width: 360, display: 'flex', flexDirection: 'column', gap: 32 }}>

        {/* Brand */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <Couple size="lg" />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.03em', color: 'var(--ink)' }}>SG88B</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>A & T · 2026</div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={submit} style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 12,
          padding: '28px 28px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}>
          <div>
            <label className="card-eyebrow" style={{ display: 'block', marginBottom: 6 }}>E-post</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              required
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label className="card-eyebrow" style={{ display: 'block', marginBottom: 6 }}>Passord</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              style={{ width: '100%' }}
            />
          </div>

          {error && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--warn)' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn primary"
            disabled={loading}
            style={{ width: '100%', justifyContent: 'center', marginTop: 4, opacity: loading ? 0.6 : 1 }}
          >
            {loading ? 'Logger inn...' : 'Logg inn'}
          </button>
        </form>

      </div>
    </div>
  );
}
