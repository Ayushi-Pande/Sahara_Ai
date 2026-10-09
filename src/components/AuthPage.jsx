import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Shield } from 'lucide-react';
import { authenticateBackendAccount } from '../services/safetyApi.js';

export default function AuthPage({ mode, onAuthenticated }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const location = useLocation();
  const navigate = useNavigate();
  const isSignup = mode === 'signup';

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (isSignup && !name.trim()) {
      setError('Enter your name to create an account.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await authenticateBackendAccount(mode, {
        email: email.trim(),
        password,
        ...(isSignup ? { name: name.trim(), phone: phone.trim() || null } : {}),
      });
      if (!result.synced) {
        setError(result.status === 'not-configured'
          ? 'The backend is not configured for this build. Set VITE_API_URL and try again.'
          : result.error || 'The account request could not be completed. Please try again.');
        return;
      }
      setPassword('');
      onAuthenticated(result.data.user);
      navigate(location.state?.from || '/home', { replace: true });
    } catch {
      setError('The account request could not be completed. Please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="auth-title">
        <Link to="/" className="auth-brand" aria-label="SAHARA AI home">
          <span className="brand-mark"><Shield size={20} /></span>
          <span>SAHARA <b>AI</b></span>
        </Link>
        <span className="eyebrow">{isSignup ? 'CREATE YOUR ACCOUNT' : 'SECURE SIGN IN'}</span>
        <h1 id="auth-title">{isSignup ? 'Create your account' : 'Welcome back'}</h1>
        <p className="auth-description">
          {isSignup
            ? 'Create an account with the SAHARA AI backend to access your safety workspace.'
            : 'Sign in to continue to your SAHARA AI safety workspace.'}
        </p>
        <form className="auth-form" onSubmit={submit}>
          {isSignup && (
            <>
              <label className="field-label" htmlFor="auth-name">FULL NAME
                <input id="auth-name" name="name" type="text" autoComplete="name" value={name}
                  onChange={(event) => setName(event.target.value)} maxLength={120} required />
              </label>
              <label className="field-label" htmlFor="auth-phone">PHONE (OPTIONAL)
                <input id="auth-phone" name="phone" type="tel" autoComplete="tel" value={phone}
                  onChange={(event) => setPhone(event.target.value)} maxLength={40} />
              </label>
            </>
          )}
          <label className="field-label" htmlFor="auth-email">EMAIL
            <input id="auth-email" name="email" type="email" autoComplete="email" value={email}
              onChange={(event) => setEmail(event.target.value)} maxLength={254} required />
          </label>
          <label className="field-label" htmlFor="auth-password">PASSWORD
            <input id="auth-password" name="password" type="password"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              value={password} onChange={(event) => setPassword(event.target.value)}
              minLength={isSignup ? 8 : 1} maxLength={128} required />
          </label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="button button--hot button--full auth-submit" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}
            {!busy && <ArrowRight size={16} />}
          </button>
        </form>
        <p className="auth-switch">
          {isSignup ? 'Already have an account?' : 'New to SAHARA AI?'}{' '}
          <Link to={isSignup ? '/login' : '/signup'} state={location.state}>
            {isSignup ? 'Sign in' : 'Create an account'}
          </Link>
        </p>
        <p className="auth-security-note">
          Passwords are sent only to the configured backend and are never stored by this app.
          Sessions use the backend’s bearer-token design and are scoped to this browser tab.
        </p>
      </section>
    </main>
  );
}
