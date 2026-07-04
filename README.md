# Chatwoot Messenger Bridge

Conecta uma conta pessoal do Facebook Messenger a um inbox do Chatwoot, usando
uma extensão Chrome (que fica aberta numa aba logada no messenger.com) e um
serviço backend na sua VPS.

Não existe API oficial da Meta para automatizar uma conta *pessoal* do
Messenger (isso só existe para Páginas via Messenger Platform). Por isso essa
solução funciona por automação de navegador/DOM scraping, o que:

- Viola os Termos de Uso do Facebook para automação — risco de a conta pessoal
  ser sinalizada/suspensa. Use por sua conta e risco, com uma conta que você
  aceita perder.
- É frágil: o Messenger usa classes CSS ofuscadas que mudam com frequência.
  Os seletores em `extension/content.js` são um ponto de partida e quase
  certamente vão precisar de ajuste (inspecione o DOM com o DevTools).

## Arquitetura

```
Messenger (aba Chrome sempre aberta)
   -> content script (lê/injeta mensagens no DOM)
   -> background service worker (WebSocket persistente)
   -> servidor Node/TS na VPS
        -> API pública do Chatwoot (cria contato/conversa/mensagem)
        <- webhook do Chatwoot (mensagens enviadas pelo agente)
```

## 1. Configurar o inbox no Chatwoot

1. Settings → Inboxes → New Inbox → **API**. Dê um nome (ex: "Messenger
   pessoal") e copie o **Inbox Identifier** gerado.
2. Na configuração do inbox, aba **Webhooks**, adicione a URL do seu servidor:
   `https://sua-vps.com/webhook` — isso faz o Chatwoot avisar o serviço
   sempre que um agente responder.
3. (Opcional, recomendado) Defina um segredo próprio para validar o webhook —
   como o Chatwoot não assina o payload por padrão, essa validação é feita via
   header customizado; veja `CHATWOOT_WEBHOOK_TOKEN` abaixo e configure o
   mesmo valor num proxy/reverse-proxy na frente do seu servidor, ou restrinja
   por IP/firewall na VPS.

## 2. Rodar o servidor

**Local/manual:**

```bash
cd server
cp .env.example .env
# edite .env: EXTENSION_TOKEN, CHATWOOT_BASE_URL, CHATWOOT_INBOX_IDENTIFIER
npm install
npm run build
npm start   # ou use pm2: pm2 start dist/index.js --name messenger-bridge
```

Exponha a porta (padrão 3000) via reverse proxy HTTPS (nginx/caddy), já que a
extensão precisa de `wss://` (WebSocket seguro) e o Chatwoot precisa de
`https://` para o webhook.

**Na sua VPS via EasyPanel (backend + Chrome visual 24/7):** siga o guia
completo em [`DEPLOY_EASYPANEL.md`](./DEPLOY_EASYPANEL.md) — cobre os dois
serviços (servidor + um Chromium acessível pelo navegador via noVNC, já que
"Load unpacked" precisa de uma tela) e como carregar a extensão sem precisar
de um computador local sempre ligado.

## 3. Instalar a extensão (execução local, sem EasyPanel)

1. `chrome://extensions` → ative "Modo do desenvolvedor" → "Carregar sem
   compactação" → selecione a pasta `extension/`.
2. Clique no ícone da extensão → preencha:
   - **URL do WebSocket do servidor**: `wss://sua-vps.com/ws/extension`
   - **Token da extensão**: o mesmo valor de `EXTENSION_TOKEN` no `.env`
3. Abra `https://www.messenger.com` nessa janela do Chrome e faça login com a
   conta pessoal. Deixe essa aba/janela aberta e o Chrome rodando.

> Para rodar isso 24/7 na VPS (sem depender do seu computador ficar ligado),
> use o [`DEPLOY_EASYPANEL.md`](./DEPLOY_EASYPANEL.md), que sobe um Chromium
> visual acessível por URL em vez do Chrome local.

## 4. Ajustar os seletores do Messenger

Abra `extension/content.js` e revise o objeto `SELECTORS` e a função
`isOutgoing`. Use o DevTools no messenger.com para conferir:

- Qual atributo identifica cada linha de mensagem (`[role="row"]` é um ponto
  de partida comum, mas pode não bater 100%).
- Como diferenciar mensagem enviada por você vs. recebida (aria-label,
  alinhamento, classe de "own message").
- O seletor da caixa de texto de resposta (`[role="textbox"]`).

## Fluxo de dados

- **Mensagem recebida no Messenger** → content script detecta via
  `MutationObserver` → manda para o background → WebSocket → servidor cria
  (ou reaproveita) contato + conversa no Chatwoot via API pública
  (`/public/api/v1/inboxes/:id/...`) e posta a mensagem.
- **Agente responde no Chatwoot** → Chatwoot dispara o webhook configurado →
  servidor identifica a thread do Messenger correspondente (tabela SQLite
  `threads`) → manda comando via WebSocket → content script digita e envia no
  Messenger.
