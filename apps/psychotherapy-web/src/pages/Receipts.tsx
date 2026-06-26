import React, { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { Printer, Plus, Download } from 'lucide-react';
import { fetchApi } from '../services/api';
import type { Receipt, Patient, TenantProfile, PaginatedResponse } from '../types/api';
import { useToast } from '../context/ToastContext';
import { SkeletonTable } from '../components/Skeleton';
import ErrorState from '../components/ErrorState';
import { formatCurrency } from '../utils/formatters';

export default function Receipts() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [profile, setProfile] = useState<TenantProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const toast = useToast();

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(false);
      const [recRes, patRes, profRes] = await Promise.all([
        fetchApi<Receipt[]>('/api/psychotherapy/receipts'),
        fetchApi<PaginatedResponse<Patient>>('/api/psychotherapy/patients'),
        fetchApi<TenantProfile>('/api/profile')
      ]);
      setReceipts(recRes);
      setPatients(patRes.data || []);
      setProfile(profRes);
    } catch (err) {
      console.error(err);
      setError(true);
      toast.error('Erro ao carregar recibos ou perfil.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleExport = async () => {
    try {
      const blob = await fetchApi<Blob>('/api/psychotherapy/export/receipts', {
        headers: { Accept: 'text/csv' },
        responseType: 'blob'
      });
      const url = URL.createObjectURL(new Blob([blob], { type: 'text/csv' }));
      Object.assign(document.createElement('a'), { href: url, download: 'recibos.csv' }).click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao exportar recibos.');
    }
  };

  const handlePrint = async (receipt: Receipt) => {
    if (!profile) {
      toast.error('Perfil do psicólogo não carregado. Por favor, preencha seus dados na aba "Meu Perfil" primeiro.');
      return;
    }
    
    const patient = patients.find(p => p.id === receipt.patientId);
    if (!patient) {
      toast.error('Paciente não encontrado.');
      return;
    }

    const { jsPDF } = await import('jspdf');

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });
    
    const primaryColor = { r: 109, g: 93, b: 252 };
    const darkSlate = { r: 15, g: 23, b: 42 };
    const secondarySlate = { r: 71, g: 85, b: 105 };
    const lightBg = { r: 248, g: 250, b: 252 };
    const borderColor = { r: 226, g: 232, b: 240 };

    // --- 1. TOP BRANDING BAND ---
    doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
    doc.rect(0, 0, 210, 8, 'F');

    // --- 2. HEADER ---
    doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('RECIBO DE MENTORIA E DESENVOLVIMENTO PESSOAL', 20, 25);

    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(secondarySlate.r, secondarySlate.g, secondarySlate.b);
    doc.text(`Documento gerado automaticamente pelo PsicoApp`, 20, 30);

    // Document Number and Value Box
    doc.setFillColor(lightBg.r, lightBg.g, lightBg.b);
    doc.setDrawColor(borderColor.r, borderColor.g, borderColor.b);
    doc.setLineWidth(0.3);
    doc.rect(130, 16, 60, 20, 'FD');

    doc.setTextColor(secondarySlate.r, secondarySlate.g, secondarySlate.b);
    doc.setFontSize(8);
    doc.text(`NÚMERO DO RECIBO`, 135, 21);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(darkSlate.r, darkSlate.g, darkSlate.b);
    doc.text(`#${String(receipt.receiptNumber).padStart(6, '0')}`, 135, 25);

    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(secondarySlate.r, secondarySlate.g, secondarySlate.b);
    doc.text(`VALOR TOTAL`, 135, 29);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
    doc.text(formatCurrency(receipt.amountCents), 135, 33);

    // Decorative separator line
    doc.setDrawColor(borderColor.r, borderColor.g, borderColor.b);
    doc.setLineWidth(0.3);
    doc.line(20, 40, 190, 40);

    // --- 3. EMITENTE (PROFISSIONAL) PANEL ---
    doc.setFillColor(lightBg.r, lightBg.g, lightBg.b);
    doc.rect(20, 46, 170, 36, 'F');
    doc.setDrawColor(borderColor.r, borderColor.g, borderColor.b);
    doc.rect(20, 46, 170, 36, 'S');

    doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('EMITENTE / PROFISSIONAL', 25, 52);

    doc.setTextColor(darkSlate.r, darkSlate.g, darkSlate.b);
    doc.setFontSize(9);
    doc.setFont('Helvetica', 'bold');
    doc.text(`Nome:`, 25, 59);
    doc.setFont('Helvetica', 'normal');
    doc.text(`${profile.fullName || 'Não informado'}`, 55, 59);

    doc.setFont('Helvetica', 'bold');
    doc.text(`CPF/CNPJ:`, 25, 64);
    doc.setFont('Helvetica', 'normal');
    doc.text(`${profile.document || 'Não informado'}`, 55, 64);

    doc.setFont('Helvetica', 'bold');
    doc.text(`CRP / Registro:`, 25, 69);
    doc.setFont('Helvetica', 'normal');
    doc.text(`${profile.professionalId || 'Não informado'}`, 55, 69);

    doc.setFont('Helvetica', 'bold');
    doc.text(`Endereço:`, 25, 74);
    doc.setFont('Helvetica', 'normal');
    doc.text(`${profile.address || 'Não informado'}`, 55, 74);

    // --- 4. PACIENTE PANEL ---
    doc.setFillColor(lightBg.r, lightBg.g, lightBg.b);
    doc.rect(20, 88, 170, 22, 'F');
    doc.rect(20, 88, 170, 22, 'S');

    doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('PACIENTE', 25, 94);

    const displayName = patient.fullName || patient.name;

    doc.setTextColor(darkSlate.r, darkSlate.g, darkSlate.b);
    doc.setFontSize(9);
    doc.setFont('Helvetica', 'bold');
    doc.text(`Nome:`, 25, 101);
    doc.setFont('Helvetica', 'normal');
    doc.text(`${displayName}`, 55, 101);

    doc.setFont('Helvetica', 'bold');
    doc.text(`CPF:`, 25, 106);
    doc.setFont('Helvetica', 'normal');
    doc.text(`${patient.document || 'Não informado'}`, 55, 106);

    // --- 5. DECLARATION TEXT ---
    doc.setTextColor(darkSlate.r, darkSlate.g, darkSlate.b);
    doc.setFontSize(10);
    doc.setFont('Helvetica', 'normal');
    
    const statementText = `Declaro para os devidos fins que recebi de ${displayName}, inscrito no CPF sob o nº ${patient.document || '___________________'}, a importância de ${formatCurrency(receipt.amountCents)} referente a mentoria e desenvolvimento pessoal correspondente a: "${receipt.description}".`;
    
    // Split text automatically to fit width (170mm)
    const splitText = doc.splitTextToSize(statementText, 170);
    doc.text(splitText, 20, 122);

    // Date
    const dateText = `Emitido em ${format(new Date(receipt.issueDate), 'dd/MM/yyyy')}.`;
    doc.text(dateText, 20, 150);

    // --- 6. SIGNATURE BOX ---
    doc.setDrawColor(secondarySlate.r, secondarySlate.g, secondarySlate.b);
    doc.setLineWidth(0.2);
    doc.line(60, 200, 150, 200);

    doc.setTextColor(darkSlate.r, darkSlate.g, darkSlate.b);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`${profile.fullName || 'Profissional'}`, 105, 206, { align: 'center' });

    doc.setTextColor(secondarySlate.r, secondarySlate.g, secondarySlate.b);
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Mentoria e Desenvolvimento Pessoal', 105, 211, { align: 'center' });

    // Footer info
    doc.setFontSize(8);
    doc.setTextColor(secondarySlate.r, secondarySlate.g, secondarySlate.b);
    doc.text('Este recibo comprova a prestação de serviços de mentoria e desenvolvimento pessoal.', 105, 260, { align: 'center' });

    doc.save(`Recibo_${receipt.receiptNumber}_${displayName.replace(/\s+/g, '_')}.pdf`);
  };

  return (
    <div className="animate-fade-in">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-h1">Recibos</h1>
          <p className="text-body">Histórico e emissão de recibos para pacientes</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="btn btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none' }}
          >
            <Download size={16} /> CSV
          </button>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={18} /> Emitir Recibo
          </button>
        </div>
      </div>

      {loading ? (
        <SkeletonTable rows={5} cols={6} />
      ) : error ? (
        <ErrorState
          title="Erro ao carregar recibos"
          message="Não foi possível carregar a lista de recibos emitidos."
          onRetry={loadData}
        />
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Data</th>
                <th>Paciente</th>
                <th>Valor</th>
                <th>Descrição</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map(r => {
                const patient = patients.find(p => p.id === r.patientId);
                return (
                  <tr key={r.id}>
                    <td>#{String(r.receiptNumber).padStart(4, '0')}</td>
                    <td>{format(new Date(r.issueDate), 'dd/MM/yyyy')}</td>
                    <td>{patient?.fullName || patient?.name || 'Desconhecido'}</td>
                    <td><strong>{formatCurrency(r.amountCents)}</strong></td>
                    <td>{r.description}</td>
                    <td>
                      <button className="btn-icon" onClick={() => handlePrint(r)} title="Baixar PDF">
                        <Printer size={18} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {receipts.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>
                    Nenhum recibo emitido.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <IssueReceiptModal 
          patients={patients}
          onClose={() => setShowModal(false)}
          onSave={loadData}
        />
      )}
    </div>
  );
}

interface IssueReceiptModalProps {
  patients: Patient[];
  onClose: () => void;
  onSave: () => void;
}

function IssueReceiptModal({ patients, onClose, onSave }: IssueReceiptModalProps) {
  const [formData, setFormData] = useState({
    patientId: '',
    amountText: '',
    description: 'Sessões de Mentoria e Desenvolvimento Pessoal',
    markMonthAsPaid: format(new Date(), 'yyyy-MM')
  });

  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.amountText || parseFloat(formData.amountText) <= 0) {
      toast.error('O valor inserido é inválido.');
      return;
    }
    const selectedPatient = patients.find(p => p.id === formData.patientId);
    if (!selectedPatient?.document || !selectedPatient.document.trim()) {
      toast.error('Não é possível emitir recibo para paciente sem CPF cadastrado.');
      return;
    }
    try {
      setSubmitting(true);
      const payload = {
        patientId: formData.patientId,
        amountCents: Math.round(Number(formData.amountText) * 100),
        description: formData.description,
        markMonthAsPaid: formData.markMonthAsPaid || undefined
      };

      await fetchApi('/api/psychotherapy/receipts', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      toast.success('Recibo emitido com sucesso.');
      onSave();
      onClose();
    } catch (err) {
      console.error(err);
      toast.error((err instanceof Error ? err.message : String(err)) || 'Falha ao emitir recibo.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content animate-fade-in">
        <h2 className="text-h2 mb-4">Emitir Recibo</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Paciente *</label>
            <select 
              required className="form-control"
              value={formData.patientId} 
              onChange={e => setFormData({...formData, patientId: e.target.value})}
              disabled={submitting}
            >
              <option value="">Selecione...</option>
              {patients.map(p => (
                <option key={p.id} value={p.id}>{p.fullName || p.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Valor (R$) *</label>
            <input 
              required type="number" step="0.01" min="0.01" className="form-control"
              value={formData.amountText} onChange={e => setFormData({...formData, amountText: e.target.value})}
              disabled={submitting}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Descrição</label>
            <input 
              required type="text" className="form-control"
              value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})}
              disabled={submitting}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Vincular a Faturamento (Opcional)</label>
            <input 
              type="month" className="form-control"
              value={formData.markMonthAsPaid} onChange={e => setFormData({...formData, markMonthAsPaid: e.target.value})}
              disabled={submitting}
            />
            <small className="text-small">
              Dará baixa automaticamente no mês especificado para este paciente.
            </small>
          </div>

          <div className="flex justify-end gap-2 mt-6">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Emitindo...' : 'Emitir'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
