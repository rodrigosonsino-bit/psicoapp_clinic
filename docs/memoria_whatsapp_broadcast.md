# Correção do Erro de Conexão do WhatsApp no Envio em Massa (Broadcast)

## Problema
Durante a criação de uma campanha de envio em massa (Broadcast), o sistema apresentava o erro "WhatsApp não está conectado" incorretamente (Erro 409). Isso ocorria principalmente após a ociosidade do servidor ou quando o processo de _lazy init_ (inicialização sob demanda) era acionado. A API validava se o socket WebSocket do Baileys já estava com status `open` no exato milissegundo do request (`!client.isConnected()`). No entanto, como a subida do socket leva alguns segundos, essa checagem falhava mesmo que o usuário estivesse devidamente logado e com as credenciais válidas no banco de dados.

## Solução (Implementação)
A checagem restritiva `!client.isConnected()` foi removida do caso de uso `CreateBroadcastUseCase.ts`. Agora, o código verifica apenas se a sessão base existe e o usuário está vinculado (ou seja, se `getSession` não retorna nulo). A responsabilidade de aguardar a conexão física se concretizar e lidar com quedas temporárias já pertence naturalmente ao `BroadcastWorker.ts`. Esse *worker* (que roda em background usando BullMQ) já é dotado de inteligência para realizar _retries_ com *exponential backoff* caso encontre o socket ainda fechado, não sendo necessário rejeitar a criação do Broadcast prematuramente.

## Arquivos Alterados
- `backend/src/application/useCases/CreateBroadcastUseCase.ts`: Remoção do `|| !client.isConnected()` da validação de sessão.
