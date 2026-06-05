# Orquestração do Backend com Docker Compose

Esta é a documentação para subir todo o ambiente de forma unificada (PostgreSQL + Redis + API Node) sem instalar serviços avulsos localmente.

## Pré-requisitos
- Ter o **Docker** e o **Docker Compose** instalados na máquina.

## Como Executar

1. Abra seu terminal e navegue via `cd` até a pasta `whatsapp-scheduler-backend`.
2. Para levantar todos os containeres em segundo plano (background - *detached mode*), rode:
   ```bash
   docker-compose up -d
   ```
3. Na primeira execução, o Docker vai "Buildar" (compilar) a imagem do Node observando o `Dockerfile`, depois baixará as imagens super compactas *alpine* do PostgreSQL e Redis.
4. Logo em seguida, o banco executará automaticamente seu arquivo `schema.sql` (configurado via mapping de volumes).
5. Como definimos um *Healthcheck* no `docker-compose.yml`, sua API do Node só será ligada após os bancos confirmarem estarem saudáveis.

## Observando a Famosa Tela do QR Code no Docker
Dado que nossa API emite um QR Code no processo, você deve visualizar os logs "ao vivo" logo após rodar o comando acima, para que possa ler usando a câmera:
```bash
docker-compose logs -f api
```

E pronto! Escaneie o código no terminal e pode desconectar usando `CTRL+C`. 

> **Aviso:** Note que eu montei um volume persistente para `./auth_info_baileys`. Significa que os tokens credenciais do aparelho ficarão salvos no seu disco real; mesmo se você apagar o contêiner e criá-lo daqui um mês, não lhe pedirá QR code novamente!

## Como Validar a Saúde Geral (Health Check Endpoint)
Acesse do seu navegador ou de ferramentas como Postman/Insomnia:
`GET http://localhost:3000/api/health`

**Resposta Esperada:**
```json
{
  "status": "ok",
  "services": {
    "database": "up",
    "redis": "up",
    "whatsapp": "up"
  }
}
```

Se precisar derrubar todo o ecossistema e parar de pagar/recuperar a memória:
```bash
docker-compose down
```
