import { useState, useEffect } from 'react';
import { FileText, Download, AlertTriangle, ChevronDown } from 'lucide-react';
import { fetchApi } from '../services/api';
import type { IrReport, IrPatientSummary } from '../types/api';
import { formatCurrency } from '../utils/formatters';
import { useToast } from '../context/ToastContext';

export default function Fiscal() {
  const [year, setYear] = useState<number>(new Date().getFullYear() - 1);
  const [report, setReport] = useState<IrReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [generatingPdf, setGeneratingPdf] = useState<string | null>(null);
  const toast = useToast();

  const loadReport = async (targetYear: number) => {
    try {
      setLoading(true);
      const data = await fetchApi<IrReport>(`/api/psychotherapy/export/ir-report?year=${targetYear}`);
      setReport(data);
    } catch {
      toast.error('Erro ao carregar relatório fiscal');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadReport(year); }, [year]);

  const exportCsv = () => {
    if (!report) return;
    
    const rows = [
      ['Nome do Paciente', 'CPF', 'Total Pago (R$)', 'Sessões'],
      ...report.patientSummaries.map(p => [
        p.patientName,
        p.document || 'Sem CPF',
        (p.totalPaidCents / 100).toFixed(2).replace('.', ','),
        p.sessionCount.toString()
      ])
    ];

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" 
      + rows.map(e => e.join(";")).join("\n");
      
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `relatorio_fiscal_${year}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const generateIndividualPdf = async (patient: IrPatientSummary) => {
    if (!report) return;
    try {
      setGeneratingPdf(patient.patientId);
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF();

      doc.setFontSize(12);
      doc.text('DECLARAÇÃO DE RENDIMENTOS - MENTORIA E DESENVOLVIMENTO PESSOAL', 105, 20, { align: 'center' });
      
      doc.setFontSize(11);
      doc.text(`Ano Base: ${year}`, 105, 30, { align: 'center' });

      doc.setFontSize(11);
      doc.text(`Profissional: ${report.tenant.fullName || report.tenant.name}`, 20, 50);
      if (report.tenant.document) doc.text(`CPF/CNPJ: ${report.tenant.document}`, 20, 58);
      if (report.tenant.professionalId) doc.text(`Registro/CRP: ${report.tenant.professionalId}`, 20, 66);
      if (report.tenant.address) doc.text(`Endereço: ${report.tenant.address}`, 20, 74);

      doc.line(20, 80, 190, 80);

      const displayName = patient.patientFullName || patient.patientName;

      doc.text(`Recebi(emos) de ${displayName}`, 20, 95);
      if (patient.document) {
        doc.text(`Inscrito(a) no CPF sob o nº: ${patient.document}`, 20, 103);
      } else {
        doc.text(`Inscrito(a) no CPF sob o nº: ________________________`, 20, 103);
      }

      doc.text(`A importância de ${formatCurrency(patient.totalPaidCents)}`, 20, 111);
      doc.text(`Referente a ${patient.sessionCount} sessões de mentoria e desenvolvimento pessoal realizadas no ano de ${year}.`, 20, 119);
      
      doc.text(`Meses com registro de pagamento:`, 20, 127);
      const monthsStr = patient.months.map(m => m.split('-').reverse().join('/')).join(', ');
      doc.text(monthsStr, 20, 135);

      doc.text('Por ser verdade, firmo o presente.', 20, 155);
      doc.text(`Local e Data: ______________________, _____ de _________________ de _______`, 20, 163);

      doc.line(60, 190, 150, 190);
      doc.text(`${report.tenant.fullName || report.tenant.name}`, 105, 198, { align: 'center' });

      doc.save(`Informe_Pagamentos_${displayName.replace(/\s+/g, '_')}_${year}.pdf`);
    } catch {
      toast.error('Erro ao gerar PDF');
    } finally {
      setGeneratingPdf(null);
    }
  };

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  if (loading && !report) {
    return <div className="p-8 text-center text-text-muted">Carregando relatório fiscal...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Relatórios Fiscais</h1>
          <p className="text-text-muted">Informe de rendimentos e recibos individuais para IRPF</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative">
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="appearance-none bg-surface border border-border-color rounded-lg pl-4 pr-10 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
            >
              {years.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
          </div>
        </div>
      </div>

      {report && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-surface rounded-xl border border-border-color p-6">
              <div className="text-sm text-text-muted mb-2">Receita Bruta ({year})</div>
              <div className="text-2xl font-semibold text-green-500">
                {formatCurrency(report.summary.totalRevenueCents)}
              </div>
            </div>
            
            <div className="bg-surface rounded-xl border border-border-color p-6">
              <div className="text-sm text-text-muted mb-2">Despesas Dedutíveis</div>
              <div className="text-2xl font-semibold text-red-500">
                {formatCurrency(report.summary.totalExpensesCents)}
              </div>
            </div>

            <div className="bg-surface rounded-xl border border-border-color p-6">
              <div className="text-sm text-text-muted mb-2">Resultado Líquido</div>
              <div className="text-2xl font-semibold text-text-primary">
                {formatCurrency(report.summary.netIncomeCents)}
              </div>
            </div>
          </div>

          {/* Pacientes List */}
          <div className="bg-surface border border-border-color rounded-xl overflow-hidden flex flex-col">
            <div className="p-4 border-b border-border-color flex justify-between items-center bg-bg-primary/50">
              <h2 className="font-medium text-text-primary">Pacientes e Pagamentos</h2>
              <button 
                onClick={exportCsv}
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors"
              >
                <FileText className="w-4 h-4" />
                Exportar Resumo (CSV)
              </button>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border-color text-sm text-text-muted">
                    <th className="p-4 font-medium">Nome do Paciente</th>
                    <th className="p-4 font-medium">CPF</th>
                    <th className="p-4 font-medium">Pago no Ano</th>
                    <th className="p-4 font-medium">Sessões</th>
                    <th className="p-4 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-border-color">
                  {report.patientSummaries.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-text-muted">
                        Nenhum registro de faturamento pago encontrado para {year}.
                      </td>
                    </tr>
                  ) : (
                    report.patientSummaries.map((patient) => (
                      <tr key={patient.patientId} className="hover:bg-bg-primary/30 transition-colors">
                        <td className="p-4 text-text-primary font-medium">{patient.patientName}</td>
                        <td className="p-4">
                          {patient.document ? (
                            <span className="text-text-secondary">{patient.document}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-orange-500 text-xs font-medium px-2 py-0.5 rounded-full bg-orange-500/10">
                              <AlertTriangle className="w-3 h-3" />
                              Falta CPF
                            </span>
                          )}
                        </td>
                        <td className="p-4 font-medium text-green-500">
                          {formatCurrency(patient.totalPaidCents)}
                        </td>
                        <td className="p-4 text-text-secondary">
                          {patient.sessionCount}
                        </td>
                        <td className="p-4 text-right">
                          <button
                            onClick={() => generateIndividualPdf(patient)}
                            disabled={generatingPdf === patient.patientId}
                            className="inline-flex items-center justify-center p-2 text-text-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-50"
                            title="Gerar Informe (PDF)"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
