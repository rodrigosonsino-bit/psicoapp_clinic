import React, { useEffect, useRef, useState, useCallback } from 'react';
import { fetchApi } from '../services/api';
import type { SessionTranscription } from '../types/api';
import { Video, Upload, Loader2, CheckCircle2, AlertCircle, FileAudio, Sparkles, Copy, ExternalLink, FileText, Mic } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import './SessionTranscriptionPanel.css';

interface Props {
  sessionId: string;
  googleMeetLink: string | null | undefined;
}

type PanelState = 'idle' | 'uploading' | 'processing' | 'done' | 'error' | 'draft';

// Helper: no-op abort controller for environments without native support
const makeAbortController = () =>
  typeof AbortController !== 'undefined' ? new AbortController() : null;

export default function SessionTranscriptionPanel({ sessionId, googleMeetLink }: Props) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  // Tracks whether the component is still mounted to prevent state updates after unmount
  const isMountedRef = useRef(true);
  // Holds the interval ID for the simulated progress so we can always clear it
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // AbortController for cancelling in-flight fetch requests on unmount
  const abortControllerRef = useRef<AbortController | null>(null);

  const [transcription, setTranscription] = useState<any | null>(null);
  const [panelState, setPanelState] = useState<PanelState>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [editedSoap, setEditedSoap] = useState('');
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inputMode, setInputMode] = useState<'audio' | 'text'>('audio');
  const [manualText, setManualText] = useState('');
  const [clinicalNoteId, setClinicalNoteId] = useState<string | null>(null);
  const [noteVersion, setNoteVersion] = useState<number>(1);
  const [isApproving, setIsApproving] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (progressIntervalRef.current !== null) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      abortControllerRef.current?.abort();
    };
  }, []);

  const loadExistingTranscription = useCallback(async () => {
    // If a request is already in flight, abort it
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
    }
    const controller = makeAbortController();
    abortControllerRef.current = controller;
    
    try {
      setLoadingExisting(true);
      const data = await fetchApi<any>(
        `/api/psychotherapy/sessions/${sessionId}/transcription`
      );
      if (!isMountedRef.current) return;
      
      if (data.status === 'pending' || data.status === 'waiting_artifact' || data.status === 'processing') {
          // Keep polling
          setPanelState('processing');
      } else if (data.status === 'failed' || data.status === 'abandoned') {
          setPanelState('error');
          toast.error('Falha na transcrição ou limite de tentativas excedido.');
      } else if (data.status === 'draft') {
          setTranscription(data);
          setEditedSoap(data.soapDraft || '');
          setClinicalNoteId(data.id);
          setNoteVersion(data.version || 1);
          setPanelState('draft');
      } else if (data.status === 'completed') {
          setTranscription(data);
          setEditedSoap(data.soapDraft || '');
          setPanelState('done');
      }
    } catch {
      if (!isMountedRef.current) return;
      setPanelState('idle');
    } finally {
      if (isMountedRef.current) setLoadingExisting(false);
    }
  }, [sessionId]);

  useEffect(() => {
    loadExistingTranscription();
    // Only poll if we are in processing or queued state (managed inside useEffect if needed)
    // Actually, setting up an interval for polling:
    let intervalId: ReturnType<typeof setInterval>;
    
    const startPolling = () => {
      intervalId = setInterval(async () => {
         await loadExistingTranscription();
      }, 5000);
    };
    
    // In React, it's better to just do it via setTimeout based on state
  }, [loadExistingTranscription]);

  useEffect(() => {
      let intervalId: ReturnType<typeof setInterval>;
      if (panelState === 'processing') {
          intervalId = setInterval(() => {
              loadExistingTranscription();
          }, 5000);
      }
      return () => {
          if (intervalId) clearInterval(intervalId);
      };
  }, [panelState, loadExistingTranscription]);

  const handleApproveDraft = async () => {
      if (!clinicalNoteId) return;
      try {
          setIsApproving(true);
          await fetchApi(`/api/psychotherapy/clinical-notes/${clinicalNoteId}/actions/approve`, {
              method: 'POST',
              body: JSON.stringify({ version: noteVersion, content: editedSoap }),
          });
          toast.success('Rascunho aprovado e convertido em nota final!');
          setPanelState('done');
      } catch (err: any) {
          if (err.status === 409) {
              toast.error('A nota já foi modificada ou aprovada por outra janela.');
          } else {
              toast.error('Erro ao aprovar rascunho.');
          }
      } finally {
          setIsApproving(false);
      }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      toast.error('O arquivo de áudio não pode ultrapassar 50MB.');
      return;
    }
    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    const controller = makeAbortController();
    abortControllerRef.current = controller;

    try {
      setPanelState('uploading');
      setUploadProgress(0);

      const formData = new FormData();
      formData.append('audio', selectedFile);

      // Simulate upload progress (real XHR progress would require XMLHttpRequest)
      progressIntervalRef.current = setInterval(() => {
        setUploadProgress(p => Math.min(p + 8, 85));
      }, 300);

      setPanelState('processing');

      const data = await fetchApi<SessionTranscription>(
        `/api/psychotherapy/sessions/${sessionId}/transcribe`,
        { method: 'POST', body: formData }
      );

      if (!isMountedRef.current) return;
      setUploadProgress(100);
      setTranscription(data);
      setEditedSoap(data.soapDraft || '');
      setPanelState('done');
      setSelectedFile(null);
      toast.success('Transcrição e resumo clínico gerados com sucesso!');
    } catch (err) {
      if (!isMountedRef.current) return;
      setPanelState('error');
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao processar a transcrição.');
    } finally {
      // Always clear the interval — even if an error or unmount occurred
      if (progressIntervalRef.current !== null) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    }
  };

  const handleTextSubmit = async () => {
    if (manualText.trim().length < 10) {
      toast.error('Digite ao menos 10 caracteres de transcrição.');
      return;
    }
    const controller = makeAbortController();
    abortControllerRef.current = controller;
    try {
      setPanelState('processing');
      const data = await fetchApi<SessionTranscription>(
        `/api/psychotherapy/sessions/${sessionId}/transcribe/text`,
        { method: 'POST', body: JSON.stringify({ text: manualText.trim() }) }
      );
      if (!isMountedRef.current) return;
      setTranscription(data);
      setEditedSoap(data.soapDraft || '');
      setPanelState('done');
      toast.success('Prontuário SOAP gerado com sucesso!');
    } catch (err) {
      if (!isMountedRef.current) return;
      setPanelState('error');
      toast.error((err instanceof Error ? err.message : String(err)) || 'Erro ao gerar o prontuário.');
    }
  };

  const handleCopySoap = () => {
    navigator.clipboard.writeText(editedSoap);
    toast.success('Rascunho SOAP copiado!');
  };

  const handleReset = () => {
    setPanelState('idle');
    setSelectedFile(null);
    setManualText('');
    setUploadProgress(0);
    if (fileRef.current) fileRef.current.value = '';
  };

  if (loadingExisting) {
    return (
      <div className="stp-loading">
        <Loader2 size={20} className="stp-spin" />
        <span>Carregando dados da sessão...</span>
      </div>
    );
  }

  return (
    <div className="stp-root">
      {/* ── Google Meet Link ── */}
      <section className="stp-section stp-meet-section">
        <div className="stp-section-header">
          <Video size={18} className="stp-icon-meet" />
          <h3 className="stp-section-title">Sessão Online — Google Meet</h3>
        </div>

        {googleMeetLink ? (
          <div className="stp-meet-link-card">
            <div className="stp-meet-info">
              <span className="stp-meet-label">Link da Sala</span>
              <span className="stp-meet-url">{googleMeetLink}</span>
            </div>
            <a
              href={googleMeetLink}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary stp-meet-btn"
              id="enter-meet-btn"
            >
              <ExternalLink size={16} />
              Entrar na Sessão
            </a>
          </div>
        ) : (
          <div className="stp-meet-empty">
            <p>Esta sessão não possui um link do Google Meet associado.</p>
            <p className="stp-meet-hint">
              Sessões agendadas a partir de agora têm sala do Meet criada automaticamente.
            </p>
          </div>
        )}
      </section>

      {/* ── Transcription & AI ── */}
      <section className="stp-section">
        <div className="stp-section-header">
          <Sparkles size={18} className="stp-icon-ai" />
          <h3 className="stp-section-title">Transcrição e Prontuário IA</h3>
        </div>

        {/* State: idle or error — dual input mode */}
        {(panelState === 'idle' || panelState === 'error') && !transcription && (
          <div className="stp-upload-area" id="transcription-upload-area">

            {/* Mode switcher */}
            <div className="stp-mode-tabs">
              <button
                type="button"
                id="mode-audio-btn"
                className={`stp-mode-tab ${inputMode === 'audio' ? 'active' : ''}`}
                onClick={() => setInputMode('audio')}
              >
                <Mic size={14} /> Upload de Áudio
              </button>
              <button
                type="button"
                id="mode-text-btn"
                className={`stp-mode-tab ${inputMode === 'text' ? 'active' : ''}`}
                onClick={() => setInputMode('text')}
              >
                <FileText size={14} /> Colar Texto
              </button>
            </div>

            {/* ── Modo: Áudio ── */}
            {inputMode === 'audio' && (
              <>
                <FileAudio size={36} className="stp-upload-icon" />
                <p className="stp-upload-title">Enviar Gravação da Sessão</p>
                <p className="stp-upload-hint">MP3, M4A, WAV, OGG, WEBM — até 50MB</p>

                {selectedFile && (
                  <div className="stp-file-selected">
                    <span className="stp-file-name">{selectedFile.name}</span>
                    <span className="stp-file-size">
                      ({(selectedFile.size / (1024 * 1024)).toFixed(1)} MB)
                    </span>
                  </div>
                )}

                <div className="stp-upload-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => fileRef.current?.click()}
                    id="select-audio-btn"
                  >
                    <Upload size={16} />
                    {selectedFile ? 'Trocar arquivo' : 'Selecionar áudio'}
                  </button>

                  {selectedFile && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleUpload}
                      id="start-transcription-btn"
                    >
                      <Sparkles size={16} />
                      Transcrever com IA
                    </button>
                  )}
                </div>

                <input
                  ref={fileRef}
                  type="file"
                  accept="audio/*,video/mp4,video/webm"
                  className="stp-file-input"
                  onChange={handleFileChange}
                  id="audio-file-input"
                />
              </>
            )}

            {/* ── Modo: Texto manual ── */}
            {inputMode === 'text' && (
              <>
                <FileText size={36} className="stp-upload-icon" />
                <p className="stp-upload-title">Colar Transcrição da Sessão</p>
                <p className="stp-upload-hint">
                  Digite ou cole o texto da sessão. O Gemini irá gerar o prontuário SOAP automaticamente.
                </p>

                <textarea
                  className="stp-soap-textarea"
                  style={{ minHeight: 160, width: '100%', marginTop: 8 }}
                  placeholder="Psicólogo: Como você está hoje?&#10;Paciente: Estive me sentindo ansioso..."
                  value={manualText}
                  onChange={e => setManualText(e.target.value)}
                  id="manual-text-input"
                />

                <div className="stp-upload-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleTextSubmit}
                    disabled={manualText.trim().length < 10}
                    id="submit-text-btn"
                  >
                    <Sparkles size={16} />
                    Gerar Prontuário SOAP
                  </button>
                </div>
              </>
            )}

            {panelState === 'error' && (
              <p className="stp-error-msg">
                <AlertCircle size={14} />
                Ocorreu um erro. Verifique e tente novamente.
              </p>
            )}
          </div>
        )}


        {/* State: uploading / processing */}
        {(panelState === 'uploading' || panelState === 'processing') && (
          <div className="stp-processing">
            <Loader2 size={32} className="stp-spin stp-processing-icon" />
            <p className="stp-processing-title">
              {panelState === 'uploading' ? 'Enviando áudio...' : 'IA processando a transcrição...'}
            </p>
            <p className="stp-processing-hint">
              {panelState === 'processing'
                ? 'O Deepgram está transcrevendo e o Gemini está gerando o prontuário SOAP. Isso pode levar de 30 a 90 segundos.'
                : 'Aguarde enquanto o arquivo é carregado.'}
            </p>

            {panelState === 'processing' && (
              <div className="stp-steps">
                <div className="stp-step stp-step-done">
                  <CheckCircle2 size={14} /> Upload do áudio
                </div>
                <div className="stp-step stp-step-active">
                  <Loader2 size={14} className="stp-spin" /> Transcrição com Deepgram Nova-2
                </div>
                <div className="stp-step stp-step-waiting">
                  <span className="stp-step-dot" /> Resumo SOAP com Gemini 1.5
                </div>
              </div>
            )}

            <div className="stp-progress-bar-track">
              <div
                className="stp-progress-bar-fill"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* State: done or draft — show transcript + SOAP editor */}
        {(panelState === 'done' || panelState === 'draft') && transcription && (
          <div className="stp-result">
            <div className="stp-result-header">
              <CheckCircle2 size={16} className="stp-icon-success" />
              <span>{panelState === 'draft' ? 'Rascunho gerado (Aprovação pendente)' : 'Processamento concluído'}</span>
              <button
                type="button"
                className="btn btn-secondary stp-redo-btn"
                onClick={handleReset}
                id="redo-transcription-btn"
              >
                <Upload size={14} /> Nova transcrição
              </button>
            </div>

            {/* Raw Transcript collapsible */}
            {transcription.rawTranscript && (
              <details className="stp-transcript-details">
                <summary className="stp-transcript-summary">
                  Transcrição bruta da sessão
                </summary>
                <div className="stp-transcript-body">
                  {transcription.rawTranscript}
                </div>
              </details>
            )}

            {/* SOAP Draft Editor */}
            <div className="stp-soap-editor">
              <div className="stp-soap-header">
                <div className="stp-soap-title-group">
                  <Sparkles size={14} className="stp-icon-ai" />
                  <span className="stp-soap-label">Rascunho de Prontuário (SOAP)</span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={handleCopySoap}
                    title="Copiar rascunho"
                    id="copy-soap-btn"
                  >
                    <Copy size={16} />
                  </button>
                  {panelState === 'draft' && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleApproveDraft}
                      disabled={isApproving}
                      id="approve-draft-btn"
                    >
                      {isApproving ? <Loader2 size={16} className="stp-spin" /> : <CheckCircle2 size={16} />}
                      Aprovar Rascunho
                    </button>
                  )}
                </div>
              </div>

              <textarea
                className="stp-soap-textarea"
                value={editedSoap}
                onChange={e => {
                  setEditedSoap(e.target.value);
                  // stop polling if editing
                  if (panelState === 'processing') setPanelState('draft'); 
                }}
                id="edit-soap-textarea"
                rows={16}
              />

              <p className="stp-soap-hint">
                O conteúdo acima é gerado por IA. Revise antes de oficializar na ficha do paciente.
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
