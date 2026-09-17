// Números e listas que o jogo inteiro usa. Sem dependências.

const TURN_MS = 90_000;
const RESPONSE_MS = 90_000;
const CHOICE_MS = 90_000;

// turno encurtado quando o jogador da vez está desconectado, para a partida
// não travar 90s por rodada esperando alguém que caiu
const TURN_MS_OFFLINE = 20_000;

// pausa do host
const PAUSE_MAX_MS = 3 * 60_000;

// a sala só é destruída depois desse tempo sem ninguém conectado —
// é o que permite todo mundo recarregar ao mesmo tempo sem perder a partida
const ROOM_GRACE_MS = 10 * 60_000;

const ROLES = ["Duke", "Assassin", "Captain", "Ambassador", "Contessa"];

// "Sala" e "fila" são conjuntos DISJUNTOS: quem está sentado ocupa uma das
// 6 cadeiras; quem chegou com a sala cheia (ou com a partida em andamento)
// fica na fila até o host puxar.
const MAX_SEATS = 6;

// cada jogador ganha uma cor própria (contorno do card na mesa)
const PLAYER_COLORS = 6;

// temas: trocam a arte das cartas e as cores da mesa/painéis
// Aparência do personagem 3D. Valores validados no servidor — o cliente
// não manda nada fora destas listas.
const SHIRTS = ["short", "long"];
const BODIES = ["thin", "fat"];
const SKINS = 6; // índices 0..5, do mais claro ao mais escuro
const PROPS = ["none", "smoke"];
const HEADS = ["hair", "bald", "cap", "cowboy"];

const THEMES = ["politica", "qualitas"];
const DEFAULT_THEME = "politica";

// chat
const CHAT_MAX = 150;
const CHAT_MIN_MS = 1200; // anti-spam
const EMOTE_MIN_MS = 1500;
const EMOTES = new Set([
  "bang",
  "finger",
  "clap",
  "laugh",
  "think",
  "lie",
  "thumbs",
  "sweat",
  "l13",
]);

module.exports = {
  TURN_MS, RESPONSE_MS, CHOICE_MS, TURN_MS_OFFLINE,
  PAUSE_MAX_MS, ROOM_GRACE_MS,
  ROLES, MAX_SEATS, PLAYER_COLORS,
  THEMES, DEFAULT_THEME,
  SHIRTS, BODIES, SKINS, PROPS, HEADS,
  CHAT_MAX, CHAT_MIN_MS, EMOTE_MIN_MS, EMOTES,
};
