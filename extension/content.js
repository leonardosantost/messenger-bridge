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

// aria-label vem como "Às 17:58, Fulano: conteúdo" (mensagens com texto) ou
// só "Às 17:58, Fulano enviou uma figurinha" (anexos, sem ":"). Extrai o que
// der; se não achar remetente, retorna sender null (usamos um fallback).
function parseAriaLabel(label) {
  const afterTime = label.match(/^Às\s+[\d:]+,\s*([\s\S]*)$/);
  const rest = afterTime ? afterTime[1] : label;
  const withSender = rest.match(/^([^:]+):\s*([\s\S]*)$/);
  if (withSender) {
    return { sender: withSender[1].trim(), text: withSender[2].trim() };
  }
  return { sender: null, text: rest.trim() };
}

function isOutgoingSender(sender) {
  return !!sender && /^voc[eê]$/i.test(sender);
}

function reportIncomingMessage(threadId, senderName, text) {
  console.log('[messenger-bridge] mensagem recebida detectada:', threadId, senderName, text);
  chrome.runtime.sendMessage({
    type: 'incoming_message',
    threadId,
    senderId: threadId,
    senderName: senderName || document.title || 'Messenger',
    text,
  });
}

function scanForNewMessages() {
  const threadId = currentThreadId();
  if (!threadId) return;

  const rows = document.querySelectorAll(SELECTORS.messageRow);
  rows.forEach((row) => {
    const parsed = parseAriaLabel(row.getAttribute('aria-label') || '');
    if (!parsed.text || isOutgoingSender(parsed.sender)) return;

    const signature = messageSignature(threadId, row);
    if (seenMessages.has(signature)) return;
    seenMessages.add(signature);

    reportIncomingMessage(threadId, parsed.sender, parsed.text);
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

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'send_message') {
    sendMessageToThread(message.threadId, message.text);
  }
});

const observer = new MutationObserver(() => scanForNewMessages());
observer.observe(document.body, { childList: true, subtree: true });
scanForNewMessages();

// A cada 5s, se houver conversa não lida diferente da aberta, abre ela.
// Isso permite capturar mensagens de qualquer conversa sem intervenção manual.
setInterval(openNextUnreadThread, 5000);
