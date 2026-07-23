import React, { useEffect, useRef, useState, useCallback } from 'react';
import { fetchApi } from '../services/api';
import type { SessionTranscription } from '../types/api';
import { Video, Upload, Loader2, CheckCircle2, AlertCircle, FileAudio, Sparkles, Copy, ExternalLink } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import './SessionTranscriptionPanel.css';

interface Props {
  sessionId: string;
  googleMeetLink: string | null | undefined;
}

type PanelState = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

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

  const [transcription, setTranscription] = useState<SessionTranscription | null>(null);
  const [panelState, setPanelState] = useState<PanelState>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [editedSoap, setEditedSoap] = useState('');
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Cleanup on unmount: stop any running intervals and abort pending fetches
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
    const controller = makeAbortController();
    abortControllerRef.current = controller;
    try {
      setLoadingExisting(true);
      const data = await fetchApi<SessionTranscription>(
        `/api/psychotherapy/sessions/${sessionId}/transcription`
      );
      if (!isMountedRef.current) return;
      setTranscription(data);
      setEditedSoap(data.soapDraft || '');
      setPanelState('done');
    } catch {
      // 404 means no transcription yet — that's fine
      if (!isMountedRef.current) return;
      setPanelState('idle');
    } finally {
      if (isMountedRef.current) setLoadingExisting(false);
    }
  }, [sessionId]);

  useEffect(() => {
    loadExistingTranscription();
  }, [loadExistingTranscription]);

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

  const handleCopySoap = () => {
    navigator.clipboard.writeText(editedSoap);
    toast.success('Rascunho SOAP copiado!');
  };

  const handleReset = () => {
    setPanelState('idle');
    setSelectedFile(null);
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

        {/* State: idle or file selected */}
        {(panelState === 'idle' || panelState === 'error') && !transcription && (
          <div className="stp-upload-area" id="transcription-upload-area">
            <FileAudio size={40} className="stp-upload-icon" />
            <p className="stp-upload-title">Enviar Gravação da Sessão</p>
            <p className="stp-upload-hint">MP3, M4A, WAV, OGG, WEBM — até 50MB</p>

            {selectedFile ? (
              <div className="stp-file-selected">
                <span className="stp-file-name">{selectedFile.name}</span>
                <span className="stp-file-size">
                  ({(selectedFile.size / (1024 * 1024)).toFixed(1)} MB)
                </span>
              </div>
            ) : null}

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

            {panelState === 'error' && (
              <p className="stp-error-msg">
                <AlertCircle size={14} />
                Ocorreu um erro. Verifique o arquivo e tente novamente.
              </p>
            )}

            <input
              ref={fileRef}
              type="file"
              accept="audio/*,video/mp4,video/webm"
              className="stp-file-input"
              onChange={handleFileChange}
              id="audio-file-input"
            />
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

        {/* State: done — show transcript + SOAP editor */}
        {panelState === 'done' && transcription && (
          <div className="stp-result">
            <div className="stp-result-header">
              <CheckCircle2 size={16} className="stp-icon-success" />
              <span>Processamento concluído</span>
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
                <button
                  type="button"
                  className="btn-icon"
                  onClick={handleCopySoap}
                  title="Copiar rascunho"
                  id="copy-soap-btn"
                >
                  <Copy size={14} />
                </button>
              </div>

              <textarea
                className="stp-soap-textarea"
                value={editedSoap}
                onChange={e => setEditedSoap(e.target.value)}
                placeholder="O rascunho SOAP gerado pela IA aparecerá aqui..."
                rows={16}
                id="soap-draft-textarea"
              />

              <p className="stp-soap-hint">
                Revise, edite e copie o conteúdo acima para colar no prontuário oficial do paciente.
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
