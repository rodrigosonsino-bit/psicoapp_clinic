import { useState, useEffect, useCallback, useMemo } from 'react';
import { format } from 'date-fns';
import { TrendingUp, TrendingDown, DollarSign, AlertCircle, User, X } from 'lucide-react';
import { fetchApi } from '../services/api';
import type { DashboardAnalytics, Appointment, Patient, PaginatedResponse, PendingDetails } from '../types/api';
import { formatCurrency, translateAppointmentStatus } from '../utils/formatters';
import Skeleton, { SkeletonCard } from '../components/Skeleton';
import { startOfDay, endOfDay } from 'date-fns';
import ErrorState from '../components/ErrorState';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import './Dashboard.css';

export default function Dashboard() {
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [todayAppointments, setTodayAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [pendingDetails, setPendingDetails] = useState<PendingDetails | null>(null);
  const [loadingPendingDetails, setLoadingPendingDetails] = useState(false);
  const [pendingDetailsError, setPendingDetailsError] = useState(false);
  const currentMonth = format(new Date(), 'yyyy-MM');

  const openPendingDetails = useCallback(async () => {
    setShowPendingModal(true);
    setLoadingPendingDetails(true);
    setPendingDetailsError(false);
    try {
      const data = await fetchApi<PendingDetails>(`/api/psychotherapy/analytics/pending-details?month=${currentMonth}`);
      setPendingDetails(data);
    } catch (err) {
      console.error('Erro ao carregar detalhamento de inadimplência', err);
      setPendingDetailsError(true);
    } finally {
      setLoadingPendingDetails(false);
    }
  }, [currentMonth]);

  const loadAnalytics = useCallback(async () => {
    try {
      setLoading(true);
      setError(false);

      const start = startOfDay(new Date()).toISOString();
      const end = endOfDay(new Date()).toISOString();

      const [data, apptRes, patRes] = await Promise.all([
        fetchApi<DashboardAnalytics>(`/api/psychotherapy/analytics/dashboard?month=${currentMonth}`),
        fetchApi<PaginatedResponse<Appointment>>(`/api/psychotherapy/appointments?start=${start}&end=${end}&limit=100`),
        fetchApi<PaginatedResponse<Patient>>('/api/psychotherapy/patients?limit=100')
      ]);

      setAnalytics(data);
      
      // Filter out canceled/no_show to focus on active schedule? Or show them crossed out? Let's show all and style by status.
      // Sort by time
      const sortedAppts = apptRes.data.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
      setTodayAppointments(sortedAppts);
      setPatients(patRes.data);
    } catch (err) {
      console.error('Erro ao carregar analytics', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [currentMonth]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  const chartData = useMemo(() => {
    if (!analytics?.sixMonthsTrend) return [];
    const sorted = [...analytics.sixMonthsTrend].sort((a, b) => a.month.localeCompare(b.month));
    
    return sorted.map(item => ({
      name: item.month,
      Receitas: item.revenueCents / 100,
      Despesas: item.expensesCents / 100
    }));
  }, [analytics?.sixMonthsTrend]);

  if (loading) {
    return (
      <div className="dashboard animate-fade-in">
        <div className="dashboard-header">
          <Skeleton width="180px" height="2.25rem" />
          <Skeleton width="220px" height="1.25rem" className="mt-2" />
        </div>

        <div className="dashboard-grid">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>

        <div className="chart-section mt-4">
          <Skeleton width="350px" height="1.75rem" className="mb-4" />
          <Skeleton width="100%" height="400px" />
        </div>
      </div>
    );
  }

  if (error || !analytics) {
    return (
      <div className="dashboard animate-fade-in">
        <div className="dashboard-header">
          <h1 className="text-h1">Visão Geral</h1>
          <p className="text-body">Mês de referência: {currentMonth}</p>
        </div>
        <ErrorState
          title="Erro ao carregar Painel Financeiro"
          message="Não foi possível estabelecer contato com o servidor para obter dados consolidados."
          onRetry={loadAnalytics}
        />
      </div>
    );
  }

  const { currentMonth: cm } = analytics;

  return (
    <div className="dashboard animate-fade-in">
      <div className="dashboard-header">
        <h1 className="text-h1">Visão Geral</h1>
        <p className="text-body">Mês de referência: {currentMonth}</p>
      </div>

      <div className="dashboard-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--status-success)' }}>
            <TrendingUp size={28} />
          </div>
          <div className="stat-details">
            <h3>Receitas (Pagas)</h3>
            <p className="stat-value text-success">{formatCurrency(cm.revenueCents)}</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(16, 185, 129, 0.06)', color: 'var(--status-success)' }}>
            <User size={28} />
          </div>
          <div className="stat-details">
            <h3>Sessões Individuais</h3>
            <p className="stat-value text-success">{formatCurrency(cm.sessionRevenueCents)}</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--status-danger)' }}>
            <TrendingDown size={28} />
          </div>
          <div className="stat-details">
            <h3>Despesas</h3>
            <p className="stat-value text-danger">{formatCurrency(cm.expensesCents)}</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: 'var(--status-info)' }}>
            <DollarSign size={28} />
          </div>
          <div className="stat-details">
            <h3>Lucro Líquido</h3>
            <p className="stat-value text-info">{formatCurrency(cm.netIncomeCents)}</p>
          </div>
        </div>

        <div
          className="stat-card"
          onClick={openPendingDetails}
          style={{ cursor: 'pointer' }}
          title="Clique para ver o detalhamento por paciente"
        >
          <div className="stat-icon" style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', color: 'var(--status-warning)' }}>
            <AlertCircle size={28} />
          </div>
          <div className="stat-details">
            <h3>Inadimplência</h3>
            <p className="stat-value text-warning">{formatCurrency(cm.pendingCents)}</p>
          </div>
        </div>
      </div>

      {showPendingModal && (
        <div className="modal-overlay" onClick={() => setShowPendingModal(false)}>
          <div
            className="modal-content animate-fade-in"
            style={{ maxWidth: '640px', maxHeight: '85vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-h2" style={{ margin: 0 }}>Detalhamento da Inadimplência</h2>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setShowPendingModal(false)}
                aria-label="Fechar"
              >
                <X size={20} />
              </button>
            </div>

            {loadingPendingDetails ? (
              <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}>
                <p>Carregando...</p>
              </div>
            ) : pendingDetailsError ? (
              <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--status-danger)' }}>
                <p>Não foi possível carregar o detalhamento. Tente novamente.</p>
              </div>
            ) : !pendingDetails || (pendingDetails.individualPatients.length === 0 && pendingDetails.groupCharges.length === 0) ? (
              <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}>
                <p>Nenhuma inadimplência no mês corrente. 🎉</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {pendingDetails.individualPatients.map(p => (
                  <div key={p.patientId} className="card" style={{ padding: '1rem' }}>
                    <div className="flex justify-between items-center mb-2">
                      <strong>{p.patientName}</strong>
                      <span className="text-warning" style={{ fontWeight: 700 }}>{formatCurrency(p.pendingAmountCents)}</span>
                    </div>
                    <div className="text-small mb-2" style={{ color: 'var(--text-muted)' }}>
                      {p.paymentType === 'monthly' ? 'Mensal' : 'Por Sessão'}
                    </div>
                    {p.sessions.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                        {p.sessions.map(s => {
                          const isFalta = s.status !== 'attended';
                          const label = format(new Date(s.date), 'dd/MM');
                          const badgeClass = isFalta ? 'badge-info' : s.covered ? 'badge-success' : 'badge-warning';
                          const suffix = isFalta ? ' (Falta)' : s.covered ? ' (Paga)' : ' (Pendente)';
                          return (
                            <span key={s.id} className={`badge ${badgeClass}`} style={{ fontSize: '0.7rem' }}>
                              {label}{suffix}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}

                {pendingDetails.groupCharges.length > 0 && (
                  <div>
                    <h3 className="text-h3" style={{ marginBottom: '0.5rem' }}>Grupos Terapêuticos</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {pendingDetails.groupCharges.map(g => (
                        <div key={g.groupPaymentId} className="card" style={{ padding: '0.75rem 1rem' }}>
                          <div className="flex justify-between items-center">
                            <div>
                              <strong>{g.memberName || g.groupName}</strong>
                              <div className="text-small" style={{ color: 'var(--text-muted)' }}>
                                {g.groupName}{g.dueDate ? ` · venceu em ${format(new Date(g.dueDate), 'dd/MM/yyyy')}` : ''}
                              </div>
                            </div>
                            <span className="text-warning" style={{ fontWeight: 700 }}>{formatCurrency(g.amountCents)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="dashboard-grid mt-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))' }}>
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-h3" style={{ margin: 0 }}>Sessões de Hoje</h2>
            <span className="badge badge-primary">{todayAppointments.length}</span>
          </div>

          {todayAppointments.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}>
              <p>Nenhuma sessão agendada para hoje.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {todayAppointments.map(appt => {
                const patName = patients.find(p => p.id === appt.patientId)?.name || 'Paciente desconhecido';
                const time = format(new Date(appt.scheduledAt), 'HH:mm');
                
                const isCanceledOrNoShow = appt.status === 'canceled' || appt.status === 'no_show';
                const statusColor = isCanceledOrNoShow ? 'var(--text-muted)' : 'var(--text-primary)';
                const statusBg = 'var(--bg-surface)';
                const borderLeft = isCanceledOrNoShow
                  ? '4px solid var(--status-danger)'
                  : appt.status === 'attended'
                    ? '4px solid var(--status-success)'
                    : appt.status === 'confirmed'
                      ? '4px solid var(--status-info)'
                      : '4px solid var(--status-warning)';

                return (
                  <div key={appt.id} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.75rem 1rem',
                    backgroundColor: statusBg,
                    border: '1px solid var(--border-color)',
                    borderLeft,
                    borderRadius: 'var(--radius-md)',
                    color: statusColor,
                    opacity: (appt.status === 'canceled' || appt.status === 'no_show') ? 0.6 : 1
                  }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{time}</div>
                      <div style={{ fontSize: '0.875rem' }}>{patName}</div>
                    </div>
                    <div>
                      <span className="badge" style={{ fontSize: '0.7rem' }}>
                        {translateAppointmentStatus(appt.status)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="text-h3 mb-4">Evolução Financeira (Últimos 6 meses)</h2>
        <div style={{ width: '100%', height: 400 }}>
          <ResponsiveContainer>
            <BarChart
              data={chartData}
              margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} dy={10} />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: '#64748b' }}
                tickFormatter={(value) => `R$ ${value}`} 
              />
              <Tooltip 
                formatter={(value: unknown) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0)}
                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                contentStyle={{ 
                  backgroundColor: 'var(--bg-surface)', 
                  border: '1px solid var(--border-color)', 
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-primary)'
                }}
              />
              <Legend wrapperStyle={{ paddingTop: '20px' }} />
              <Bar dataKey="Receitas" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={50} />
              <Bar dataKey="Despesas" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={50} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        </div>
      </div>
    </div>
  );
}
