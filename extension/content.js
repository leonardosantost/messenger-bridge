// ATENÇÃO: o Messenger usa classes CSS geradas/ofuscadas que mudam com frequência.
// Os seletores abaixo são um ponto de partida e muito provavelmente vão precisar
// ser ajustados inspecionando o DOM ao vivo (DevTools > Elements) na sua conta.
// Prefira sempre atributos estáveis (role, aria-label) a classes.
const SELECTORS = {
  // Confirmado inspecionando o DOM real de uma mensagem aberta: cada bolha de
  // mensagem tem data-scope="messages_table" e aria-roledescription="mensagem"
  // — bem mais estável que role="row" (que a lista lateral de conversas
  // também usa, causando falsos positivos antes). O aria-label da mensagem
  // já vem no formato "Às HH:MM, Nome: conteúdo".
  messageRow: '[data-scope="messages_table"]',
  // Lista lateral de conversas (aria-label é traduzido — ajuste se o
  // Messenger estiver em outro idioma, ex: "Chats" em inglês).
  sidebarNav: '[aria-label="Lista de tópicos"]',
  sidebarRow: '[role="row"]',
  unreadMarkerText: 'Mensagem não lida',
  composeBox: '[role="textbox"][contenteditable="true"]',
  threadListLink: 'a[href*="/t/"]',
};

const seenMessages = new Set();

// Sempre que o content script recarrega (restart do container, atualização da
// extensão, etc.), a lista de "já vistas" começa vazia — sem isso, todo o
// histórico ainda visível na tela da conversa aberta seria reportado como
// "mensagem nova" de uma vez. Nos primeiros segundos após carregar, só
// marcamos como vistas (sem reportar); depois disso, tudo funciona normal,
// inclusive conversas novas abertas depois pela navegação automática.
const STARTUP_AT = Date.now();
const WARMUP_MS = 10000;
function isWarmingUp() {
  return Date.now() - STARTUP_AT < WARMUP_MS;
}

// A conexão com o servidor roda aqui no content script (não no service worker
// da extensão) porque o Chrome pode encerrar o service worker do MV3 a
// qualquer momento, mesmo com um WebSocket aberto — ele não conta como
// "atividade" que mantém o processo vivo. O content script, por outro lado,
// vive enquanto essa aba do Messenger estiver aberta, que é exatamente o
// requisito da ponte (o navegador precisa ficar aberto de qualquer forma).
let socket = null;
let authenticated = false;
let wsSettings = { serverUrl: '', token: '' };
const pendingIncoming = [];

async function loadWsSettings() {
  const stored = await chrome.storage.sync.get(['serverUrl', 'token']);
  wsSettings = { serverUrl: stored.serverUrl || '', token: stored.token || '' };
}

function flushPendingIncoming() {
  while (pendingIncoming.length > 0 && authenticated && socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(pendingIncoming.shift()));
  }
}

function connectSocket() {
  if (!wsSettings.serverUrl || !wsSettings.token) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  authenticated = false;
  socket = new WebSocket(wsSettings.serverUrl);

  socket.onopen = () => {
    socket.send(JSON.stringify({ type: 'auth', token: wsSettings.token }));
  };

  socket.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    if (data.type === 'auth_ok') {
      authenticated = true;
      console.log('[messenger-bridge] conectado e autenticado no servidor');
      flushPendingIncoming();
      return;
    }

    if (data.type === 'send_message') {
      sendMessageToThread(data.threadId, data.text);
    }
  };

  socket.onclose = () => {
    socket = null;
    authenticated = false;
    setTimeout(connectSocket, 3000);
  };
  socket.onerror = () => {
    socket?.close();
  };
}

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area !== 'sync') return;
  socket?.close();
  loadWsSettings().then(connectSocket);
});

loadWsSettings().then(connectSocket);

function getThreadIdFromUrl(url) {
  const match = url.match(/\/t\/(\d+)/);
  return match ? match[1] : null;
}

function currentThreadId() {
  return getThreadIdFromUrl(location.pathname);
}

function messageSignature(threadId, row) {
  const messageId = row.getAttribute('data-message-id');
  return messageId ? `${threadId}:${messageId}` : `${threadId}:${row.textContent?.slice(0, 200)}`;
}

// aria-label vem como "Às 17:58, Fulano: conteúdo" (mensagens recentes) ou
// "Às 28 de outubro de 2022 23:57, Fulano: conteúdo" (mensagens antigas, com
// data completa) — por isso o horário é capturado como "tudo até a primeira
// vírgula", não só dígitos/":", senão o ":" de "23:57" quebra a extração do
// remetente. Anexos/figurinhas não têm ":" após o nome; nesse caso retorna
// sender null (usamos um fallback).
function parseAriaLabel(label) {
  const afterTime = label.match(/^Às\s+[^,]+,\s*([\s\S]*)$/);
  const rest = afterTime ? afterTime[1] : label;
  const withSender = rest.match(/^([^:]+):\s*([\s\S]*)$/);
  if (withSender) {
    return { sender: withSender[1].trim(), text: withSender[2].trim() };
  }
  // Mensagens só de anexo (foto/figurinha) não têm ":", ex: "Você enviou uma
  // foto" ou "Fulano enviou uma foto". Sem isso, uma foto enviada por você
  // mesmo não seria reconhecida como própria (sender ficaria null) e a ponte
  // ecoaria ela de volta pro Chatwoot como se fosse do cliente.
  if (/^voc[eê]\b/i.test(rest)) {
    return { sender: 'Você', text: rest.trim() };
  }
  return { sender: null, text: rest.trim() };
}

function isOutgoingSender(sender) {
  return !!sender && /^voc[eê]$/i.test(sender);
}

// Extrai representações em texto de anexos de dentro de uma mensagem (fotos),
// pra pelo menos o link chegar ao Chatwoot — não baixamos/re-hospedamos a
// mídia, só referenciamos a URL original.
function extractAttachmentText(row) {
  const parts = [];
  row.querySelectorAll('a[href*="/messenger_media/"] img').forEach((img) => {
    if (img.src) parts.push(`[Foto] ${img.src}`);
  });
  return parts;
}

// O card de item do Marketplace (quando a conversa vem de um anúncio) não é
// uma mensagem — é um cabeçalho fixo acima da lista de mensagens, o mesmo
// para toda a conversa. Por isso é extraído separado do loop de mensagens,
// buscando fora de qualquer linha de mensagem (SELECTORS.messageRow).
function getMarketplaceItemContext() {
  const link = Array.from(document.querySelectorAll('a[href*="/marketplace/item/"]')).find(
    (a) => !a.closest(SELECTORS.messageRow)
  );
  if (!link) return null;

  const label = (link.textContent || '')
    .replace(/Ver comprador/gi, '')
    .replace(/Mais opções/gi, '')
    .trim();
  return label || null;
}

function reportIncomingMessage(threadId, senderName, text, itemContext) {
  console.log('[messenger-bridge] mensagem recebida detectada:', threadId, senderName, text, itemContext);
  const message = {
    type: 'incoming_message',
    threadId,
    senderId: threadId,
    senderName: senderName || document.title || 'Messenger',
    text,
    itemContext: itemContext || null,
  };

  if (authenticated && socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  } else {
    pendingIncoming.push(message);
    connectSocket();
  }
}

function scanForNewMessages() {
  const threadId = currentThreadId();
  if (!threadId) return;

  const itemContext = getMarketplaceItemContext();
  const rows = document.querySelectorAll(SELECTORS.messageRow);
  rows.forEach((row) => {
    const signature = messageSignature(threadId, row);
    if (seenMessages.has(signature)) return;
    seenMessages.add(signature);

    if (isWarmingUp()) return; // histórico visto logo na inicialização, não reporta

    // Card de "Envie uma resposta rápida" (sugestões pro vendedor tocar) —
    // não é uma mensagem de ninguém, tem aria-label só com o nome do cliente
    // (ex: "Às 19:02, Mariana", sem ":"), o que geraria uma "mensagem" cujo
    // texto é só o nome. Filtra pelo texto do próprio card.
    if (row.textContent?.includes('Envie uma resposta rápida')) return;

    const parsed = parseAriaLabel(row.getAttribute('aria-label') || '');
    if (isOutgoingSender(parsed.sender)) return;

    // Aviso automático do Messenger/Marketplace ("Fulano iniciou esta
    // conversa."), não foi digitado pelo cliente.
    if (/iniciou esta conversa/i.test(parsed.text)) return;

    const text = [parsed.text, ...extractAttachmentText(row)].filter(Boolean).join('\n');
    if (!text) return;

    reportIncomingMessage(threadId, parsed.sender, text, itemContext);
  });
}

// Varre a lista de conversas por itens marcados como "não lidos" e abre o
// primeiro que não seja a conversa já aberta — assim a extensão navega
// sozinha entre conversas com mensagem nova, sem precisar de clique manual.
function openNextUnreadThread() {
  const sidebar = document.querySelector(SELECTORS.sidebarNav);
  if (!sidebar) return;

  const rows = Array.from(sidebar.querySelectorAll(SELECTORS.sidebarRow));
  const unreadRow = rows.find((row) => row.textContent?.includes(SELECTORS.unreadMarkerText));
  if (!unreadRow) return;

  const link = unreadRow.querySelector(SELECTORS.threadListLink);
  const href = link?.getAttribute('href') || '';
  const threadId = getThreadIdFromUrl(href);
  if (!threadId || threadId === currentThreadId()) return;

  console.log('[messenger-bridge] abrindo conversa não lida automaticamente:', threadId);
  link.click();
}

function findThreadLink(threadId) {
  return Array.from(document.querySelectorAll(SELECTORS.threadListLink)).find((link) =>
    link.getAttribute('href')?.includes(`/t/${threadId}`)
  );
}

async function ensureOnThread(threadId) {
  if (currentThreadId() === threadId) return true;

  const link = findThreadLink(threadId);
  if (link) {
    link.click();
  } else {
    location.assign(`https://www.messenger.com/t/${threadId}`);
  }

  // Espera a navegação/SPA atualizar o DOM.
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (currentThreadId() === threadId) return true;
  }
  return currentThreadId() === threadId;
}

async function sendMessageToThread(threadId, text) {
  console.log('[messenger-bridge] comando send_message recebido:', threadId, text);
  const onThread = await ensureOnThread(threadId);
  if (!onThread) {
    console.error('[messenger-bridge] não foi possível abrir a thread', threadId);
    return;
  }

  const box = document.querySelector(SELECTORS.composeBox);
  if (!box) {
    console.error('[messenger-bridge] caixa de mensagem não encontrada — ajuste SELECTORS.composeBox');
    return;
  }

  box.focus();
  document.execCommand('insertText', false, text);
  box.dispatchEvent(new Event('input', { bubbles: true }));

  await new Promise((resolve) => setTimeout(resolve, 100));
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  box.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
}

// O card fixo do item do Marketplace parece carregar um pouco depois do
// resto da conversa (provavelmente busca preço/título numa chamada separada).
// Sem esperar, a primeira mensagem podia ser processada e marcada como
// "vista" antes do card aparecer, ficando sem o contexto do item pra sempre.
// Por isso, em vez de escanear a cada mutação do DOM, aguardamos uma pausa de
// 800ms sem mudanças antes de escanear — dá tempo da página se estabilizar.
let scanTimer = null;
function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scanForNewMessages, 800);
}

const observer = new MutationObserver(() => scheduleScan());
observer.observe(document.body, { childList: true, subtree: true });
scanForNewMessages();

// A cada 5s, se houver conversa não lida diferente da aberta, abre ela.
// Isso permite capturar mensagens de qualquer conversa sem intervenção manual.
setInterval(openNextUnreadThread, 5000);
