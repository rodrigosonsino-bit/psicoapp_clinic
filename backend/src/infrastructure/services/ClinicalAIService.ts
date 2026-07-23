import { injectable } from 'tsyringe';
import { logger } from '../logger';

@injectable()
export class ClinicalAIService {
    async generateSummaryDraft(transcript: string): Promise<string> {
        const apiKey = process.env.GEMINI_API_KEY;
        const modelName = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

        if (!apiKey) {
            if (process.env.NODE_ENV !== 'production') {
                logger.info('Simulando geração de prontuário com IA em modo de desenvolvimento');
                return `# Rascunho Clínico da Sessão (Modelo SOAP)

## 1. Subjetivo (S)
* **Queixas Principais**: O paciente relatou cansaço extremo e estresse associados à rotina de trabalho.
* **Auto-relato**: Descreveu sentimentos de sobrecarga e cobrança excessiva por parte do gestor direto, afetando o sono e a desconexão nos finais de semana.

## 2. Objetivo (O)
* **Aparência e Comportamento**: Pelo discurso transcrito, o paciente demonstra ansiedade ao falar do trabalho e ruminação mental sobre as tarefas profissionais pendentes.
* **Foco Verbal**: Relatos concentrados na falta de limites entre vida pessoal e corporativa.

## 3. Avaliação/Análise (A)
* **Hipótese Clínica**: Padrão de pensamentos automáticos disfuncionais ("devo fazer tudo perfeito", "se eu falhar, serei demitido"). Sinais de esgotamento profissional (Burnout) em desenvolvimento.
* **Técnicas**: Introduzida psicoeducação sobre regulação emocional e estabelecimento de limites saudáveis.

## 4. Plano (P)
* **Tarefa de Casa (Homework)**: Preenchimento do Registro de Pensamentos Disfuncionais (RPD) ao se sentir ansioso no trabalho.
* **Foco da Próxima Sessão**: Avaliar os registros de pensamentos e treinar técnicas de assertividade de comunicação.`;
            }
            throw new Error('Chave de API do Gemini não configurada (GEMINI_API_KEY).');
        }

        logger.info({ modelName }, 'Iniciando geração de resumo clínico com Gemini');

        const systemPrompt = `Você é um assistente de inteligência artificial clínico especializado em psicologia clínica.
Sua tarefa é analisar a transcrição de uma sessão de psicoterapia e estruturar um rascunho de prontuário clínico baseado no modelo SOAP (Subjetivo, Objetivo, Avaliação, Plano).
Escreva a resposta final estritamente em português, no formato Markdown, sem rodeios ou explicações adicionais fora do prontuário. Mantenha o sigilo do paciente usando termos genéricos se nomes forem ditos.

Siga rigorosamente a estrutura abaixo:
# Rascunho Clínico da Sessão (Modelo SOAP)

## 1. Subjetivo (S)
(Relatos subjetivos do paciente, queixas principais, sentimentos expressos, autopercepção)

## 2. Objetivo (O)
(Comportamento verbal observado, sinais de ansiedade, depressão, postura, foco principal do discurso)

## 3. Avaliação/Análise (A)
(Hipóteses clínicas, distorções cognitivas identificadas, técnicas terapêuticas aplicadas ou introduzidas)

## 4. Plano (P)
(Tarefas de casa recomendadas, diretrizes para a próxima sessão, metas de curto prazo)`;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [
                        {
                            role: 'user',
                            parts: [
                                { text: systemPrompt },
                                { text: `Aqui está a transcrição da sessão:\n\n${transcript}` }
                            ]
                        }
                    ],
                    generationConfig: {
                        temperature: 0.2,
                    }
                }),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Erro na API do Gemini (${response.status}): ${errText}`);
            }

            const data = (await response.json()) as any;
            const outputText = data.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!outputText) {
                throw new Error('Resposta do Gemini vazia ou inválida.');
            }

            return outputText.trim();
        } catch (err: any) {
            logger.error({ err }, 'Falha ao processar com Gemini');
            throw err;
        }
    }
}
