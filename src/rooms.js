// O armazém das salas e os recortes de jogadores (sentados, fila, em jogo).
// É aqui que mora o estado mutável do servidor.
const { now } = require("./util");
const {
  DEFAULT_THEME, MAX_SEATS, PLAYER_COLORS, SKINS,
} = require("./constants");

const rooms = new Map();
function getRoom(key) {
  if (!rooms.has(key)) {
    rooms.set(key, {
      key,
      hostId: null,
      started: false,
      players: [],

      deck: [],
      discard: [],

      turnIndex: 0,
      turnEndsAt: 0,

      phase: "lobby",
      pendingAction: null,

      reactionEndsAt: 0,
      reactions: {},
      block: null,

      blockChallengeEndsAt: 0,
      blockChallenges: {},

      loss: null,
      lossEndsAt: 0,

      exchange: null,

      actionLog: [],

      events: [],
      eventSeq: 0,
      winner: null,

      paused: null, // { at, byNick, untilAt }
      emptySince: 0,
      theme: DEFAULT_THEME,
    });
  }
  return rooms.get(key);
}

function addLog(room, text) {
  room.actionLog.push({ ts: now(), text });
}

// Eventos estruturados: o cliente usa isso para saber O QUE aconteceu
// (e animar), em vez de tentar adivinhar a partir do diff de estado.
function pushEvent(room, type, data) {
  room.eventSeq += 1;
  room.events.push({ seq: room.eventSeq, ts: now(), type, ...data });
  if (room.events.length > 200) room.events.splice(0, room.events.length - 200);
}

function findPlayer(room, id) {
  return room.players.find((p) => p.id === id);
}

function connectedPlayers(room) {
  return room.players.filter((p) => p.connected);
}

// quem caiu no meio da partida NÃO perde a cadeira — pode voltar
function seatedPlayers(room) {
  return room.players.filter((p) => p.seated && (p.connected || p.inGame));
}
function queuedPlayers(room) {
  return room.players.filter((p) => p.connected && !p.seated);
}
function lobbyPlayers(room) {
  return room.players.filter((p) => p.connected && p.seated && !p.inGame);
}
// NÃO filtra por connected: quem caiu continua na partida e pode voltar.
// Se filtrasse, os índices de turno mudariam no meio do jogo e a vez pularia
// para a pessoa errada.
function inGamePlayers(room) {
  return room.players.filter((p) => p.inGame);
}

function isAlive(p) {
  return (p.hand || []).some((c) => c.alive);
}
function aliveCount(p) {
  return (p.hand || []).filter((c) => c.alive).length;
}

// dá ao jogador a menor cor livre entre quem está sentado, para dois vizinhos
// nunca ficarem com o mesmo contorno
// Aparência inicial: varia por cor para a mesa não nascer com clones.
function defaultAppearance(colorIdx) {
  return {
    shirt: colorIdx % 2 ? "long" : "short",
    body: "thin",
    skin: colorIdx % SKINS,
    prop: colorIdx % 3 === 0 ? "smoke" : "none",
  };
}

// Cores em uso pelos OUTROS jogadores da sala (para ninguém repetir).
function takenColors(room, except) {
  return new Set(
    room.players
      .filter((x) => x !== except && x.seated && (x.connected || x.inGame))
      .map((x) => x.color),
  );
}

function colorFree(room, p, idx) {
  return !takenColors(room, p).has(idx);
}

function assignColor(room, p) {
  const used = new Set(
    room.players
      .filter((x) => x !== p && x.seated && (x.connected || x.inGame))
      .map((x) => x.color),
  );
  for (let i = 0; i < PLAYER_COLORS; i++) {
    if (!used.has(i)) {
      p.color = i;
      return;
    }
  }
  p.color = 0;
}

// O host TEM de estar online: se ficar com quem caiu, ninguém consegue
// iniciar, pausar ou reiniciar a sala. Prefere alguém sentado; só recorre à
// fila se não houver ninguém sentado e online.
function electHost(room) {
  const seatedOnline = room.players.filter((p) => p.connected && p.seated);
  const pool = seatedOnline.length ? seatedOnline : connectedPlayers(room);
  room.hostId = pool.length ? pool[0].id : null;
  return room.hostId;
}

// Re-elege sempre que o host atual sumiu ou caiu. Chamado a cada entrada e
// saída, porque o host pode ficar órfão sem ser ele o que desconectou.
function ensureHost(room) {
  const h = room.hostId ? findPlayer(room, room.hostId) : null;
  if (h && h.connected) return null;
  const antes = room.hostId;
  electHost(room);
  return room.hostId && room.hostId !== antes ? room.hostId : null;
}

// não destrói na hora: marca o momento em que esvaziou. O tick apaga só depois
// de ROOM_GRACE_MS, para que todo mundo possa recarregar sem perder a partida.
function removeRoomIfEmpty(room) {
  room.emptySince = room.players.some((p) => p.connected) ? 0 : now();
}

module.exports = {
  rooms, getRoom, addLog, pushEvent, findPlayer,
  connectedPlayers, seatedPlayers, queuedPlayers, lobbyPlayers, inGamePlayers,
  isAlive, aliveCount, assignColor, electHost, ensureHost, removeRoomIfEmpty,
  defaultAppearance, takenColors, colorFree,
  MAX_SEATS,
};
