# Deploy completo no EasyPanel

Este guia cobre os dois serviços que precisam rodar na sua VPS via EasyPanel:

1. **`bridge-server`** — o backend Node/TS (WebSocket + webhook + API do Chatwoot).
2. **`bridge-chrome`** — um Chrome/Chromium *visual*, acessível pelo navegador via
   uma URL (noVNC), onde você loga no Facebook pessoal e carrega a extensão —
   substitui o "abra o `chrome://extensions` no seu computador" por uma versão
   que roda 24/7 na VPS.

Antes de começar: suba este repositório (`messenger-bridge`) para um repositório
Git privado (GitHub/GitLab) — o EasyPanel builda a partir de um repo Git.

```bash
cd /Users/leonardoteixeira/Documents/chatwoot/messenger-bridge
git add -A
git commit -m "initial scaffold"
# crie um repo privado no GitHub e depois:
git remote add origin git@github.com:seu-usuario/messenger-bridge.git
git push -u origin main
```

---

## 1. Serviço `bridge-server` (backend)

No EasyPanel: **Project → + Service → App**.

**Use o método de build via Dockerfile** (não o fluxo padrão de "Install
Script" + processo supervisor). Testamos o fluxo de Install Script neste
projeto e ele se mostrou inconsistente: nesta instância do EasyPanel, o
`/code` visto pelo *processo em execução* (e pelo Console) é a raiz inteira
do repositório (monorepo, com `server/` e `extension/` como subpastas — sem
`package.json` na raiz), mas o script de instalação parece rodar num
contexto diferente que "enxerga" `server/` como raiz. Isso causa erros do
tipo `ENOENT ... /code/package.json` mesmo com o install script funcionando.
Usar Dockerfile elimina essa ambiguidade: o build inteiro roda dentro da
definição do próprio Dockerfile, sem depender de nenhuma convenção de
diretório do painel.

- **Source**: GitHub repository → selecione `messenger-bridge`.
- **Build**: método = **Dockerfile**.
  - **Dockerfile Path**: `server/Dockerfile`
  - **Build Context**: raiz do repositório (padrão) — o Dockerfile já foi
    escrito assumindo isso (`COPY server/package*.json`, `COPY server/src`
    etc.). Se seu painel expuser um campo separado de "Build Path"/"Context"
    e você preferir apontá-lo para `server`, aí edite o Dockerfile removendo
    o prefixo `server/` dos `COPY` (comentário já deixado no arquivo).
- **Environment** (aba *Environment*), cole o conteúdo de `server/.env.example`
  preenchido:
  ```
  PORT=3000
  DATA_DIR=/app/data
  EXTENSION_TOKEN=gere-um-valor-aleatorio-forte
  CHATWOOT_WEBHOOK_TOKEN=gere-outro-valor-aleatorio
  CHATWOOT_BASE_URL=https://app.seuchatwoot.com
  CHATWOOT_INBOX_IDENTIFIER=<inbox identifier do inbox tipo API>
  ```
- **Mounts** (aba *Mounts*): adicione um **Volume**
  - Mount Path: `/app/data`
  - (garante que `bridge.sqlite3` sobrevive a redeploys/restarts)
- **Domains** (aba *Domains*): adicione um domínio (ex: `bridge.seudominio.com`),
  Proxy Port `3000`. O EasyPanel emite HTTPS via Let's Encrypt automaticamente.
  Isso já habilita tanto `https://bridge.seudominio.com/webhook` quanto
  `wss://bridge.seudominio.com/ws/extension` (o upgrade de WebSocket funciona
  transparente atrás do proxy do EasyPanel).
- Clique em **Deploy**. Acompanhe a aba *Logs* do build e depois do container:
  deve aparecer `messenger-bridge server listening on port 3000`.

### Configurar o webhook no Chatwoot

No inbox tipo API que você já criou: Settings → Inboxes → (seu inbox) →
Configuration → Webhook URL:

```
https://bridge.seudominio.com/webhook
```

---

## 2. Serviço `bridge-chrome` (navegador visual)

Aqui usamos a imagem pronta `lscr.io/linuxserver/chromium`, que empacota um
Chromium completo com interface acessível via navegador (KasmVNC/noVNC) — ou
seja, você abre uma URL no seu próprio navegador e vê/controla um Chrome real
rodando dentro da VPS, exatamente como se estivesse na sua máquina.

No EasyPanel: **Project → + Service → App**.

- **Source**: **Docker Image** → `lscr.io/linuxserver/chromium:latest`.
- **Environment**:
  ```
  PUID=1000
  PGID=1000
  TZ=America/Sao_Paulo
  CUSTOM_USER=escolha-um-usuario
  PASSWORD=escolha-uma-senha-forte
  CHROME_CLI=--disable-dev-shm-usage --load-extension=/config/extension
  ```
  - `CUSTOM_USER`/`PASSWORD` colocam autenticação HTTP básica na frente da
    tela do Chrome — **importante**, porque essa aba fica logada na sua conta
    pessoal do Facebook; sem isso, qualquer um com a URL acessa sua conta.
  - `CHROME_CLI=--load-extension=/config/extension` carrega a extensão
    automaticamente toda vez que o container sobe (não precisa repetir o
    "Load unpacked" manualmente a cada restart). `--disable-dev-shm-usage`
    evita crashes do Chromium por causa do `/dev/shm` pequeno em containers.
- **Mounts**: adicione um **Volume**
  - Mount Path: `/config`
  - (é onde ficam o perfil do Chrome — sessão do Facebook logada — e a pasta
    da extensão; sobrevive a restarts/redeploys)
- **Domains**: adicione um domínio (ex: `chrome.seudominio.com`), Proxy Port
  `3000` (a porta HTTP da interface do KasmVNC).
- Clique em **Deploy**.

### Colocar a extensão dentro do volume `/config`

A extensão (`extension/`) precisa existir dentro do container, no caminho que
configuramos em `CHROME_CLI` (`/config/extension`). Use o **Console/Launcher**
do EasyPanel (botão de terminal na tela do serviço `bridge-chrome`) para
clonar o repo e copiar a pasta:

```bash
git clone https://github.com/seu-usuario/messenger-bridge.git /tmp/repo
mkdir -p /config/extension
cp -r /tmp/repo/extension/* /config/extension/
```

Depois disso, reinicie o serviço `bridge-chrome` no EasyPanel (para o
Chromium subir já com `--load-extension` apontando pra pasta populada).

> Se o repositório for privado, gere um Personal Access Token no GitHub e use
> `git clone https://<token>@github.com/seu-usuario/messenger-bridge.git /tmp/repo`.

### Acessar e configurar

1. Abra `https://chrome.seudominio.com`, entre com `CUSTOM_USER`/`PASSWORD`.
2. Você verá o Chromium rodando normalmente. Confirme em `chrome://extensions`
   que "Chatwoot Messenger Bridge" está carregada (com `--load-extension` ela
   já vem ativa, sem precisar clicar em nada).
3. Clique no ícone da extensão → preencha:
   - **URL do WebSocket do servidor**: `wss://bridge.seudominio.com/ws/extension`
   - **Token da extensão**: o mesmo valor de `EXTENSION_TOKEN` do serviço
     `bridge-server`.
4. Navegue até `https://www.messenger.com`, faça login com sua conta pessoal.
5. **Deixe essa aba aberta** — como o Chromium roda dentro do container 24/7,
   não há "fechar o notebook": ele continua rodando na VPS independente do seu
   navegador local estar aberto ou não.

---

## 3. Checklist de verificação

- [ ] `bridge-server`: logs mostram o servidor no ar; `curl -I
      https://bridge.seudominio.com/webhook` responde (mesmo que 4xx sem
      payload, confirma que está acessível).
- [ ] Chatwoot: webhook do inbox aponta para `https://bridge.seudominio.com/webhook`.
- [ ] `bridge-chrome`: acessível via domínio próprio, com basic auth ativo.
- [ ] Extensão carregada, configurada com a URL/token corretos, ícone sem erro
      no console (`chrome://extensions` → "Errors").
- [ ] Sessão do Facebook logada na aba do messenger.com.
- [ ] Enviar uma mensagem de teste para o Facebook pessoal → verificar se uma
      nova conversa aparece no inbox do Chatwoot.
- [ ] Responder no Chatwoot → verificar (via logs do `bridge-server` e do
      console do Chromium) se o texto foi digitado/enviado no Messenger.

## Lembretes importantes

- Ajuste os seletores em `extension/content.js` (`SELECTORS`, `isOutgoing`)
  inspecionando o DOM real do Messenger dentro dessa sessão — eles são um
  ponto de partida, não uma garantia.
- Isso é automação não-oficial de uma conta pessoal: existe risco real de a
  conta do Facebook ser sinalizada ou suspensa. Veja os avisos no `README.md`.
- Sempre que você alterar `extension/*`, repita o passo de `git clone` +
  `cp` no console do `bridge-chrome` (ou monte uma automação de deploy, se
  preferir) e reinicie o serviço.
