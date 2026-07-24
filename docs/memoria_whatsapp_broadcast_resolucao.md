# Memória de Resolução: WhatsApp Broadcast e Auditoria de Segurança

**Data:** 24 de Julho de 2026
**Contexto:** O sistema de envio em massa de mensagens de WhatsApp (Broadcast) e a auditoria de segurança da aplicação.

## Problemas Identificados e Resolvidos

### 1. Falha de Inicialização do Broadcast (Erro de Redis)
**Sintoma:** O backend no Railway estava travado em um loop de crash com o erro `ENOTFOUND mock` no Redis.
**Causa:** A variável de ambiente `REDIS_URL` estava configurada de forma rígida com o valor `"mock"` na interface do Railway, que era usado apenas para testes locais. Como a flag `ENABLE_BROADCAST_MESSAGES` estava ativada, o Worker tentava conectar no Redis real.
**Solução:** Provisionamos um banco de dados Redis oficial pelo painel do Railway e injetamos a URL correta (`${{Redis.REDIS_URL}}`) no serviço do Backend.

### 2. Envio de Rajada (Risco de Banimento no WhatsApp)
**Sintoma:** O Broadcast enviou todas as mensagens para os 19 pacientes de uma só vez, em vez de respeitar o espaçamento de 12 minutos, correndo forte risco de bloqueio.
**Causa:** 
- A versão open-source v5+ da biblioteca de filas **BullMQ** removeu a compatibilidade nativa da opção `limiter` no construtor do Worker (passou a ser uma funcionalidade da versão Pro). Portanto, o rate limit estava sendo ignorado silenciosamente.
- O tempo de espaçamento fallback (`BROADCAST_INTERVAL_MS`) no código estava definido para `12000` ms (12 segundos) e não 12 minutos.
**Solução:** 
- Inserimos um controle manual de taxa (`await new Promise(resolve => setTimeout(resolve, BROADCAST_INTERVAL_MS));`) diretamente no fim de execução de cada job do `BroadcastWorker.ts`. Como a concorrência (`concurrency`) é `1`, isso trava o Worker perfeitamente até o tempo esgotar, simulando o limitador.
- Alteramos a variável de fallback para `720000` ms (exatos 12 minutos).

### 3. Limpeza de Interface Remanescente
**Sintoma:** O campo "Mensagem de Lembrete" continuava aparecendo no painel web, mesmo após a exclusão do componente visual no código.
**Causa:** Durante a remoção dos campos, o código React (`ProfileSettings.tsx`) sofreu um pequeno erro de sintaxe por tag HTML solta (`</div>`). Esse erro não impedia a interface de rodar offline, mas quebrou o build de produção do Vercel, impedindo que a nova interface fosse servida na nuvem.
**Solução:** Corrigido o erro de sintaxe e o Vercel publicou a página limpa com sucesso.

### 4. Resolução da Auditoria de Segurança (LGPD & Criptografia)
Como pendência paralela sugerida pelo Codex CLI:
- **LGPD (Hard-Delete):** Implementamos a exclusão real (hard-delete) dos dados sensíveis clínicos no `PostgresPatientRepository.ts`, em conformidade com o Artigo 11 da LGPD, substituindo os dados de sessões e pagamentos por nulo e anonimizando o cadastro.
- **Criptografia OAuth:** Adaptamos a classe `PostgresAuthState.ts` para usar o `cryptoHelper` e criptografar automaticamente a chave mestre da sessão Baileys (`whatsapp_auth`) através do padrão `AES-256-GCM`, antes salvo em texto limpo.
