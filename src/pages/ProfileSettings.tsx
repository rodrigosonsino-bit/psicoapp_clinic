import React, { useState, useEffect, useCallback } from 'react';
import { Save, User, CreditCard, Shield, MapPin, ShieldCheck, ShieldOff, Copy, CalendarDays, CheckCircle, XCircle, Smartphone, RefreshCw, Power, Loader2, Palette, MessageSquare } from 'lucide-react';
import { fetchApi } from '../services/api';
import type { TenantProfile, TotpSetupResult, GoogleCalendarStatus, WhatsappStatus, BookingPageSettings, CardFeeRates } from '../types/api';
import { useToast } from '../context/ToastContext';
import Skeleton from '../components/Skeleton';
import ErrorState from '../components/ErrorState';
import './ProfileSettings.css';

export default function ProfileSettings() {
  const [formData, setFormData] = useState({
    fullName: '',
    document: '',
    professionalId: '',
    address: '',
    twoFactorEnabled: false,
    whatsappReminderTemplate: ''
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const toast = useToast();

  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);
      setError(false);
      const data = await fetchApi<TenantProfile>('/api/profile');
      setFormData({
        fullName: data.fullName || '',
        document: data.document || '',
        professionalId: data.professionalId || '',
        address: data.address || '',
        twoFactorEnabled: data.twoFactorEnabled || false,
        whatsappReminderTemplate: data.whatsappReminderTemplate || ''
      });
    } catch (err) {
      console.error(err);
      setError(true);
      toast.error('Erro ao carregar os dados de perfil.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await fetchApi<TenantProfile>('/api/profile', {
        method: 'PUT',
        body: JSON.stringify(formData)
      });
      toast.success('Perfil atualizado com sucesso!');
    } catch (err) {
      console.error(err);
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao salvar alterações no perfil.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="profile-container animate-fade-in">
        <h1 className="text-h1">Configurações do Perfil</h1>
        <p className="text-body"><Skeleton width="150px" height="1rem" className="mt-2" /></p>
        <div className="card profile-card mt-4" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <Skeleton width="100%" height="2.5rem" />
          <div style={{ display: 'flex', gap: '1rem' }}>
            <Skeleton width="50%" height="2.5rem" />
            <Skeleton width="50%" height="2.5rem" />
          </div>
          <Skeleton width="100%" height="5rem" />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Skeleton width="120px" height="2.5rem" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="profile-container animate-fade-in">
        <h1 className="text-h1">Configurações do Perfil</h1>
        <ErrorState
          title="Erro ao obter perfil"
          message="Não foi possível obter os dados cadastrais do seu perfil profissional."
          onRetry={loadProfile}
        />
      </div>
    );
  }

  return (
    <div className="profile-container animate-fade-in">
      <div className="profile-header">
        <div>
          <h1 className="text-h1">Configurações do Perfil</h1>
          <p className="text-body">Gerencie seus dados profissionais para emissão de recibos válidos</p>
        </div>
      </div>

      <WhatsappSection />
      <GoogleCalendarSection />
      <TwoFactorSection
        enabled={formData.twoFactorEnabled}
        onStatusChange={(status) => setFormData(prev => ({ ...prev, twoFactorEnabled: status }))}
      />

      <BookingPageSection />
      <CardFeeRatesSection />

      <div className="card profile-card mt-4">
        <form onSubmit={handleSubmit} className="profile-form">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label flex items-center gap-2">
                <User size={16} className="text-muted" /> Nome Completo *
              </label>
              <input
                required
                type="text"
                className="form-control"
                placeholder="Ex: Dra. Ana Silva"
                value={formData.fullName}
                onChange={e => setFormData({ ...formData, fullName: e.target.value })}
                disabled={saving}
              />
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label className="form-label flex items-center gap-2">
                <CreditCard size={16} className="text-muted" /> CPF ou CNPJ *
              </label>
              <input
                required
                type="text"
                className="form-control"
                placeholder="Ex: 000.000.000-00"
                value={formData.document}
                onChange={e => setFormData({ ...formData, document: e.target.value })}
                disabled={saving}
              />
            </div>

            <div className="form-group">
              <label className="form-label flex items-center gap-2">
                <Shield size={16} className="text-muted" /> CRP (Registro Profissional)
              </label>
              <input
                type="text"
                className="form-control"
                placeholder="Ex: CRP 06/12345 (Opcional)"
                value={formData.professionalId}
                onChange={e => setFormData({ ...formData, professionalId: e.target.value })}
                disabled={saving}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label flex items-center gap-2">
                <MapPin size={16} className="text-muted" /> Endereço do Consultório *
              </label>
              <textarea
                required
                className="form-control"
                rows={3}
                placeholder="Ex: Av. Paulista, 1000 - Sala 42, Bela Vista, São Paulo - SP"
                value={formData.address}
                onChange={e => setFormData({ ...formData, address: e.target.value })}
                style={{ resize: 'vertical', minHeight: '80px' }}
                disabled={saving}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label flex items-center gap-2">
                <MessageSquare size={16} className="text-muted" /> Mensagem de Lembrete (WhatsApp)
              </label>
              <textarea
                className="form-control"
                rows={5}
                placeholder={'Olá, {nome}! 😊\n\nLembrando que você tem uma sessão agendada:\n📅 {data}\n⏱️ Duração: {duracao} minutos\n\nPor favor, confirme sua presença respondendo esta mensagem.\nCaso precise reagendar, entre em contato com antecedência.'}
                value={formData.whatsappReminderTemplate}
                onChange={e => setFormData({ ...formData, whatsappReminderTemplate: e.target.value })}
                style={{ resize: 'vertical', minHeight: '120px', fontFamily: 'inherit' }}
                disabled={saving}
                maxLength={1000}
              />
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                Use <code>{'{nome}'}</code>, <code>{'{data}'}</code> e <code>{'{duracao}'}</code> para inserir os dados do agendamento. Deixe vazio para usar a mensagem padrão (mostrada acima como exemplo).
              </p>
              {formData.whatsappReminderTemplate && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginTop: '0.5rem' }}
                  onClick={() => setFormData({ ...formData, whatsappReminderTemplate: '' })}
                  disabled={saving}
                >
                  Restaurar mensagem padrão
                </button>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-6">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
            >
              <Save size={18} /> {saving ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── WhatsApp Section ──────────────────────────────────────────────────────────

function WhatsappSection() {
  const [status, setStatus] = useState<WhatsappStatus | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [pairingPhone, setPairingPhone] = useState('');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [pairingLoading, setPairingLoading] = useState(false);
  const toast = useToast();

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetchApi<WhatsappStatus>('/api/whatsapp/status');
      setStatus(res);
      // Se está conectando e tem QR, busca o QR code
      if (!res.connected && res.hasQr) {
        const qrRes = await fetchApi<{ qr: string }>('/api/whatsapp/qr');
        setQr(qrRes.qr);
      } else {
        setQr(null);
      }
    } catch {
      setStatus({ connected: false, status: 'disconnected', hasQr: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    // Polling a cada 5s enquanto estiver conectando (aguardando scan do QR)
    const interval = setInterval(() => {
      if (status?.status === 'connecting') loadStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, [loadStatus, status?.status]);

  const handleConnect = async () => {
    try {
      setConnecting(true);
      setPairingCode(null);
      await fetchApi('/api/whatsapp/connect', { method: 'POST', body: '{}' });
      toast.success('Inicializando conexão WhatsApp...');
      setTimeout(() => loadStatus(), 2000);
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao conectar WhatsApp.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setDisconnecting(true);
      await fetchApi('/api/whatsapp/disconnect', { method: 'POST', body: '{}' });
      toast.success('WhatsApp desconectado.');
      setStatus({ connected: false, status: 'disconnected', hasQr: false });
      setQr(null);
      setPairingCode(null);
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao desconectar.');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleGetPairingCode = async () => {
    if (!pairingPhone.trim()) { toast.error('Digite o número com DDI (ex: 5511999998888)'); return; }
    try {
      setPairingLoading(true);
      const res = await fetchApi<{ code: string }>('/api/whatsapp/pairing-code', {
        method: 'POST',
        body: JSON.stringify({ phoneNumber: pairingPhone.replace(/\D/g, '') }),
      });
      setPairingCode(res.code);
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao gerar código.');
    } finally {
      setPairingLoading(false);
    }
  };

  const statusColor = status?.connected ? 'var(--status-success)' : status?.status === 'connecting' ? 'var(--status-warning)' : 'var(--text-muted)';
  const statusLabel = status?.connected ? 'Conectado' : status?.status === 'connecting' ? 'Conectando...' : 'Desconectado';

  return (
    <div className="card profile-card mt-4" style={{ maxWidth: 700 }}>
      <div className="flex items-center gap-2 mb-4">
        <Smartphone size={20} style={{ color: '#25d366' }} />
        <h3 className="text-h3" style={{ margin: 0 }}>WhatsApp — Lembretes Automáticos</h3>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Verificando conexão...</div>
      ) : (
        <div>
          {/* Status */}
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <div className="flex items-center gap-2">
              <span style={{
                width: 10, height: 10, borderRadius: '50%', background: statusColor, display: 'inline-block',
                boxShadow: status?.status === 'connecting' ? `0 0 6px ${statusColor}` : undefined,
              }} />
              <span style={{ fontWeight: 500, color: statusColor }}>{statusLabel}</span>
              {!status?.connected && (
                <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  — conecte para enviar lembretes automáticos via WhatsApp
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-secondary" onClick={loadStatus} title="Atualizar status">
                <RefreshCw size={14} />
              </button>
              {status?.connected ? (
                <button className="btn btn-secondary" onClick={handleDisconnect} disabled={disconnecting}>
                  <Power size={14} /> {disconnecting ? 'Desconectando...' : 'Desconectar'}
                </button>
              ) : (
                <button className="btn btn-primary" onClick={handleConnect} disabled={connecting}>
                  <Smartphone size={14} /> {connecting ? 'Inicializando...' : 'Conectar WhatsApp'}
                </button>
              )}
            </div>
          </div>

          {/* QR Code */}
          {!status?.connected && qr && (
            <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '1rem', padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <img src={qr} alt="QR Code WhatsApp" style={{ width: 180, height: 180, borderRadius: 8 }} />
              <div style={{ flex: 1, minWidth: 200 }}>
                <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Escaneie o QR Code</p>
                <ol style={{ padding: '0 0 0 1.2rem', lineHeight: 1.9, fontSize: '0.9rem', color: 'var(--text-secondary)', margin: 0 }}>
                  <li>Abra o WhatsApp no celular</li>
                  <li>Toque em <strong>Dispositivos conectados</strong></li>
                  <li>Toque em <strong>Conectar dispositivo</strong></li>
                  <li>Aponte a câmera para o QR Code</li>
                </ol>
                <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  O QR expira em 60 segundos. Use "Atualizar status" se ele expirar.
                </p>
              </div>
            </div>
          )}

          {/* Código de pareamento (alternativa ao QR) */}
          {!status?.connected && (
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '0.5rem' }}>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                <strong>Alternativa:</strong> conecte via código de 8 dígitos sem QR Code
              </p>
              <div className="flex gap-2" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontSize: '0.8rem' }}>Número com DDI (ex: 5511999998888)</label>
                  <input type="text" className="form-control" value={pairingPhone}
                    onChange={e => { setPairingPhone(e.target.value); setPairingCode(null); }}
                    placeholder="5511999998888" style={{ width: 220 }} disabled={pairingLoading} />
                </div>
                <button className="btn btn-secondary" onClick={handleGetPairingCode} disabled={pairingLoading || !pairingPhone.trim()} style={{ whiteSpace: 'nowrap' }}>
                  {pairingLoading ? <><Loader2 size={14} className="animate-spin" /> Gerando...</> : 'Gerar Código'}
                </button>
              </div>
              {pairingCode && (
                <div style={{ marginTop: '0.75rem', padding: '0.75rem 1rem', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', display: 'inline-block' }}>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 0.3rem' }}>Insira este código no WhatsApp → Dispositivos conectados → Vincular com número</p>
                  <span style={{ fontFamily: 'monospace', fontSize: '1.5rem', fontWeight: 700, letterSpacing: '0.2rem', color: 'var(--brand-primary)' }}>{pairingCode}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Google Calendar Section ───────────────────────────────────────────────────

function GoogleCalendarSection() {
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const toast = useToast();

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetchApi<GoogleCalendarStatus>('/auth/google/status');
      setStatus(res);
    } catch {
      setStatus({ connected: false, calendarName: null, calendarId: null });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Detecta retorno do OAuth Google pela query string
    const params = new URLSearchParams(window.location.search);
    const googleParam = params.get('google');
    if (googleParam === 'connected') {
      toast.success('Google Calendar conectado com sucesso!');
      window.history.replaceState({}, '', '/profile');
    } else if (googleParam === 'denied') {
      toast.error('Conexão com Google cancelada.');
      window.history.replaceState({}, '', '/profile');
    } else if (googleParam === 'error') {
      toast.error('Erro ao conectar com Google Calendar. Tente novamente.');
      window.history.replaceState({}, '', '/profile');
    }
    loadStatus();
  }, [loadStatus, toast]);

  const handleConnect = async () => {
    try {
      setConnecting(true);
      setConfigError(null);
      const res = await fetchApi<{ url: string }>('/auth/google/auth-url');
      // Navega para o consent screen do Google com o token já validado pelo fetch
      window.location.href = res.url;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('GOOGLE_CLIENT_ID') || msg.includes('não está configurado') || msg.includes('503')) {
        setConfigError('As credenciais do Google Calendar não estão configuradas no servidor. Consulte o guia de configuração.');
      } else {
        toast.error(msg || 'Erro ao iniciar conexão com Google Calendar.');
      }
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setDisconnecting(true);
      await fetchApi('/auth/google/disconnect', { method: 'DELETE' });
      toast.success('Google Calendar desconectado.');
      setStatus({ connected: false, calendarName: null, calendarId: null });
    } catch {
      toast.error('Erro ao desconectar Google Calendar.');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="card profile-card mt-4" style={{ maxWidth: 700 }}>
      <div className="flex items-center gap-2 mb-4">
        <CalendarDays size={20} style={{ color: '#4285f4' }} />
        <h3 className="text-h3" style={{ margin: 0 }}>Google Calendar</h3>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Verificando conexão...</div>
      ) : status?.connected ? (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle size={18} style={{ color: 'var(--status-success)' }} />
            <div>
              <p style={{ color: 'var(--text-primary)', fontWeight: 500, margin: 0 }}>
                Conectado — calendário <strong>{status.calendarName}</strong>
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.2rem 0 0' }}>
                Novos agendamentos serão criados automaticamente neste calendário.
              </p>
            </div>
          </div>
          <button className="btn btn-secondary" onClick={handleDisconnect} disabled={disconnecting}>
            <XCircle size={16} /> {disconnecting ? 'Desconectando...' : 'Desconectar'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                Sincronize seus agendamentos com o Google Calendar automaticamente.
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.3rem 0 0' }}>
                Será criado/usado o calendário <strong>Sessões_Terapia</strong> na sua conta Google.
              </p>
            </div>
            <button
              className="btn btn-primary"
              onClick={handleConnect}
              disabled={connecting}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}
            >
              <CalendarDays size={16} />
              {connecting ? 'Redirecionando...' : 'Conectar Google Calendar'}
            </button>
          </div>

          {configError && (
            <div style={{
              background: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid var(--status-warning)',
              borderRadius: 'var(--radius-md)',
              padding: '0.875rem 1rem',
              fontSize: '0.875rem',
              color: 'var(--status-warning)',
              lineHeight: 1.5
            }}>
              <strong>Configuração necessária:</strong> {configError}
              <br />
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Adicione <code>GOOGLE_CLIENT_ID</code> e <code>GOOGLE_CLIENT_SECRET</code> no arquivo <code>.env</code> do backend e reinicie o servidor.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 2FA Section ───────────────────────────────────────────────────────────────

function TwoFactorSection({ enabled, onStatusChange }: { enabled: boolean, onStatusChange: (status: boolean) => void }) {
  const [setup, setSetup] = useState<TotpSetupResult | null>(null);
  const [step, setStep] = useState<'idle' | 'setup' | 'disable'>('idle');
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  const handleSetup = async () => {
    try {
      setSubmitting(true);
      const res = await fetchApi<{ data: TotpSetupResult }>('/auth/2fa/setup', { method: 'POST' });
      setSetup(res.data);
      setStep('setup');
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao iniciar configuração do 2FA.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      await fetchApi('/auth/2fa/verify', { method: 'POST', body: JSON.stringify({ token }) });
      toast.success('2FA ativado com sucesso! Guarde seus códigos de backup.');
      setStep('idle');
      setToken('');
      onStatusChange(true);
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Código inválido.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      await fetchApi('/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ token }) });
      toast.success('2FA desativado.');
      setStep('idle');
      setToken('');
      setSetup(null);
      onStatusChange(false);
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Código inválido.');
    } finally {
      setSubmitting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copiado!');
  };

  return (
    <div className="card profile-card mt-4">
      <div className="flex items-center gap-2 mb-4">
        <Shield size={20} style={{ color: 'var(--brand-primary)' }} />
        <h3 className="text-h3" style={{ margin: 0 }}>Autenticação em 2 Fatores (2FA)</h3>
      </div>

      {step === 'idle' && (
        <div className="flex items-center justify-between">
          <p style={{ color: 'var(--text-secondary)', maxWidth: '420px' }}>
            Adicione uma camada extra de segurança usando um aplicativo como Google Authenticator ou Authy.
          </p>
          <div className="flex gap-2">
            {!enabled ? (
              <button className="btn btn-primary" onClick={handleSetup} disabled={submitting}>
                <ShieldCheck size={16} /> Ativar 2FA
              </button>
            ) : (
              <button className="btn btn-secondary" onClick={() => setStep('disable')}>
                <ShieldOff size={16} /> Desativar
              </button>
            )}
          </div>
        </div>
      )}

      {step === 'setup' && setup && (
        <div>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Escaneie o QR Code abaixo com seu app autenticador e insira o código gerado para confirmar.
          </p>
          <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <img src={setup.qrCodeDataUrl} alt="QR Code 2FA" style={{ width: 180, height: 180, borderRadius: 8, border: '1px solid var(--border-color)' }} />
            <div style={{ flex: 1, minWidth: '240px' }}>
              <div className="form-group mb-3">
                <label className="form-label">Chave Manual</label>
                <div className="flex gap-2">
                  <input readOnly className="form-control" value={setup.secret} style={{ fontFamily: 'monospace', fontSize: '0.85rem' }} />
                  <button type="button" className="btn btn-secondary" onClick={() => copyToClipboard(setup.secret)}>
                    <Copy size={14} />
                  </button>
                </div>
              </div>
              <div className="form-group mb-3">
                <label className="form-label">Códigos de Backup (guarde em local seguro)</label>
                <div className="backup-codes-grid">
                  {setup.backupCodes.map(code => (
                    <code key={code} className="backup-code">{code}</code>
                  ))}
                </div>
              </div>
              <form onSubmit={handleVerify}>
                <div className="form-group">
                  <label className="form-label">Código do App *</label>
                  <input required type="text" className="form-control" placeholder="000000"
                    value={token} onChange={e => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    maxLength={6} disabled={submitting} style={{ letterSpacing: '0.4rem', textAlign: 'center', fontSize: '1.25rem' }} />
                </div>
                <div className="flex gap-2 mt-3">
                  <button type="button" className="btn btn-secondary" onClick={() => setStep('idle')} disabled={submitting}>Cancelar</button>
                  <button type="submit" className="btn btn-primary" disabled={submitting || token.length < 6}>
                    {submitting ? 'Verificando...' : 'Confirmar e Ativar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {step === 'disable' && (
        <form onSubmit={handleDisable}>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Insira o código atual do seu app autenticador para desativar o 2FA.
          </p>
          <div className="form-group" style={{ maxWidth: '280px' }}>
            <label className="form-label">Código 2FA *</label>
            <input required type="text" className="form-control" placeholder="000000"
              value={token} onChange={e => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
              maxLength={6} disabled={submitting} style={{ letterSpacing: '0.4rem', textAlign: 'center' }} autoFocus />
          </div>
          <div className="flex gap-2 mt-3">
            <button type="button" className="btn btn-secondary" onClick={() => { setStep('idle'); setToken(''); }} disabled={submitting}>Cancelar</button>
            <button type="submit" className="btn btn-danger" disabled={submitting || token.length < 6}>
              {submitting ? 'Desativando...' : 'Desativar 2FA'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Página de Agendamento (personalização do link público) ────────────────────

const BP_HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const BP_DEFAULT_ACCENT = '#6d5dfc';

function bookingInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '🙂';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function BookingPageSection() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tenantName, setTenantName] = useState('');
  const [professionLabel, setProfessionLabel] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [welcomeMessage, setWelcomeMessage] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchApi<TenantProfile>('/api/profile');
        setTenantName(data.name || data.fullName || '');
        const bp = data.bookingPage ?? {};
        setProfessionLabel(bp.professionLabel ?? '');
        setDisplayName(bp.displayName ?? '');
        setAccentColor(bp.accentColor ?? '');
        setWelcomeMessage(bp.welcomeMessage ?? '');
      } catch {
        // silencioso: a seção apenas não pré-preenche
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    if (accentColor.trim() && !BP_HEX_COLOR.test(accentColor.trim())) {
      toast.error('Cor inválida. Use o formato #RRGGBB.');
      return;
    }
    setSaving(true);
    try {
      const bookingPage: BookingPageSettings = {
        professionLabel: professionLabel.trim() || null,
        displayName: displayName.trim() || null,
        accentColor: accentColor.trim() || null,
        welcomeMessage: welcomeMessage.trim() || null,
      };
      await fetchApi<TenantProfile>('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({ bookingPage }),
      });
      toast.success('Página de agendamento atualizada!');
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao salvar a página de agendamento.');
    } finally {
      setSaving(false);
    }
  };

  // Valores efetivos do preview (mesmos fallbacks da página pública).
  const previewName = displayName.trim() || tenantName || 'Seu nome';
  const previewRole = professionLabel.trim() || 'Psicoterapeuta';
  const previewWelcome = welcomeMessage.trim() || 'Informe seus dados para ver os horários disponíveis e confirmar sua sessão.';
  const previewAccent = BP_HEX_COLOR.test(accentColor.trim()) ? accentColor.trim() : BP_DEFAULT_ACCENT;

  if (loading) {
    return (
      <div className="card profile-card mt-4">
        <Skeleton width="220px" height="1.25rem" />
        <Skeleton width="100%" height="6rem" className="mt-3" />
      </div>
    );
  }

  return (
    <div className="card profile-card mt-4">
      <div className="flex items-center gap-2" style={{ marginBottom: '0.5rem' }}>
        <Palette size={20} style={{ color: 'var(--brand-primary)' }} />
        <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)' }}>Página de Agendamento</h2>
      </div>
      <p className="text-body" style={{ marginBottom: '1.25rem' }}>
        Personalize como o seu link público de agendamento aparece para os pacientes.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.5rem', alignItems: 'start' }}>
        {/* Campos */}
        <div className="profile-form">
          <div className="form-group">
            <label className="form-label">Rótulo da profissão</label>
            <input type="text" className="form-control" placeholder="Psicoterapeuta" maxLength={40}
              value={professionLabel} onChange={e => setProfessionLabel(e.target.value)} disabled={saving} />
          </div>

          <div className="form-group">
            <label className="form-label">Nome de exibição</label>
            <input type="text" className="form-control" placeholder={tenantName || 'Seu nome / consultório'} maxLength={60}
              value={displayName} onChange={e => setDisplayName(e.target.value)} disabled={saving} />
          </div>

          <div className="form-group">
            <label className="form-label">Cor de destaque</label>
            <div className="flex items-center gap-2">
              <input type="color" value={previewAccent} onChange={e => setAccentColor(e.target.value)} disabled={saving}
                style={{ width: '44px', height: '38px', padding: 0, border: '1px solid var(--border-color)', borderRadius: '8px', background: 'none', cursor: 'pointer' }} />
              <input type="text" className="form-control" placeholder="#6d5dfc" maxLength={7}
                value={accentColor} onChange={e => setAccentColor(e.target.value)} disabled={saving} style={{ maxWidth: '140px' }} />
              {accentColor.trim() && (
                <button type="button" className="btn btn-secondary" onClick={() => setAccentColor('')} disabled={saving}>Padrão</button>
              )}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Mensagem de boas-vindas</label>
            <textarea className="form-control" rows={3} maxLength={280}
              placeholder="Ex: Atendo ansiedade e luto, abordagem TCC. Será um prazer te receber."
              value={welcomeMessage} onChange={e => setWelcomeMessage(e.target.value)} disabled={saving}
              style={{ resize: 'vertical', minHeight: '76px' }} />
          </div>

          <div className="flex justify-end mt-4">
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
              <Save size={18} /> {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>

        {/* Preview ao vivo */}
        <div>
          <label className="form-label">Pré-visualização</label>
          <div style={{
            background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: '16px',
            padding: '1.5rem 1.25rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem'
          }}>
            <div style={{
              width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.4rem', fontWeight: 700, color: '#fff', background: previewAccent, boxShadow: `0 6px 20px -6px ${previewAccent}`
            }}>{bookingInitials(previewName)}</div>
            <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>Agende sua sessão com</span>
            <strong style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>{previewName}</strong>
            <span style={{
              fontSize: '0.72rem', fontWeight: 600, color: previewAccent,
              border: `1px solid ${previewAccent}55`, background: `${previewAccent}1a`,
              padding: '0.15rem 0.6rem', borderRadius: '999px'
            }}>{previewRole}</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>{previewWelcome}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Taxas de cartão (sugestão de líquido no modal de pagamento de grupo) ──────────

const CARD_INSTALLMENT_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

function CardFeeRatesSection() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Editado em % (string, ex: "3.50") — convertido pra basis points só ao salvar.
  const [ratesPercent, setRatesPercent] = useState<Record<number, string>>({});

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchApi<TenantProfile>('/api/profile');
        const rates = data.cardFeeRates ?? {};
        const initial: Record<number, string> = {};
        for (const n of CARD_INSTALLMENT_OPTIONS) {
          const bps = rates[String(n)];
          initial[n] = bps !== undefined ? (bps / 100).toFixed(2) : '';
        }
        setRatesPercent(initial);
      } catch {
        // silencioso: a seção fica vazia, sem sugestão configurada
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const cardFeeRates: CardFeeRates = {};
      for (const n of CARD_INSTALLMENT_OPTIONS) {
        const raw = (ratesPercent[n] ?? '').trim();
        if (raw === '') continue;
        const percent = parseFloat(raw);
        if (isNaN(percent) || percent < 0 || percent > 100) {
          toast.error(`Taxa inválida para ${n}x. Use um valor entre 0 e 100.`);
          setSaving(false);
          return;
        }
        cardFeeRates[String(n)] = Math.round(percent * 100); // % -> basis points
      }
      await fetchApi<TenantProfile>('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({ cardFeeRates }),
      });
      toast.success('Taxas de cartão atualizadas!');
    } catch (err) {
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao salvar as taxas de cartão.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="card profile-card mt-4">
        <Skeleton width="220px" height="1.25rem" />
        <Skeleton width="100%" height="4rem" className="mt-3" />
      </div>
    );
  }

  return (
    <div className="card profile-card mt-4">
      <div className="flex items-center gap-2" style={{ marginBottom: '0.5rem' }}>
        <CreditCard size={20} style={{ color: 'var(--brand-primary)' }} />
        <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)' }}>Taxas de Cartão</h2>
      </div>
      <p className="text-body" style={{ marginBottom: '1.25rem' }}>
        Configure a taxa da operadora por número de parcelas. Ao confirmar um pagamento de grupo no cartão de crédito,
        o sistema sugere o valor líquido com base nessa taxa — o valor final continua editável antes de confirmar.
        Deixe em branco as parcelas sem taxa configurada (nenhuma sugestão será feita para elas).
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.75rem' }}>
        {CARD_INSTALLMENT_OPTIONS.map(n => (
          <div key={n} className="form-group" style={{ margin: 0 }}>
            <label className="form-label">{n}x</label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                className="form-control"
                min="0"
                max="100"
                step="0.01"
                placeholder="—"
                value={ratesPercent[n] ?? ''}
                onChange={e => setRatesPercent(prev => ({ ...prev, [n]: e.target.value }))}
                disabled={saving}
              />
              <span className="text-small" style={{ color: 'var(--text-muted)' }}>%</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end mt-4">
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
          <Save size={18} /> {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  );
}
