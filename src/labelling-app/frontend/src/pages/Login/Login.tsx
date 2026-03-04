import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui';
import './Login.css';

export function Login() {
  const { signInWithGoogle, authenticating, error, clearError } = useAuth();

  const handleGoogleSignIn = async () => {
    clearError();
    try {
      await signInWithGoogle();
    } catch {
      // Auth errors are already handled in context state.
    }
  };

  return (
    <div className="login-shell">
      <section className="login-card">
        <p className="eyebrow">RoCam Labeler</p>
        <h1>Sign in to continue</h1>
        <p className="muted">
          Use your Google account to access projects, upload images, and manage labels.
        </p>

        {error && <div className="banner error login-error">{error}</div>}

        <Button onClick={handleGoogleSignIn} loading={authenticating} className="login-button">
          Continue with Google
        </Button>
      </section>
    </div>
  );
}

export default Login;
