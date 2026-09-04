import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { useAuth } from '../context/auth-context';
import styles from './AuthForm.module.css';

export function LoginPage() {
  const { status, error, login, clearError } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/dashboard', { replace: true });
    } catch {
      // error is already surfaced via useAuth().error
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <header className={styles.header}>
        <h1 className="text-h1">Welcome back</h1>
        <p className={`${styles.subtitle} text-body`}>Sign in to continue to your watchlist.</p>
      </header>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {error && (
          <div className={`${styles.formError} anim-error`} role="alert">
            {error}
          </div>
        )}

        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            clearError();
          }}
        />

        <TextField
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            clearError();
          }}
        />

        <Button type="submit" loading={submitting}>
          Sign In
        </Button>
      </form>

      <p className={`${styles.footerRow} text-body`}>
        Don&rsquo;t have an account? <Link to="/register">Create one</Link>
      </p>
    </AuthLayout>
  );
}
