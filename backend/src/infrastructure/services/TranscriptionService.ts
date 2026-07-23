import { injectable } from 'tsyringe';
import { logger } from '../logger';

/**
 * TranscriptionService — converte áudio em texto.
 *
 * Prioridade de provedores:
 *   1. Gemini 1.5 Flash (multimodal — áudio nativo, qualquer chave GEMINI_API_KEY)
 *   2. Deepgram Nova-2 (DEEPGRAM_API_KEY)
 *   3. OpenAI Whisper (OPENAI_API_KEY)
 *   4. Mock em desenvolvimento (NODE_ENV !== 'production')
 */
@injectable()
export class TranscriptionService {
    async transcribe(audioBuffer: Buffer, mimeType: string): Promise<string> {
        const geminiKey  = process.env.GEMINI_API_KEY;
        const deepgramKey = process.env.DEEPGRAM_API_KEY;
        const openAIKey  = process.env.OPENAI_API_KEY;

        // ── Mock em dev/test ──────────────────────────────────────────────────
        if (!geminiKey && !deepgramKey && !openAIKey) {
            if (process.env.NODE_ENV !== 'production') {
                logger.info('Simulando transcrição em modo de desenvolvimento');
                return MOCK_TRANSCRIPT;
            }
            throw new Error(
                'Nenhuma chave de API configurada (GEMINI_API_KEY, DEEPGRAM_API_KEY ou OPENAI_API_KEY).'
            );
        }

        // ── 1. Gemini multimodal (preferencial) ───────────────────────────────
        if (geminiKey) {
            logger.info('Iniciando transcrição via Gemini 1.5 Flash (multimodal)');
            try {
                return await this.transcribeWithGemini(audioBuffer, mimeType, geminiKey);
            } catch (err: any) {
                logger.warn({ err }, 'Gemini multimodal falhou — tentando próximo provedor');
                if (!deepgramKey && !openAIKey) throw err;
            }
        }

        // ── 2. Deepgram Nova-2 ────────────────────────────────────────────────
        if (deepgramKey) {
            logger.info('Iniciando transcrição via Deepgram Nova-2');
            try {
                return await this.transcribeWithDeepgram(audioBuffer, mimeType, deepgramKey);
            } catch (err: any) {
                logger.warn({ err }, 'Deepgram falhou — tentando OpenAI Whisper');
                if (!openAIKey) throw err;
            }
        }

        // ── 3. OpenAI Whisper (fallback final) ────────────────────────────────
        logger.info('Iniciando transcrição via OpenAI Whisper');
        return await this.transcribeWithWhisper(audioBuffer, mimeType, openAIKey!);
    }

    // ── Gemini multimodal ─────────────────────────────────────────────────────
    private async transcribeWithGemini(
        audioBuffer: Buffer,
        mimeType: string,
        apiKey: string
    ): Promise<string> {
        const modelName = process.env.GEMINI_MODEL ?? 'gemini-1.5-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

        // Gemini aceita áudio inline como base64
        const audioBase64 = audioBuffer.toString('base64');

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [
                        {
                            inlineData: {
                                mimeType: mimeType,
                                data: audioBase64,
                            },
                        },
                        {
                            text: 'Transcreva fielmente todo o conteúdo de áudio para texto em português brasileiro. Preserva a fala natural, pausas e mudanças de interlocutor quando detectáveis (use "Psicólogo:" e "Paciente:" como prefixos se houver mais de um falante). Retorne APENAS a transcrição, sem comentários adicionais.',
                        },
                    ],
                }],
                generationConfig: { temperature: 0 },
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Erro na API Gemini multimodal (${response.status}): ${errText}`);
        }

        const data = (await response.json()) as any;
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Resposta do Gemini vazia ou inválida.');
        return text.trim();
    }

    // ── Deepgram Nova-2 ───────────────────────────────────────────────────────
    private async transcribeWithDeepgram(
        audioBuffer: Buffer,
        mimeType: string,
        apiKey: string
    ): Promise<string> {
        const response = await fetch(
            'https://api.deepgram.com/v1/listen?model=nova-2&language=pt-BR&smart_format=true',
            {
                method: 'POST',
                headers: { 'Authorization': `Token ${apiKey}`, 'Content-Type': mimeType },
                body: audioBuffer,
            }
        );

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Erro na API Deepgram (${response.status}): ${errText}`);
        }

        const data = (await response.json()) as any;
        const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript;
        if (!transcript) throw new Error('Formato de resposta do Deepgram inválido ou transcrição vazia.');
        return transcript;
    }

    // ── OpenAI Whisper ────────────────────────────────────────────────────────
    private async transcribeWithWhisper(
        audioBuffer: Buffer,
        mimeType: string,
        apiKey: string
    ): Promise<string> {
        const form = new FormData();
        form.append('file', new Blob([audioBuffer], { type: mimeType }), 'audio.wav');
        form.append('model', 'whisper-1');
        form.append('language', 'pt');

        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: form,
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Erro na API OpenAI Whisper (${response.status}): ${errText}`);
        }

        const data = (await response.json()) as any;
        if (!data.text) throw new Error('Resposta do Whisper vazia ou inválida.');
        return data.text;
    }
}

const MOCK_TRANSCRIPT = `Psicólogo: Olá, como você está se sentindo hoje?
Paciente: Bom dia. Honestamente, foi uma semana bem difícil. Tive muita dificuldade para dormir e o estresse no trabalho está me afetando bastante.
Psicólogo: Pode me contar mais sobre esse estresse?
Paciente: Meu chefe aumentou as cobranças e eu sinto que nada que faço é suficiente. Fico ruminando sobre isso até de madrugada.
Psicólogo: Identificamos algumas distorções cognitivas que podem estar contribuindo para isso. Vamos trabalhar no registro de pensamentos disfuncionais essa semana?
Paciente: Sim, acho que pode ajudar. Vou tentar registrar quando me sentir assim.`;
