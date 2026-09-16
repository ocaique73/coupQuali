// Funções puras: tempo, baralho, saneamento de entrada. Sem dependências.
const { ROLES } = require("./constants");

function now() {
  return Date.now();
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function makeDeck() {
  const deck = [];
  for (const r of ROLES) deck.push(r, r, r);
  return shuffle(deck);
}
function draw(deck) {
  return deck.pop();
}

// identidade estável do jogador: vem do navegador (sessionStorage) e sobrevive
// a reload e a queda de conexão. socket.id muda a cada conexão; o pid não.
function cleanPid(pid) {
  const s = ("" + (pid ?? "")).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  return s.length >= 8 ? s : null;
}
function randomPid() {
  return (
    "p" +
    Math.random().toString(36).slice(2, 12) +
    Math.random().toString(36).slice(2, 8)
  );
}

// só aceita URL de imagem http(s) — evita javascript:/data: vindo do campo
function safeAvatarUrl(url) {
  const s = ("" + (url ?? "")).trim().slice(0, 500);
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  return s;
}

function roomKeyFromPath(p) {
  if (!p) return "ROOM";
  const raw = ("" + p).replace("/", "").trim();
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
  return cleaned.length ? cleaned : "ROOM";
}

module.exports = {
  now, shuffle, makeDeck, draw,
  cleanPid, randomPid, safeAvatarUrl, roomKeyFromPath,
};
