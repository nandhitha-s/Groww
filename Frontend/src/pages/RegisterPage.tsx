import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { useAuth } from '../context/auth-context';
import styles from './AuthForm.module.css';

export function RegisterPage() {
  const { status, error, register, clearError } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConfirmError(null);

    if (password !== confirmPassword) {
      setConfirmError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await register(name, email, password);
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
        <h1 className="text-h1">Start watching smarter.</h1>
        <p className={`${styles.subtitle} text-body`}>
          Build your watchlists and let the system surface the changes that matter.
        </p>
      </header>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {error && (
          <div className={`${styles.formError} anim-error`} role="alert">
            {error}
          </div>
        )}

        <TextField
          label="Name"
          type="text"
          name="name"
          autoComplete="name"
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            clearError();
          }}
        />

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
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            clearError();
          }}
        />

        <TextField
          label="Confirm Password"
          type="password"
          name="confirmPassword"
          autoComplete="new-password"
          required
          error={confirmError ?? undefined}
          value={confirmPassword}
          onChange={(event) => {
            setConfirmPassword(event.target.value);
            setConfirmError(null);
            clearError();
          }}
        />

        <Button type="submit" loading={submitting}>
          Register
        </Button>
      </form>

      <p className={`${styles.footerRow} text-body`}>
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
