import React, { useEffect, useState, useCallback } from 'react';
import { fetchApi } from '../services/api';
import type { Expense, FixedExpense, PaginatedResponse } from '../types/api';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Trash2, Download, Plus, Edit2, Repeat } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import ConfirmDialog from '../components/ConfirmDialog';
import { SkeletonTable } from '../components/Skeleton';
import ErrorState from '../components/ErrorState';
import { formatCurrency } from '../utils/formatters';
import './Expenses.css';

type ExpenseCategory = 'rent' | 'taxes' | 'software' | 'marketing' | 'other';

export default function Expenses() {
  const [activeTab, setActiveTab] = useState<'avulsas' | 'fixas'>('avulsas');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [fixedExpenses, setFixedExpenses] = useState<FixedExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  
  // Modals state
  const [showModal, setShowModal] = useState(false);
  const [currentExpense, setCurrentExpense] = useState<Partial<Expense> | null>(null);

  const [showFixedModal, setShowFixedModal] = useState(false);
  const [currentFixedExpense, setCurrentFixedExpense] = useState<Partial<FixedExpense> | null>(null);

  // Confirmation state
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; id: string | null }>({
    open: false,
    id: null,
  });

  const [confirmDeleteFixed, setConfirmDeleteFixed] = useState<{ open: boolean; id: string | null }>({
    open: false,
    id: null,
  });

  const toast = useToast();

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(false);
      if (activeTab === 'avulsas') {
        const data = await fetchApi<PaginatedResponse<Expense>>('/api/psychotherapy/expenses');
        setExpenses(data.data || []);
      } else {
        const data = await fetchApi<FixedExpense[]>('/api/psychotherapy/fixed-expenses');
        setFixedExpenses(data || []);
      }
    } catch (err) {
      console.error(err);
      setError(true);
      toast.error('Erro ao carregar despesas.');
    } finally {
      setLoading(false);
    }
  }, [activeTab, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openModal = (expense: Partial<Expense> | null = null) => {
    setCurrentExpense(expense);
    setShowModal(true);
  };

  const openFixedModal = (fixedExpense: Partial<FixedExpense> | null = null) => {
    setCurrentFixedExpense(fixedExpense);
    setShowFixedModal(true);
  };

  const askDeleteExpense = (id: string) => {
    setConfirmDelete({ open: true, id });
  };

  const askDeleteFixedExpense = (id: string) => {
    setConfirmDeleteFixed({ open: true, id });
  };

  const handleDelete = async () => {
    const id = confirmDelete.id;
    if (!id) return;

    try {
      await fetchApi(`/api/psychotherapy/expenses/${id}`, { method: 'DELETE' });
      toast.success('Despesa excluída com sucesso.');
      await loadData();
    } catch (err) {
      console.error(err);
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao excluir despesa.');
    } finally {
      setConfirmDelete({ open: false, id: null });
    }
  };

  const handleDeleteFixed = async () => {
    const id = confirmDeleteFixed.id;
    if (!id) return;

    try {
      await fetchApi(`/api/psychotherapy/fixed-expenses/${id}`, { method: 'DELETE' });
      toast.success('Despesa fixa excluída com sucesso.');
      await loadData();
    } catch (err) {
      console.error(err);
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao excluir despesa fixa.');
    } finally {
      setConfirmDeleteFixed({ open: false, id: null });
    }
  };

  const handleToggleFixed = async (id: string, currentActive: boolean) => {
    try {
      const updated = await fetchApi<FixedExpense>(`/api/psychotherapy/fixed-expenses/${id}/toggle`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !currentActive })
      });
      setFixedExpenses(prev => prev.map(fe => fe.id === id ? updated : fe));
      toast.success(updated.active ? 'Despesa fixa ativada.' : 'Despesa fixa desativada.');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao alterar status da despesa fixa.');
    }
  };

  const translateCategory = (cat: ExpenseCategory) => {
    const map: Record<ExpenseCategory, string> = {
      'rent': 'Aluguel / Imóvel',
      'taxes': 'Impostos / Taxas',
      'software': 'Software / Apps',
      'marketing': 'Marketing',
      'other': 'Outros'
    };
    return map[cat] || cat;
  };

  const handleExport = async () => {
    try {
      const blob = await fetchApi<Blob>('/api/psychotherapy/export/expenses', {
        headers: { Accept: 'text/csv' },
        responseType: 'blob'
      });
      const url = URL.createObjectURL(new Blob([blob], { type: 'text/csv' }));
      Object.assign(document.createElement('a'), { href: url, download: 'despesas.csv' }).click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao exportar despesas.');
    }
  };

  return (
    <div className="expenses-container animate-fade-in">
      <div className="expenses-header flex justify-between items-center mb-6">
        <h1 className="text-h1">Despesas do Consultório</h1>
        <div className="flex gap-2">
          {activeTab === 'avulsas' && (
            <button
              onClick={handleExport}
              className="btn btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none' }}
            >
              <Download size={16} /> CSV
            </button>
          )}
          <button 
            className="btn btn-primary" 
            onClick={() => activeTab === 'avulsas' ? openModal() : openFixedModal()}
          >
            <Plus size={18} /> {activeTab === 'avulsas' ? 'Nova Despesa' : 'Nova Despesa Fixa'}
          </button>
        </div>
      </div>

      <div className="tabs-container">
        <button
          onClick={() => setActiveTab('avulsas')}
          className={`tab-button ${activeTab === 'avulsas' ? 'active' : ''}`}
        >
          Despesas Avulsas
        </button>
        <button
          onClick={() => setActiveTab('fixas')}
          className={`tab-button ${activeTab === 'fixas' ? 'active' : ''}`}
        >
          Despesas Fixas (Templates)
        </button>
      </div>

      {loading ? (
        <SkeletonTable rows={5} cols={4} />
      ) : error ? (
        <ErrorState
          title={activeTab === 'avulsas' ? 'Erro ao carregar despesas' : 'Erro ao carregar despesas fixas'}
          message="Não foi possível recuperar as informações do banco de dados."
          onRetry={loadData}
        />
      ) : (
        <div className="expenses-list">
          {activeTab === 'avulsas' ? (
            expenses.length === 0 ? (
              <div className="empty-state">Nenhuma despesa registrada.</div>
            ) : (
              expenses.map(exp => (
                <div key={exp.id} className="expense-item animate-fade-in">
                  <div className="expense-info">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="expense-desc">{exp.description}</span>
                      {exp.fixedExpenseId && (
                        <span className="badge" title={`Gerada via template fixo (Referência: ${exp.referenceMonth})`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', backgroundColor: 'rgba(168, 85, 247, 0.1)', color: '#a855f7' }}>
                          <Repeat size={12} /> Recorrente
                        </span>
                      )}
                    </div>
                    <span className="expense-date">
                      {format(new Date(exp.date), "dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}
                    </span>
                  </div>
                  <div className="expense-amount-cat">
                    <span className="badge badge-info">{translateCategory(exp.category)}</span>
                    <span className="expense-amount">- {formatCurrency(exp.amountCents)}</span>
                    <div className="flex gap-2">
                      <button className="btn-icon" onClick={() => openModal(exp)} disabled={!!exp.fixedExpenseId} title={exp.fixedExpenseId ? 'Despesas geradas automaticamente não podem ser editadas' : undefined}>
                        <Edit2 size={16} />
                      </button>
                      <button className="btn-icon btn-danger" onClick={() => askDeleteExpense(exp.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )
          ) : (
            fixedExpenses.length === 0 ? (
              <div className="empty-state">Nenhuma despesa fixa registrada.</div>
            ) : (
              fixedExpenses.map(fe => (
                <div key={fe.id} className="expense-item animate-fade-in">
                  <div className="expense-info">
                    <span className="expense-desc">{fe.description}</span>
                    <span className="expense-date">
                      Todo dia {fe.dayOfMonth} | Início: {format(new Date(fe.startDate + 'T00:00:00'), "MMMM 'de' yyyy", { locale: ptBR })}
                      {fe.endDate && ` | Encerramento: ${format(new Date(fe.endDate + 'T00:00:00'), "MMMM 'de' yyyy", { locale: ptBR })}`}
                    </span>
                  </div>
                  <div className="expense-amount-cat">
                    <span className="badge badge-info">{translateCategory((fe.category || 'other') as ExpenseCategory)}</span>
                    <span className="expense-amount">- {formatCurrency(fe.amountCents)}</span>
                    
                    {/* Status Toggle Switch */}
                    <label className="switch" title={fe.active ? 'Ativo' : 'Inativo'} style={{ marginLeft: '8px' }}>
                      <input
                        type="checkbox"
                        checked={fe.active}
                        onChange={() => handleToggleFixed(fe.id, fe.active)}
                      />
                      <span className="slider"></span>
                    </label>

                    <div className="flex gap-2">
                      <button className="btn-icon" onClick={() => openFixedModal(fe)}>
                        <Edit2 size={16} />
                      </button>
                      <button className="btn-icon btn-danger" onClick={() => askDeleteFixedExpense(fe.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDelete.open}
        title="Excluir Despesa"
        message="Esta ação irá remover permanentemente esta despesa do banco de dados. Tem certeza de que deseja prosseguir?"
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete({ open: false, id: null })}
      />

      <ConfirmDialog
        isOpen={confirmDeleteFixed.open}
        title="Excluir Despesa Fixa"
        message="Esta ação irá remover permanentemente o template desta despesa fixa. Lançamentos reais passados gerados a partir dela serão mantidos. Deseja prosseguir?"
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        variant="danger"
        onConfirm={handleDeleteFixed}
        onCancel={() => setConfirmDeleteFixed({ open: false, id: null })}
      />

      {showModal && (
        <ExpenseModal
          expense={currentExpense}
          onClose={() => setShowModal(false)}
          onSave={() => loadData()}
        />
      )}

      {showFixedModal && (
        <FixedExpenseModal
          fixedExpense={currentFixedExpense}
          onClose={() => setShowFixedModal(false)}
          onSave={() => loadData()}
        />
      )}
    </div>
  );
}

// ── ExpenseModal ──────────────────────────────────────────────────────────────

interface ExpenseModalProps {
  expense: Partial<Expense> | null;
  onClose: () => void;
  onSave: () => void;
}

function ExpenseModal({ expense, onClose, onSave }: ExpenseModalProps) {
  const getLocalDatetimeString = (isoString?: string) => {
    const d = isoString ? new Date(isoString) : new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().substring(0, 16);
  };

  const [formData, setFormData] = useState({
    id: expense?.id,
    date: getLocalDatetimeString(expense?.date),
    amount: expense?.amountCents ? String(expense.amountCents / 100) : '',
    description: expense?.description || '',
    category: (expense?.category || 'other') as ExpenseCategory
  });

  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      toast.error('O valor inserido é inválido.');
      return;
    }
    try {
      setSubmitting(true);
      await fetchApi('/api/psychotherapy/expenses', {
        method: 'POST',
        body: JSON.stringify({
          id: formData.id,
          date: new Date(formData.date).toISOString(),
          amountCents: Math.round(parseFloat(formData.amount) * 100),
          description: formData.description,
          category: formData.category
        })
      });
      toast.success(expense?.id ? 'Despesa atualizada com sucesso.' : 'Despesa registrada com sucesso.');
      onSave();
      onClose();
    } catch (err) {
      console.error(err);
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao salvar despesa.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content animate-fade-in" style={{ maxWidth: '500px' }}>
        <h2 className="text-h2 mb-4">{expense?.id ? 'Editar Despesa' : 'Nova Despesa'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Data e Hora *</label>
            <input 
              type="datetime-local" 
              required 
              value={formData.date} 
              onChange={e => setFormData({ ...formData, date: e.target.value })} 
              className="form-control" 
              disabled={submitting}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Valor (R$) *</label>
            <input 
              type="number" 
              step="0.01" 
              min="0.01" 
              required 
              value={formData.amount} 
              onChange={e => setFormData({ ...formData, amount: e.target.value })} 
              className="form-control" 
              placeholder="Ex: 150.00" 
              disabled={submitting}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Categoria *</label>
            <select 
              required 
              value={formData.category} 
              onChange={e => setFormData({ ...formData, category: e.target.value as ExpenseCategory })} 
              className="form-control"
              disabled={submitting}
            >
              <option value="rent">Aluguel / Imóvel</option>
              <option value="taxes">Impostos / Taxas</option>
              <option value="software">Software / Apps</option>
              <option value="marketing">Marketing</option>
              <option value="other">Outros</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Descrição *</label>
            <input 
              type="text" 
              required 
              value={formData.description} 
              onChange={e => setFormData({ ...formData, description: e.target.value })} 
              className="form-control" 
              placeholder="Ex: Aluguel da sala" 
              disabled={submitting}
            />
          </div>

          <div className="flex justify-end gap-2 mt-6">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── FixedExpenseModal ─────────────────────────────────────────────────────────

interface FixedExpenseModalProps {
  fixedExpense: Partial<FixedExpense> | null;
  onClose: () => void;
  onSave: () => void;
}

function FixedExpenseModal({ fixedExpense, onClose, onSave }: FixedExpenseModalProps) {
  const [formData, setFormData] = useState({
    id: fixedExpense?.id,
    description: fixedExpense?.description || '',
    amount: fixedExpense?.amountCents ? String(fixedExpense.amountCents / 100) : '',
    dayOfMonth: fixedExpense?.dayOfMonth ? String(fixedExpense.dayOfMonth) : '5',
    category: fixedExpense?.category || 'rent',
    startDate: fixedExpense?.startDate || new Date().toISOString().substring(0, 10),
    endDate: fixedExpense?.endDate || '',
    active: fixedExpense?.active !== undefined ? fixedExpense.active : true
  });

  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      toast.error('O valor inserido é inválido.');
      return;
    }
    const dayNum = parseInt(formData.dayOfMonth, 10);
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 28) {
      toast.error('O dia de vencimento deve estar entre 1 e 28.');
      return;
    }
    try {
      setSubmitting(true);
      await fetchApi('/api/psychotherapy/fixed-expenses', {
        method: 'POST',
        body: JSON.stringify({
          id: formData.id,
          description: formData.description,
          amountCents: Math.round(parseFloat(formData.amount) * 100),
          dayOfMonth: dayNum,
          category: formData.category,
          startDate: formData.startDate,
          endDate: formData.endDate || null,
          active: formData.active
        })
      });
      toast.success(fixedExpense?.id ? 'Despesa fixa atualizada com sucesso.' : 'Despesa fixa registrada com sucesso.');
      onSave();
      onClose();
    } catch (err) {
      console.error(err);
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao salvar despesa fixa.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content animate-fade-in" style={{ maxWidth: '500px' }}>
        <h2 className="text-h2 mb-4">{fixedExpense?.id ? 'Editar Despesa Fixa' : 'Nova Despesa Fixa'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Descrição *</label>
            <input 
              type="text" 
              required 
              value={formData.description} 
              onChange={e => setFormData({ ...formData, description: e.target.value })} 
              className="form-control" 
              placeholder="Ex: Aluguel do consultório" 
              disabled={submitting}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Valor (R$) *</label>
            <input 
              type="number" 
              step="0.01" 
              min="0.01" 
              required 
              value={formData.amount} 
              onChange={e => setFormData({ ...formData, amount: e.target.value })} 
              className="form-control" 
              placeholder="Ex: 2000.00" 
              disabled={submitting}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Dia do Vencimento (1 a 28) *</label>
            <select
              required
              value={formData.dayOfMonth}
              onChange={e => setFormData({ ...formData, dayOfMonth: e.target.value })}
              className="form-control"
              disabled={submitting}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map(day => (
                <option key={day} value={day}>Todo dia {day}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Categoria *</label>
            <select 
              required 
              value={formData.category} 
              onChange={e => setFormData({ ...formData, category: e.target.value })} 
              className="form-control"
              disabled={submitting}
            >
              <option value="rent">Aluguel / Imóvel</option>
              <option value="taxes">Impostos / Taxas</option>
              <option value="software">Software / Apps</option>
              <option value="marketing">Marketing</option>
              <option value="other">Outros</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Mês de Início (Primeira cobrança) *</label>
            <input 
              type="date" 
              required 
              value={formData.startDate} 
              onChange={e => setFormData({ ...formData, startDate: e.target.value })} 
              className="form-control" 
              disabled={submitting}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Mês de Término (Opcional)</label>
            <input 
              type="date" 
              value={formData.endDate} 
              onChange={e => setFormData({ ...formData, endDate: e.target.value })} 
              className="form-control" 
              placeholder="Sem data de encerramento"
              disabled={submitting}
            />
          </div>

          <div className="flex justify-end gap-2 mt-6">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
