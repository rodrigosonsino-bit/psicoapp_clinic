import { useState, useEffect, useCallback, useRef } from 'react';
import { Upload, Check, X, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { fetchApi } from '../services/api';
import type {
    BankStatementImportResult,
    BankStatementTransaction,
    BankStatementBatchResult,
    BankStatementEmailImport,
    Patient,
    PaginatedResponse
} from '../types/api';
import { formatCurrency } from '../utils/formatters';
import { useToast } from '../context/ToastContext';
import { SkeletonTable } from '../components/Skeleton';
import ErrorState from '../components/ErrorState';
import './BankReconciliation.css';

const CONFIDENCE_LABEL: Record<string, string> = {
    high: 'Alta confiança',
    medium: 'Confiança média',
    low: 'Confiança baixa',
    none: 'Sem sugestão'
};

const EMAIL_STATUS_LABEL: Record<BankStatementEmailImport['status'], string> = {
    processing: 'Processando',
    processed: 'Importado com sucesso',
    rejected_sender: 'Rejeitado — remetente não confere',
    rejected_auth: 'Rejeitado — autenticação (SPF/DKIM/DMARC) não confere',
    no_attachment: 'Sem anexo de extrato',
    error: 'Erro'
};

export default function BankReconciliation() {
    const [importResult, setImportResult] = useState<BankStatementImportResult | null>(null);
    const [transactions, setTransactions] = useState<BankStatementTransaction[]>([]);
    const [patients, setPatients] = useState<Patient[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'confirmed' | 'ignored'>('pending');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [rowOverrides, setRowOverrides] = useState<Record<string, { patientId: string; month: string }>>({});
    const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
    const [busyRowId, setBusyRowId] = useState<string | null>(null);
    const [showBatchConfirmSummary, setShowBatchConfirmSummary] = useState(false);
    const [batchRunning, setBatchRunning] = useState(false);
    const [emailImports, setEmailImports] = useState<BankStatementEmailImport[]>([]);
    const [showEmailImports, setShowEmailImports] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const toast = useToast();

    const loadPatients = useCallback(async () => {
        try {
            const res = await fetchApi<PaginatedResponse<Patient>>('/api/psychotherapy/patients?scope=individual&limit=100');
            setPatients(res.data || []);
        } catch (err) {
            console.error(err);
        }
    }, []);

    const loadTransactions = useCallback(async (importId: string, status: string) => {
        setLoading(true);
        setError(false);
        try {
            const query = status === 'all' ? '' : `?status=${status}`;
            const res = await fetchApi<{ data: BankStatementTransaction[] }>(
                `/api/psychotherapy/bank-statements/imports/${importId}/transactions${query}`
            );
            setTransactions(res.data || []);
        } catch (err) {
            console.error(err);
            setError(true);
            toast.error('Erro ao carregar transações do extrato.');
        } finally {
            setLoading(false);
        }
    }, [toast]);

    const loadEmailImports = useCallback(async () => {
        try {
            const res = await fetchApi<{ data: BankStatementEmailImport[] }>(
                '/api/psychotherapy/bank-statements/email-imports'
            );
            setEmailImports(res.data || []);
        } catch (err) {
            console.error(err);
        }
    }, []);

    useEffect(() => {
        loadPatients();
        loadEmailImports();
    }, [loadPatients, loadEmailImports]);

    // Recupera o último import ao abrir a tela — sem isso, um refresh de
    // página perderia o acesso à lista pendente de revisão.
    useEffect(() => {
        (async () => {
            try {
                const res = await fetchApi<{
                    data: { id: string; transaction_count: number; skipped_line_count: number; duplicate_fitid_count: number } | null
                }>('/api/psychotherapy/bank-statements/imports/latest');
                if (res.data) {
                    setImportResult({
                        importId: res.data.id,
                        transactionCount: res.data.transaction_count,
                        skippedLineCount: res.data.skipped_line_count,
                        duplicateFitidCount: res.data.duplicate_fitid_count
                    });
                }
            } catch (err) {
                console.error(err);
            }
        })();
    }, []);

    useEffect(() => {
        if (importResult) {
            loadTransactions(importResult.importId, statusFilter);
        }
    }, [importResult, statusFilter, loadTransactions]);

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await fetchApi<{ data: BankStatementImportResult }>(
                '/api/psychotherapy/bank-statements/import',
                { method: 'POST', body: formData }
            );

            setImportResult(res.data);
            setStatusFilter('pending');
            setRowOverrides({});
            setRowErrors({});

            const parts = [`${res.data.transactionCount} transações importadas`];
            if (res.data.skippedLineCount > 0) parts.push(`${res.data.skippedLineCount} linhas puladas (erro de leitura)`);
            if (res.data.duplicateFitidCount > 0) parts.push(`${res.data.duplicateFitidCount} já importadas antes`);
            toast.success(parts.join(' — '));
        } catch (err) {
            console.error(err);
            toast.error(err instanceof Error ? err.message : 'Erro ao importar extrato.');
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const getOverride = (tx: BankStatementTransaction) =>
        rowOverrides[tx.id] ?? {
            patientId: tx.suggested_patient_id ?? '',
            month: tx.suggested_month ?? tx.posted_at.slice(0, 7)
        };

    const setOverride = (id: string, patch: Partial<{ patientId: string; month: string }>) => {
        setRowOverrides(prev => ({
            ...prev,
            [id]: { ...getOverride(transactions.find(t => t.id === id)!), ...prev[id], ...patch }
        }));
    };

    const refreshCurrent = () => {
        if (importResult) loadTransactions(importResult.importId, statusFilter);
    };

    const handleConfirm = async (tx: BankStatementTransaction) => {
        const override = getOverride(tx);
        if (!override.patientId || !override.month) {
            setRowErrors(prev => ({ ...prev, [tx.id]: 'Selecione um paciente e um mês antes de confirmar.' }));
            return;
        }

        setBusyRowId(tx.id);
        setRowErrors(prev => ({ ...prev, [tx.id]: '' }));
        try {
            await fetchApi(`/api/psychotherapy/bank-statements/transactions/${tx.id}/confirm`, {
                method: 'POST',
                body: JSON.stringify({ patientId: override.patientId, month: override.month })
            });
            toast.success('Sessão confirmada.');
            refreshCurrent();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Erro ao confirmar.';
            setRowErrors(prev => ({ ...prev, [tx.id]: message }));
        } finally {
            setBusyRowId(null);
        }
    };

    const handleIgnore = async (tx: BankStatementTransaction) => {
        setBusyRowId(tx.id);
        try {
            await fetchApi(`/api/psychotherapy/bank-statements/transactions/${tx.id}/ignore`, { method: 'POST' });
            refreshCurrent();
        } catch (err) {
            setRowErrors(prev => ({ ...prev, [tx.id]: err instanceof Error ? err.message : 'Erro ao ignorar.' }));
        } finally {
            setBusyRowId(null);
        }
    };

    const highConfidencePending = transactions.filter(t => t.status === 'pending' && t.match_confidence === 'high');

    const handleConfirmAllHighConfidence = async () => {
        if (!importResult) return;
        setBatchRunning(true);
        try {
            const res = await fetchApi<{ data: BankStatementBatchResult }>(
                '/api/psychotherapy/bank-statements/transactions/confirm-batch',
                { method: 'POST', body: JSON.stringify({ ids: highConfidencePending.map(t => t.id) }) }
            );
            const { total, success } = res.data;
            if (success === total) {
                toast.success(`${success} de ${total} confirmadas com sucesso.`);
            } else {
                toast.error(`${success} de ${total} confirmadas — algumas falharam, revise a lista.`);
            }
            setShowBatchConfirmSummary(false);
            refreshCurrent();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Erro ao confirmar em lote.');
        } finally {
            setBatchRunning(false);
        }
    };

    return (
        <div className="bank-reconciliation-page animate-fade-in">
            <div className="page-header">
                <h1>Conciliação Bancária</h1>
                <p className="page-subtitle">
                    Importe o extrato CSV do Nubank — o app sugere o casamento com pacientes e sessões,
                    você confirma. Nada é gravado sem sua confirmação explícita.
                </p>
            </div>

            <div className="bank-reconciliation-upload">
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileSelect}
                    disabled={uploading}
                    id="bank-statement-file-input"
                    style={{ display: 'none' }}
                />
                <label htmlFor="bank-statement-file-input" className="btn btn-primary">
                    <Upload size={18} />
                    {uploading ? 'Importando...' : 'Importar extrato (.csv)'}
                </label>
                {importResult && (
                    <span className="bank-reconciliation-import-summary">
                        Último import: {importResult.transactionCount} transações
                        {importResult.skippedLineCount > 0 && `, ${importResult.skippedLineCount} puladas`}
                        {importResult.duplicateFitidCount > 0 && `, ${importResult.duplicateFitidCount} já existiam`}
                    </span>
                )}
            </div>

            {importResult && (
                <>
                    <div className="bank-reconciliation-toolbar">
                        <div className="bank-reconciliation-filters">
                            {(['pending', 'confirmed', 'ignored', 'all'] as const).map(s => (
                                <button
                                    key={s}
                                    className={`filter-chip ${statusFilter === s ? 'active' : ''}`}
                                    onClick={() => setStatusFilter(s)}
                                >
                                    {s === 'pending' ? 'Pendentes' : s === 'confirmed' ? 'Confirmadas' : s === 'ignored' ? 'Ignoradas' : 'Todas'}
                                </button>
                            ))}
                        </div>

                        {statusFilter === 'pending' && highConfidencePending.length > 0 && (
                            <button
                                className="btn btn-secondary"
                                onClick={() => setShowBatchConfirmSummary(true)}
                            >
                                Confirmar {highConfidencePending.length} de alta confiança
                            </button>
                        )}
                    </div>

                    {showBatchConfirmSummary && (
                        <div className="bank-reconciliation-batch-summary">
                            <p>
                                Confirmar <strong>{highConfidencePending.length}</strong> transações de alta confiança,
                                totalizando <strong>{formatCurrency(highConfidencePending.reduce((s, t) => s + t.amount_cents, 0))}</strong>?
                            </p>
                            <div className="bank-reconciliation-batch-actions">
                                <button className="btn btn-secondary" onClick={() => setShowBatchConfirmSummary(false)} disabled={batchRunning}>
                                    Cancelar
                                </button>
                                <button className="btn btn-primary" onClick={handleConfirmAllHighConfidence} disabled={batchRunning}>
                                    {batchRunning ? 'Confirmando...' : 'Confirmar todas'}
                                </button>
                            </div>
                        </div>
                    )}

                    {loading ? (
                        <SkeletonTable rows={5} />
                    ) : error ? (
                        <ErrorState onRetry={refreshCurrent} />
                    ) : transactions.length === 0 ? (
                        <p className="bank-reconciliation-empty">Nenhuma transação {statusFilter !== 'all' ? `com status "${statusFilter}"` : ''}.</p>
                    ) : (
                        <div className="bank-reconciliation-list">
                            {transactions.map(tx => {
                                const override = getOverride(tx);
                                const isExpanded = expandedId === tx.id;
                                const rowError = rowErrors[tx.id];
                                const isBusy = busyRowId === tx.id;

                                return (
                                    <div key={tx.id} className={`bank-reconciliation-row confidence-${tx.match_confidence}`}>
                                        <div className="bank-reconciliation-row-main">
                                            <div className="bank-reconciliation-row-date">
                                                {new Date(tx.posted_at).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
                                            </div>
                                            <div className="bank-reconciliation-row-amount">{formatCurrency(tx.amount_cents)}</div>
                                            <div className="bank-reconciliation-row-payer">
                                                {tx.payer_name_guess || <span className="text-muted">(sem nome identificado)</span>}
                                                <button
                                                    className="bank-reconciliation-expand-btn"
                                                    onClick={() => setExpandedId(isExpanded ? null : tx.id)}
                                                    title="Ver descrição completa"
                                                >
                                                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                </button>
                                            </div>
                                            <div className={`badge badge-confidence-${tx.match_confidence}`}>
                                                {CONFIDENCE_LABEL[tx.match_confidence]}
                                            </div>

                                            {tx.status === 'pending' && (
                                                <>
                                                    <select
                                                        value={override.patientId}
                                                        onChange={e => setOverride(tx.id, { patientId: e.target.value })}
                                                        className="bank-reconciliation-select"
                                                    >
                                                        <option value="">Selecione o paciente...</option>
                                                        {patients.map(p => (
                                                            <option key={p.id} value={p.id}>{p.name}</option>
                                                        ))}
                                                    </select>
                                                    <input
                                                        type="month"
                                                        value={override.month}
                                                        onChange={e => setOverride(tx.id, { month: e.target.value })}
                                                        className="bank-reconciliation-month-input"
                                                    />
                                                    <button
                                                        className="btn btn-icon btn-success"
                                                        onClick={() => handleConfirm(tx)}
                                                        disabled={isBusy}
                                                        title="Confirmar"
                                                    >
                                                        <Check size={16} />
                                                    </button>
                                                    <button
                                                        className="btn btn-icon btn-ghost"
                                                        onClick={() => handleIgnore(tx)}
                                                        disabled={isBusy}
                                                        title="Ignorar"
                                                    >
                                                        <X size={16} />
                                                    </button>
                                                </>
                                            )}

                                            {tx.status === 'confirmed' && (
                                                <span className="bank-reconciliation-confirmed-info">
                                                    ✅ {tx.confirmed_sessions} sessão(ões) em {tx.confirmed_month}
                                                </span>
                                            )}
                                            {tx.status === 'ignored' && (
                                                <span className="text-muted">Ignorada</span>
                                            )}
                                        </div>

                                        {tx.possible_pix_duplicate && (
                                            <div className="bank-reconciliation-warning">
                                                <AlertTriangle size={14} /> Possível duplicata de cobrança Pix — revise manualmente.
                                            </div>
                                        )}
                                        {rowError && (
                                            <div className="bank-reconciliation-warning error">
                                                <AlertTriangle size={14} /> {rowError}
                                            </div>
                                        )}
                                        {isExpanded && (
                                            <div className="bank-reconciliation-row-description">{tx.raw_description}</div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            )}

            {emailImports.length > 0 && (
                <div className="bank-reconciliation-email-imports">
                    <button
                        className="bank-reconciliation-email-imports-toggle"
                        onClick={() => setShowEmailImports(prev => !prev)}
                    >
                        {showEmailImports ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        E-mails do extrato automático ({emailImports.filter(e => e.status !== 'processed').length} com pendência/rejeição)
                    </button>

                    {showEmailImports && (
                        <div className="bank-reconciliation-email-imports-list">
                            {emailImports.map(e => (
                                <div key={e.id} className={`bank-reconciliation-email-import-row status-${e.status}`}>
                                    <span className="bank-reconciliation-email-import-status">
                                        {EMAIL_STATUS_LABEL[e.status]}
                                    </span>
                                    <span className="bank-reconciliation-email-import-sender">
                                        {e.sender_normalized || <span className="text-muted">(remetente desconhecido)</span>}
                                    </span>
                                    <span className="bank-reconciliation-email-import-date">
                                        {new Date(e.created_at).toLocaleString('pt-BR')}
                                    </span>
                                    {e.error_detail && (
                                        <span className="bank-reconciliation-email-import-detail">{e.error_detail}</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
