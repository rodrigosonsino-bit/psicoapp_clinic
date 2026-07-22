import { injectable } from 'tsyringe';
import { logger } from '../logger';

@injectable()
export class TranscriptionService {
    async transcribe(audioBuffer: Buffer, mimeType: string): Promise<string> {
        const deepgramKey = process.env.DEEPGRAM_API_KEY;
        const openAIKey = process.env.OPENAI_API_KEY;

        if (!deepgramKey && !openAIKey) {
            // Em desenvolvimento/teste sem chaves de API, retorna uma transcrição mockada de demonstração
            if (process.env.NODE_ENV !== 'production') {
                logger.info('Simulando transcrição em modo de desenvolvimento');
                return 'Olá. Hoje na sessão de terapia conversamos sobre o estresse no trabalho e a dificuldade em manter uma rotina de sono saudável. O paciente relatou que se sente sobrecarregado pelas demandas de seu chefe e que isso tem prejudicado seus fins de semana com a família. Identificamos pensamentos automáticos de incompetência e definimos uma tarefa de registro de pensamentos disfuncionais para a próxima semana.';
            }
            throw new Error('Nenhuma chave de API de transcrição configurada (DEEPGRAM_API_KEY ou OPENAI_API_KEY).');
        }

        if (deepgramKey) {
            logger.info('Iniciando transcrição via Deepgram Nova-2');
            try {
                const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&language=pt-BR&smart_format=true', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Token ${deepgramKey}`,
                        'Content-Type': mimeType,
                    },
                    body: audioBuffer,
                });

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`Erro na API Deepgram (${response.status}): ${errText}`);
                }

                const data = (await response.json()) as any;
                const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript;
                if (!transcript) {
                    throw new Error('Formato de resposta do Deepgram inválido ou transcrição vazia.');
                }

                return transcript;
            } catch (err: any) {
                logger.error({ err }, 'Falha ao transcrever via Deepgram');
                throw err;
            }
        }

        // Fallback OpenAI Whisper
        logger.info('Iniciando transcrição via OpenAI Whisper');
        try {
            const formData = new FormData();
            const blob = new Blob([audioBuffer], { type: mimeType });
            formData.append('file', blob, 'audio.wav');
            formData.append('model', 'whisper-1');
            formData.append('language', 'pt');

            const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${openAIKey}`,
                },
                body: formData,
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Erro na API OpenAI Whisper (${response.status}): ${errText}`);
            }

            const data = (await response.json()) as any;
            if (!data.text) {
                throw new Error('Resposta do Whisper vazia ou inválida.');
            }

            return data.text;
        } catch (err: any) {
            logger.error({ err }, 'Falha ao transcrever via OpenAI Whisper');
            throw err;
        }
    }
}
