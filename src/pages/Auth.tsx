import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, User, Mail, ShieldAlert, Shield } from 'lucide-react';
import { fetchApi } from '../services/api';
import { tokenStorage } from '../services/auth';
import type { AuthResponse } from '../types/api';
import './Auth.css';

type Tab = 'login' | 'register';
type Step = 'credentials' | 'totp';

export default function Auth() {
  const [activeTab, setActiveTab] = useState<Tab>('login');
  const [step, setStep] = useState<Step>('credentials');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const navigate = useNavigate();

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    setError(null);
    setPassword('');
    setConfirmPassword('');
    setStep('credentials');
  };

  const handleInputChange = (setter: React.Dispatch<React.SetStateAction<string>>, value: string) => {
    setter(value);
    if (error) setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (activeTab === 'register') {
      if (password.length < 6) { setError('A senha deve ter no mínimo 6 caracteres.'); return; }
      if (password !== confirmPassword) { setError('As senhas não coincidem.'); return; }
    }

    try {
      setLoading(true);
      if (activeTab === 'login') {
        const res = await fetchApi<AuthResponse>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });

        if (res.requires2fa) {
          setTempToken(res.tempToken);
          setStep('totp');
          return;
        }

        tokenStorage.setTokens(res.accessToken, res.refreshToken);
        navigate('/dashboard');
      } else {
        const res = await fetchApi<AuthResponse>('/auth/register', {
          method: 'POST',
          body: JSON.stringify({ name, email, password }),
        });

        if (!res.requires2fa) {
          tokenStorage.setTokens(res.accessToken, res.refreshToken);
        }
        navigate('/dashboard');
      }
    } catch (err) {
      setError((err instanceof Error ? err.message : String(err)) || 'Ocorreu um erro ao processar sua solicitação.');
    } finally {
      setLoading(false);
    }
  };

  const handleTotpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      setLoading(true);
      const res = await fetchApi<AuthResponse>('/auth/2fa/login', {
        method: 'POST',
        body: JSON.stringify({ token: totpCode }),
        headers: { Authorization: `Bearer ${tempToken}` }
      } as RequestInit);

      if (!res.requires2fa) {
        tokenStorage.setTokens(res.accessToken, res.refreshToken);
        navigate('/dashboard');
      }
    } catch (err) {
      setError((err instanceof Error ? err.message : String(err)) || 'Código inválido. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'totp') {
    return (
      <div className="auth-page">
        <div className="auth-grid-overlay"></div>
        <div className="auth-card-container animate-fade-in">
          <div className="auth-logo-section">
            <span className="auth-logo-text">PsicoApp</span>
          </div>
          <div className="auth-card">
            <div className="auth-header" style={{ textAlign: 'center' }}>
              <Shield size={40} style={{ color: 'var(--brand-primary)', margin: '0 auto 1rem' }} />
              <h2>Verificação em 2 etapas</h2>
              <p>Insira o código de 6 dígitos do seu aplicativo autenticador</p>
            </div>

            {error && (
              <div className="auth-error-banner">
                <ShieldAlert size={18} /><span>{error}</span>
              </div>
            )}

            <form onSubmit={handleTotpSubmit} className="auth-form">
              <div className="form-group">
                <label className="form-label">Código 2FA</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="000000"
                  value={totpCode}
                  onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  maxLength={8}
                  autoFocus
                  style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.5rem' }}
                  disabled={loading}
                />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>
                  Ou insira um dos seus códigos de backup de 8 caracteres.
                </p>
              </div>
              <button type="submit" className="btn btn-primary w-full mt-4 auth-submit-btn" disabled={loading || totpCode.length < 6}>
                {loading ? <div className="auth-spinner"></div> : 'Verificar'}
              </button>
              <button type="button" className="btn btn-secondary w-full mt-2"
                onClick={() => { setStep('credentials'); setTotpCode(''); setError(null); }}>
                Voltar
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-grid-overlay"></div>
      <div className="auth-card-container animate-fade-in">
        <div className="auth-logo-section">
          <span className="auth-logo-text">PsicoApp</span>
        </div>

        <div className="auth-card">
          <div className="auth-tabs">
            <button type="button" className={`auth-tab-btn ${activeTab === 'login' ? 'active' : ''}`}
              onClick={() => handleTabChange('login')} disabled={loading}>Login</button>
            <button type="button" className={`auth-tab-btn ${activeTab === 'register' ? 'active' : ''}`}
              onClick={() => handleTabChange('register')} disabled={loading}>Criar Conta</button>
          </div>

          <div className="auth-header">
            <h2>{activeTab === 'login' ? 'Bem-vindo de volta' : 'Crie sua conta gratuita'}</h2>
            <p>{activeTab === 'login' ? 'Insira suas credenciais para acessar o painel' : 'Comece a gerenciar seus pacientes e finanças hoje'}</p>
          </div>

          {error && (
            <div className="auth-error-banner">
              <ShieldAlert size={18} /><span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form">
            {activeTab === 'register' && (
              <div className="form-group">
                <label className="form-label" htmlFor="name">Seu nome</label>
                <div className="input-wrapper">
                  <User className="input-icon" size={18} />
                  <input id="name" type="text" className="form-control with-icon" placeholder="Ex: Dra. Ana Silva"
                    value={name} onChange={e => handleInputChange(setName, e.target.value)} required disabled={loading} />
                </div>
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="email">E-mail</label>
              <div className="input-wrapper">
                <Mail className="input-icon" size={18} />
                <input id="email" type="email" className="form-control with-icon" placeholder="exemplo@email.com"
                  value={email} onChange={e => handleInputChange(setEmail, e.target.value)}
                  required autoFocus={activeTab === 'login'} disabled={loading} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="password">Senha</label>
              <div className="input-wrapper">
                <Lock className="input-icon" size={18} />
                <input id="password" type={showPassword ? 'text' : 'password'}
                  className="form-control with-icon with-suffix" placeholder="Digite sua senha"
                  value={password} onChange={e => handleInputChange(setPassword, e.target.value)} required disabled={loading} />
                <button type="button" className="password-toggle-btn" onClick={() => setShowPassword(!showPassword)} disabled={loading}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {activeTab === 'register' && (
              <div className="form-group">
                <label className="form-label" htmlFor="confirmPassword">Confirmar senha</label>
                <div className="input-wrapper">
                  <Lock className="input-icon" size={18} />
                  <input id="confirmPassword" type={showConfirmPassword ? 'text' : 'password'}
                    className="form-control with-icon with-suffix" placeholder="Confirme sua senha"
                    value={confirmPassword} onChange={e => handleInputChange(setConfirmPassword, e.target.value)} required disabled={loading} />
                  <button type="button" className="password-toggle-btn" onClick={() => setShowConfirmPassword(!showConfirmPassword)} disabled={loading}>
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            )}

            <button type="submit" className="btn btn-primary w-full mt-4 auth-submit-btn" disabled={loading}>
              {loading ? <div className="auth-spinner"></div> : activeTab === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
