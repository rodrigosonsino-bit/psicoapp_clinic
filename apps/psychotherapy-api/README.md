# Controle de Sessões de Psicoterapia — Backend Standalone

Este repositório contém o backend para o **Controle de Sessões de Psicoterapia**, uma aplicação robusta desenvolvida em **Node.js** com **TypeScript** e **PostgreSQL**. A arquitetura foi remodelada a partir dos princípios de **Clean Architecture (Arquitetura Limpa)**, mantendo a regra de negócios isolada da infraestrutura e dos mecanismos de entrega.

O sistema permite que o psicoterapeuta gerencie seus pacientes (ativos/inativos, preços de sessões padrão e tipos de pagamento) e controle mensalmente o faturamento (sessões previstas, realizadas, faltas, valores pagos e pendências).

---

## 🏗️ Arquitetura do Projeto

O projeto segue uma estrutura baseada em camadas limpas, garantindo desacoplamento, testabilidade e fácil manutenção:

```
├── migrations/             # Migrations SQL versionadas do banco de dados
├── public/                 # Interface estática do Frontend (SPA em HTML5/CSS3/Vanilla JS)
├── src/
│   ├── domain/             # Regras de negócio fundamentais e interfaces
│   │   ├── models/         # Modelos de dados tipados (Paciente, Registro Mensal)
│   │   ├── errors/         # Erros operacionais customizados (AppError)
│   │   └── repositories/   # Contratos de persistência (interfaces)
│   ├── application/        # Casos de Uso (Use Cases) autocontidos da aplicação
│   │   └── useCases/       # Lógicas como Gerar Mês, Listar, Excluir Paciente
│   ├── infrastructure/     # Implementações concretas e serviços de terceiros
│   │   ├── auth/           # Emissor e verificador de tokens (JwtService)
│   │   └── repositories/   # Acesso ao banco PostgreSQL com pg Pool
│   ├── presentation/       # Camada de entrada (HTTP / Express)
│   │   ├── controllers/    # Controladores da API
│   │   ├── middlewares/    # Validação Zod, Autenticação JWT e Erro Global
│   │   └── routes/         # Definição e mapeamento dos endpoints HTTP
│   ├── scripts/            # Scripts utilitários de CLI (ex: Importador XLSX)
│   └── server.ts           # Inicializador do Express e conexões
```

---

## 🚀 Tecnologias Utilizadas

*   **Runtime**: Node.js (v20+)
*   **Linguagem**: TypeScript (compilado nativamente com `tsc`)
*   **Framework Web**: Express
*   **Banco de Dados**: PostgreSQL (`pg` pool)
*   **Validação de Dados**: Zod
*   **Segurança**: JWT (`jsonwebtoken`), CORS, Helmet
*   **Importação**: `fflate` para descompressão leve de arquivos Excel (.xlsx)

---

## 🛠️ Instalação e Configuração

### 1. Pré-requisitos
Certifique-se de possuir instalado em sua máquina:
*   [Node.js](https://nodejs.org/) (versão LTS recomendada)
*   [PostgreSQL](https://www.postgresql.org/) rodando localmente ou em nuvem.

### 2. Clonar e Instalar Dependências
Abra a pasta do projeto no seu terminal e execute:
```bash
npm install
```

### 3. Configurar Variáveis de Ambiente
Crie um arquivo `.env` na raiz do projeto copiando as definições do template `.env.example`:
```bash
cp .env.example .env
```
Abra o arquivo `.env` e configure suas chaves reais:
*   `DATABASE_URL`: String de conexão do PostgreSQL.
*   `JWT_SECRET`: Chave secreta de assinatura.
*   `ALLOW_DEFAULT_USER` e `DEFAULT_USER_ID`: Configurações de desenvolvimento local para ignorar autenticação real JWT.

---

## 🗄️ Configuração do Banco de Dados

Após configurar o `.env` com `DATABASE_URL`, execute o runner de migrations para criar todas as tabelas automaticamente:

```bash
npm run migrate
```

O runner aplica todas as migrations em ordem, registra as aplicadas e é idempotente — pode ser executado múltiplas vezes com segurança.


---

## 📥 Importando Dados Iniciais (Planilha Excel)

O backend dispõe de um script CLI robusto que lê planilhas `.xlsx` antigas de controle de sessões e popula automaticamente as tabelas de pacientes e registros mensais do tenant no PostgreSQL.

Para importar a planilha, execute o comando especificando o caminho do arquivo XLSX:
```bash
npm run import:workbook -- "C:\Caminho\Para\Sua\Planilha.xlsx"
```
*Dica: Caso prefira, você também pode exportar a variável de ambiente `PSYCHOTHERAPY_WORKBOOK_PATH` contendo o caminho do arquivo antes de rodar o comando.*

---

## 💻 Scripts Disponíveis (npm)

*   `npm run dev`: Inicia o servidor em modo de desenvolvimento usando `ts-node` com reinicialização automática (recarregamento ao salvar).
*   `npm run build`: Compila todo o código TypeScript (`/src`) em JavaScript otimizado dentro do diretório `/dist`.
*   `npm start`: Inicia o servidor compilado a partir da pasta `/dist` (recomendado para produção).

---

## 🛡️ Segurança e Autenticação

### Modo de Desenvolvimento (Bypass)
Para testar a API localmente ou acessar o frontend sem um provedor de identidade externo configurado, defina no seu arquivo `.env`:
```env
ALLOW_DEFAULT_USER=true
DEFAULT_USER_ID=e3b0c442-98fc-11ee-b9d1-0242ac120002
```
Isso faz com que o middleware de autenticação (`authMiddleware`) resolva automaticamente todas as requisições HTTP locais para o tenant ID especificado.

### Modo de Produção (Estrito)
Em produção (`NODE_ENV=production`), todas as requisições devem incluir obrigatoriamente o cabeçalho HTTP:
```http
Authorization: Bearer <SEU_JWT_TOKEN>
```
O token deve ser gerado contendo o payload tipado:
```json
{
  "tenantId": "UUID-DO-TENANT",
  "email": "email@exemplo.com",
  "plan": "premium"
}
```

---

## 📈 Tratamento Global de Erros

A aplicação utiliza um middleware centralizado para captura de exceções (`errorHandler` em `src/presentation/middlewares/errorMiddleware.ts`).
*   Erros operacionais previstos devem ser disparados lançando a classe `AppError(mensagem, statusCode)`. O sistema automaticamente formata a resposta como JSON com status correto.
*   Erros imprevistos de sistema (como perda de conexão física com o banco) são interceptados, logados detalhadamente no console do servidor e retornam apenas a mensagem genérica `Ocorreu um erro interno no servidor` para o cliente em produção, evitando vazamento de dados internos de segurança.
