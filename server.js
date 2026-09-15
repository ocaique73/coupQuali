const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

app.get(/^\/([A-Za-z0-9]{1,4})?$/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

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

// "Sala" e "fila" sao conjuntos DISJUNTOS: quem esta sentado ocupa uma das 6
// cadeiras; quem chegou com a sala cheia (ou com a partida em andamento) fica
// na fila ate o host puxar.
const MAX_SEATS = 6;
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

function electHost(room) {
  // prefere alguem sentado; so cai para a fila se a sala estiver vazia
  const seated = seatedPlayers(room);
  const pool = seated.length ? seated : connectedPlayers(room);
  room.hostId = pool.length ? pool[0].id : null;
}

// não destrói na hora: marca o momento em que esvaziou. O tick apaga só depois
// de ROOM_GRACE_MS, para que todo mundo possa recarregar sem perder a partida.
function removeRoomIfEmpty(room) {
  room.emptySince = room.players.some((p) => p.connected) ? 0 : now();
}

function actionRequiresClaim(type) {
  return ["tax", "assassinate", "steal", "exchange"].includes(type);
}
function claimRoleForAction(type) {
  switch (type) {
    case "tax":
      return "Duke";
    case "assassinate":
      return "Assassin";
    case "steal":
      return "Captain";
    case "exchange":
      return "Ambassador";
    default:
      return null;
  }
}
function actionBlockInfo(type) {
  if (type === "foreign_aid")
    return { blockable: true, blockers: "any", roles: ["Duke"] };
  if (type === "assassinate")
    return { blockable: true, blockers: "target", roles: ["Contessa"] };
  if (type === "steal")
    return {
      blockable: true,
      blockers: "target",
      roles: ["Captain", "Ambassador"],
    };
  return { blockable: false, blockers: "none", roles: [] };
}

function roomPublicState(room, viewerId) {
  const ig = inGamePlayers(room);
  const currentPlayerId = ig[room.turnIndex]?.id ?? null;

  const pending = room.pendingAction
    ? {
        actorId: room.pendingAction.actorId,
        actorNick: room.pendingAction.actorNick,
        action: room.pendingAction.action,
        claimRole: room.pendingAction.claimRole,
        blockInfo: actionBlockInfo(room.pendingAction.action.type),
        block: room.block
          ? {
              blockerId: room.block.blockerId,
              blockerNick: room.block.blockerNick,
              claimRole: room.block.claimRole,
            }
          : null,
      }
    : null;

  const lossForViewer =
    room.phase === "await_loss" && room.loss?.playerId === viewerId
      ? {
          reason: room.loss.reason,
          aliveCards: findPlayer(room, viewerId)
            ?.hand.map((c, idx) => (c.alive ? { idx, role: c.role } : null))
            .filter(Boolean),
        }
      : null;

  const exchangeForViewer =
    room.phase === "exchange_select" && room.exchange?.actorId === viewerId
      ? {
          options: room.exchange.options,
          keepCount: room.exchange.keepCount,
          endsAt: room.exchange.endsAt,
        }
      : null;

  const reactionResponded = room.phase === "reaction" ? room.reactions : {};
  const blockResponded =
    room.phase === "block_challenge" ? room.blockChallenges : {};

  // sala = so quem esta sentado (nunca quem esta na fila)
  const roomPlayers = seatedPlayers(room).map((p) => ({
    id: p.id,
    nick: p.nick,
    avatar: p.avatar || null,
    ready: !!p.ready,
    inGame: !!p.inGame,
    connected: !!p.connected,
    isHost: p.id === room.hostId,
  }));

  // fila = quem chegou com a sala cheia ou com a partida rolando
  const queue = queuedPlayers(room).map((p) => ({
    id: p.id,
    nick: p.nick,
    avatar: p.avatar || null,
    isHost: p.id === room.hostId,
  }));

  return {
    key: room.key,
    hostId: room.hostId,
    started: room.started,
    phase: room.phase,

    roomPlayers,
    queue,
    seatsFree: Math.max(0, MAX_SEATS - seatedPlayers(room).length),
    maxSeats: MAX_SEATS,

    lobby: lobbyPlayers(room).map((p) => ({
      id: p.id,
      nick: p.nick,
      ready: !!p.ready,
      connected: p.connected,
    })),

    playersInGame: ig.map((p) => ({
      id: p.id,
      nick: p.nick,
      avatar: p.avatar || null,
      coins: p.coins,
      connected: p.connected,
      aliveCount: aliveCount(p),
      hand:
        p.id === viewerId
          ? p.hand.map((c) => ({
              role: c.role,
              alive: c.alive,
              revealed: c.revealed,
            }))
          : p.hand.map((c) => ({
              role: c.alive ? null : c.role,
              alive: c.alive,
              revealed: !c.alive,
            })),
    })),

    currentPlayerId,
    turnEndsAt: room.turnEndsAt,

    pendingAction: pending,

    reactionEndsAt: room.reactionEndsAt,
    reactions: room.phase === "reaction" ? room.reactions : {},
    reactionResponded,

    blockChallengeEndsAt: room.blockChallengeEndsAt,
    blockChallenges:
      room.phase === "block_challenge" ? room.blockChallenges : {},
    blockResponded,

    loss:
      room.phase === "await_loss"
        ? { playerId: room.loss?.playerId, reason: room.loss?.reason }
        : null,
    lossForViewer,

    exchangeForViewer,

    discard: room.discard.slice(-30),
    actionLog: room.actionLog.slice(-80),

    deckCount: room.deck.length,
    winner: room.winner,
    events: room.events.slice(-40),

    paused: room.paused
      ? { byNick: room.paused.byNick, untilAt: room.paused.untilAt }
      : null,
  };
}

function broadcast(room) {
  // p.id é o pid estável; quem recebe o socket é p.socketId
  for (const p of room.players) {
    if (!p.connected || !p.socketId) continue;
    io.to(p.socketId).emit("state", roomPublicState(room, p.id));
  }
}

/* ---------------- pausa (só host, no máximo 3 min) ---------------- */

function isPaused(room) {
  return !!room.paused;
}

function pauseGame(room, byNick) {
  if (!room.started || room.paused) return false;
  room.paused = { at: now(), byNick, untilAt: now() + PAUSE_MAX_MS };
  pushEvent(room, "paused", { byNick, untilAt: room.paused.untilAt });
  addLog(room, `⏸ ${byNick} pausou a partida.`);
  return true;
}

// empurra todos os prazos para frente pelo tempo que ficou pausado,
// senão a pausa consumiria o turno de quem estava jogando
function resumeGame(room, auto) {
  if (!room.paused) return false;
  const delta = now() - room.paused.at;

  if (room.turnEndsAt) room.turnEndsAt += delta;
  if (room.reactionEndsAt) room.reactionEndsAt += delta;
  if (room.blockChallengeEndsAt) room.blockChallengeEndsAt += delta;
  if (room.lossEndsAt) room.lossEndsAt += delta;
  if (room.exchange?.endsAt) room.exchange.endsAt += delta;

  const byNick = room.paused.byNick;
  room.paused = null;
  pushEvent(room, "resumed", { byNick, auto: !!auto });
  addLog(
    room,
    auto ? `▶ Pausa esgotou (3 min). Partida retomada.` : `▶ Partida retomada.`,
  );
  return true;
}

function endToLobby(room, reason) {
  room.started = false;
  room.phase = "lobby";
  room.winner = null;

  room.pendingAction = null;
  room.reactions = {};
  room.block = null;
  room.blockChallenges = {};
  room.loss = null;
  room.exchange = null;

  room.turnIndex = 0;
  room.turnEndsAt = 0;
  room.reactionEndsAt = 0;
  room.blockChallengeEndsAt = 0;
  room.lossEndsAt = 0;

  room.deck = [];
  room.discard = [];

  for (const p of room.players) {
    if (!p.connected) continue;
    p.inGame = false;
    p.ready = false;
    p.coins = 2;
    p.hand = [];
  }

  if (reason) addLog(room, reason);
}

function startGame(room) {
  const seated = seatedPlayers(room);

  if (seated.length < 2)
    return { ok: false, msg: "Precisa de pelo menos 2 jogadores na sala." };
  if (seated.length > MAX_SEATS)
    return { ok: false, msg: `Máximo ${MAX_SEATS} jogadores.` };
  if (!seated.every((p) => p.ready))
    return { ok: false, msg: "Todos na sala precisam estar READY." };

  for (const p of room.players)
    p.inGame = p.connected && p.seated && p.ready;

  room.started = true;
  room.winner = null;
  room.phase = "turn";
  room.deck = makeDeck();
  room.discard = [];
  room.pendingAction = null;
  room.reactions = {};
  room.block = null;
  room.blockChallenges = {};
  room.loss = null;
  room.exchange = null;

  for (const p of inGamePlayers(room)) {
    p.coins = 2;
    p.hand = [
      { role: draw(room.deck), alive: true, revealed: false },
      { role: draw(room.deck), alive: true, revealed: false },
    ];
  }

  room.turnIndex = 0;
  room.turnEndsAt = now() + TURN_MS;

  pushEvent(room, "game_start", {
    playerIds: inGamePlayers(room).map((p) => p.id),
  });

  const first = inGamePlayers(room)[0];
  if (first) pushEvent(room, "turn", { playerId: first.id, nick: first.nick });

  addLog(room, `Partida iniciada!`);
  return { ok: true };
}

function nextAliveIndex(room, startIdx) {
  const ig = inGamePlayers(room);
  const n = ig.length;
  for (let step = 1; step <= n; step++) {
    const idx = (startIdx + step) % n;
    const p = ig[idx];
    if (p && isAlive(p)) return idx;
  }
  return startIdx;
}

function resetToNextTurn(room) {
  room.pendingAction = null;
  room.reactions = {};
  room.block = null;
  room.blockChallenges = {};
  room.loss = null;
  room.exchange = null;

  room.phase = "turn";
  room.turnIndex = nextAliveIndex(room, room.turnIndex);
  room.turnEndsAt = now() + TURN_MS;

  const cur = inGamePlayers(room)[room.turnIndex];
  if (cur) pushEvent(room, "turn", { playerId: cur.id, nick: cur.nick });
}

function checkWin(room) {
  const alive = inGamePlayers(room).filter((p) => isAlive(p));
  if (alive.length === 1 && room.started) {
    const w = alive[0];
    addLog(room, `🏆 ${w.nick} venceu!`);
    pushEvent(room, "winner", { playerId: w.id, nick: w.nick });
    endToLobby(room, `Partida encerrada. Todos voltaram para o lobby.`);
    // definido DEPOIS do endToLobby (que limpa winner): o overlay de vitória
    // precisa sobreviver ao reset da sala, senão ninguém vê quem ganhou.
    room.winner = { playerId: w.id, nick: w.nick, ts: now() };
    return true;
  }
  return false;
}

function requestLoseInfluence(room, playerId, reason, nextFn) {
  room.phase = "await_loss";
  room.loss = { playerId, reason, next: nextFn };
  room.lossEndsAt = now() + CHOICE_MS;
  addLog(room, `Aguardando escolha de carta...`);
}

function killSpecificInfluence(room, player, idx, reason) {
  const c = player.hand[idx];
  if (!c || !c.alive) return false;
  c.alive = false;
  c.revealed = true;
  room.discard.push({
    role: c.role,
    ownerNick: player.nick,
    reason,
    ts: now(),
  });
  pushEvent(room, "card_lost", {
    playerId: player.id,
    nick: player.nick,
    idx,
    role: c.role,
  });
  addLog(room, `${player.nick} perdeu influência (${c.role}).`);

  if (!isAlive(player))
    pushEvent(room, "eliminated", { playerId: player.id, nick: player.nick });

  return true;
}

function actorHasRoleAlive(actor, role) {
  return actor.hand.some((c) => c.alive && c.role === role);
}
function revealAndReplace(room, actor, role) {
  const idx = actor.hand.findIndex((c) => c.alive && c.role === role);
  if (idx < 0) return;
  pushEvent(room, "reveal_replace", {
    playerId: actor.id,
    nick: actor.nick,
    idx,
    role,
  });
  room.deck = shuffle(room.deck.concat([actor.hand[idx].role]));
  actor.hand[idx].role = draw(room.deck);
}

function resolveContest(room, claimedRole, claimedById, challengerId, label) {
  const claimer = findPlayer(room, claimedById);
  const challenger = findPlayer(room, challengerId);
  if (!claimer || !challenger) return { ok: false };

  const has = actorHasRoleAlive(claimer, claimedRole);
  pushEvent(room, "challenge_result", {
    challengerId,
    challengerNick: challenger.nick,
    claimerId: claimedById,
    claimerNick: claimer.nick,
    claimRole: claimedRole,
    bluffCaught: !has,
  });

  if (has) {
    addLog(
      room,
      `${challenger.nick} contestou ${label} e PERDEU (${claimedRole}).`,
    );
    revealAndReplace(room, claimer, claimedRole);
    return { ok: true, loserId: challengerId, actorProved: true };
  } else {
    addLog(room, `${challenger.nick} contestou ${label} e GANHOU.`);
    return { ok: true, loserId: claimedById, actorProved: false };
  }
}

function applyImmediateAction(room, actor, action) {
  const ig = inGamePlayers(room);
  const target = action.targetId
    ? ig.find((p) => p.id === action.targetId)
    : null;

  // regra 10+ moedas: golpe obrigatório
  if (actor.coins >= 10 && action.type !== "coup") {
    addLog(room, `${actor.nick} tinha 10+ moedas: GOLPE obrigatório!`);
    action = {
      type: "coup",
      targetId:
        action.targetId ??
        ig.find((p) => p.id !== actor.id && isAlive(p))?.id ??
        null,
    };
  }

  switch (action.type) {
    case "income":
      actor.coins += 1;
      pushEvent(room, "coins", {
        playerId: actor.id,
        delta: 1,
        reason: "income",
      });
      addLog(room, `${actor.nick} fez RENDA (+1).`);
      return { ok: true };

    case "foreign_aid":
      actor.coins += 2;
      pushEvent(room, "coins", {
        playerId: actor.id,
        delta: 2,
        reason: "foreign_aid",
      });
      addLog(room, `${actor.nick} pediu AJUDA EXTERNA (+2).`);
      return { ok: true };

    case "tax":
      actor.coins += 3;
      pushEvent(room, "coins", {
        playerId: actor.id,
        delta: 3,
        reason: "tax",
      });
      addLog(room, `${actor.nick} TAXOU (+3).`);
      return { ok: true };

    case "steal": {
      if (!target || !isAlive(target))
        return { ok: false };
      const amt = Math.min(2, target.coins);
      target.coins -= amt;
      actor.coins += amt;
      pushEvent(room, "steal", {
        fromId: target.id,
        toId: actor.id,
        amount: amt,
      });
      addLog(room, `${actor.nick} ROUBOU ${amt} de ${target.nick}.`);
      return { ok: true };
    }

    case "assassinate": {
      if (!target || !isAlive(target))
        return { ok: false };
      requestLoseInfluence(
        room,
        target.id,
        `Assassinado por ${actor.nick}.`,
        () => {
          if (!checkWin(room)) resetToNextTurn(room);
        },
      );
      return { ok: true, pendingLoss: true };
    }

    case "exchange": {
      const aliveRoles = actor.hand.filter((c) => c.alive).map((c) => c.role);
      const drawn = [draw(room.deck), draw(room.deck)];
      const options = shuffle(aliveRoles.concat(drawn));
      const keepCount = aliveRoles.length;

      pushEvent(room, "deck_draw", {
        playerId: actor.id,
        nick: actor.nick,
        count: drawn.length,
      });

      room.phase = "exchange_select";
      room.exchange = {
        actorId: actor.id,
        options,
        keepCount,
        endsAt: now() + CHOICE_MS,
        next: () => {
          if (!checkWin(room)) resetToNextTurn(room);
        },
      };
      addLog(room, `${actor.nick} iniciou TROCA (Embaixador).`);
      return { ok: true, pendingExchange: true };
    }

    case "coup": {
      if (!target || !isAlive(target))
        return { ok: false };
      if (actor.coins < 7) return { ok: false };
      actor.coins -= 7;
      pushEvent(room, "coins", {
        playerId: actor.id,
        delta: -7,
        reason: "coup",
      });
      pushEvent(room, "coup", { actorId: actor.id, targetId: target.id });
      addLog(room, `${actor.nick} deu GOLPE em ${target.nick}.`);
      requestLoseInfluence(room, target.id, `Golpe de ${actor.nick}.`, () => {
        if (!checkWin(room)) resetToNextTurn(room);
      });
      return { ok: true, pendingLoss: true };
    }

    default:
      return { ok: false };
  }
}

function continueAfterActionChallenge(room) {
  const pa = room.pendingAction;
  const ig = inGamePlayers(room);
  const actor = ig.find((p) => p.id === pa.actorId);
  if (!actor) {
    resetToNextTurn(room);
    return;
  }

  if (room.block && actionBlockInfo(pa.action.type).blockable) {
    room.phase = "block_challenge";
    room.blockChallenges = {};
    room.blockChallengeEndsAt = now() + RESPONSE_MS;
    addLog(
      room,
      `${room.block.blockerNick} BLOQUEOU (${room.block.claimRole}).`,
    );
    return;
  }

  const result = applyImmediateAction(room, actor, pa.action);
  if (!result.ok) {
    addLog(room, `Ação falhou.`);
    if (!checkWin(room)) resetToNextTurn(room);
    return;
  }
  if (result.pendingLoss || result.pendingExchange) return;
  if (!checkWin(room)) resetToNextTurn(room);
}

function resolveReaction(room) {
  const pa = room.pendingAction;
  if (!pa) return;

  const ig = inGamePlayers(room);
  const actor = ig.find((p) => p.id === pa.actorId);
  if (!actor || !isAlive(actor)) {
    resetToNextTurn(room);
    return;
  }

  for (const p of ig) {
    if (p.id === pa.actorId || !isAlive(p)) continue;
    if (room.reactions[p.id] == null) room.reactions[p.id] = "accept";
  }

  const challengerId =
    Object.entries(room.reactions).find(([, v]) => v === "contest")?.[0] ??
    null;

  if (challengerId && pa.claimRole) {
    const res = resolveContest(
      room,
      pa.claimRole,
      actor.id,
      challengerId,
      `${actor.nick} (${pa.action.type})`,
    );
    requestLoseInfluence(
      room,
      res.loserId,
      `Contestação (${pa.action.type}).`,
      () => {
        if (res.actorProved) continueAfterActionChallenge(room);
        else if (!checkWin(room)) resetToNextTurn(room);
      },
    );
    return;
  }

  continueAfterActionChallenge(room);
}

function resolveBlockChallenge(room) {
  const pa = room.pendingAction;
  if (!pa || !room.block) return;

  const ig = inGamePlayers(room);
  const actor = ig.find((p) => p.id === pa.actorId);
  const blocker = ig.find((p) => p.id === room.block.blockerId);

  for (const p of ig) {
    if (p.id === blocker?.id || !isAlive(p)) continue;
    if (room.blockChallenges[p.id] == null)
      room.blockChallenges[p.id] = "accept";
  }

  const challengerId =
    Object.entries(room.blockChallenges).find(
      ([, v]) => v === "contest",
    )?.[0] ?? null;

  if (challengerId && blocker) {
    const res = resolveContest(
      room,
      room.block.claimRole,
      blocker.id,
      challengerId,
      `${blocker.nick} (bloqueio)`,
    );
    requestLoseInfluence(room, res.loserId, `Contestação do bloqueio.`, () => {
      if (res.actorProved) {
        addLog(room, `Bloqueio confirmado. A ação NÃO acontece.`);
        if (!checkWin(room)) resetToNextTurn(room);
      } else {
        addLog(room, `Bloqueio caiu. A ação segue.`);
        const result = applyImmediateAction(room, actor, pa.action);
        if (result.pendingLoss || result.pendingExchange) return;
        if (!checkWin(room)) resetToNextTurn(room);
      }
    });
    return;
  }

  addLog(room, `Ninguém contestou o bloqueio. A ação NÃO acontece.`);
  if (!checkWin(room)) resetToNextTurn(room);
}

function aliveInGameIdsExcept(room, exceptId) {
  return inGamePlayers(room)
    .filter((p) => p.connected && isAlive(p) && p.id !== exceptId)
    .map((p) => p.id);
}

function shouldResolveReactionNow(room) {
  if (room.phase !== "reaction" || !room.pendingAction) return false;

  // se alguém contestou, resolve na hora (não precisa esperar)
  const anyContest = Object.values(room.reactions).includes("contest");
  if (anyContest) return true;

  // se alguém bloqueou, podemos ir pro próximo estágio assim que todos responderem
  const actorId = room.pendingAction.actorId;
  const required = aliveInGameIdsExcept(room, actorId);

  // “block” conta como resposta
  const allResponded = required.every((id) => room.reactions[id] != null);
  return allResponded;
}

function shouldResolveBlockChallengeNow(room) {
  if (room.phase !== "block_challenge" || !room.pendingAction || !room.block)
    return false;

  const anyContest = Object.values(room.blockChallenges).includes("contest");
  if (anyContest) return true;

  const blockerId = room.block.blockerId;
  const required = aliveInGameIdsExcept(room, blockerId);

  const allResponded = required.every((id) => room.blockChallenges[id] != null);
  return allResponded;
}

function applyExchangeSelection(room, actor, keepRoles) {
  const keepCount = actor.hand.filter((c) => c.alive).length;
  const keep = keepRoles.slice(0, keepCount);

  const pool = room.exchange.options.slice();
  let rest = pool.slice();
  for (const k of keep) {
    const idx = rest.indexOf(k);
    if (idx >= 0) rest.splice(idx, 1);
  }
  room.deck = shuffle(room.deck.concat(rest));

  const aliveSlots = actor.hand
    .map((c, i) => (c.alive ? i : -1))
    .filter((i) => i >= 0);
  for (let i = 0; i < aliveSlots.length; i++)
    actor.hand[aliveSlots[i]].role = keep[i];

  pushEvent(room, "deck_return", {
    playerId: actor.id,
    nick: actor.nick,
    count: rest.length,
  });
  addLog(room, `${actor.nick} concluiu TROCA.`);
}

setInterval(() => {
  for (const room of rooms.values()) {
    // sala vazia expira só depois do período de graça (permite reload geral)
    if (room.emptySince && now() - room.emptySince >= ROOM_GRACE_MS) {
      rooms.delete(room.key);
      continue;
    }

    if (!room.started) continue;

    // pausado: nada de prazo corre. Só o teto de 3 min é verificado.
    if (room.paused) {
      if (now() >= room.paused.untilAt) {
        resumeGame(room, true);
        broadcast(room);
      }
      continue;
    }

    const ig = inGamePlayers(room);
    const current = ig[room.turnIndex];

    // quem está offline não segura o turno por 90s
    if (
      room.phase === "turn" &&
      current &&
      !current.connected &&
      room.turnEndsAt - now() > TURN_MS_OFFLINE
    ) {
      room.turnEndsAt = now() + TURN_MS_OFFLINE;
    }

    if (room.phase === "turn" && now() >= room.turnEndsAt) {
      if (current && isAlive(current)) {
        addLog(room, `${current.nick} não jogou: padrão -> RENDA (+1).`);
        current.coins += 1;
        pushEvent(room, "coins", {
          playerId: current.id,
          delta: 1,
          reason: "timeout_income",
        });
      }
      resetToNextTurn(room);
      broadcast(room);
      continue;
    }

    if (room.phase === "reaction" && now() >= room.reactionEndsAt) {
      resolveReaction(room);
      broadcast(room);
      continue;
    }

    if (
      room.phase === "block_challenge" &&
      now() >= room.blockChallengeEndsAt
    ) {
      resolveBlockChallenge(room);
      broadcast(room);
      continue;
    }

    if (
      room.phase === "await_loss" &&
      room.lossEndsAt &&
      now() >= room.lossEndsAt
    ) {
      const pl = findPlayer(room, room.loss.playerId);
      if (pl) {
        const aliveIdx = pl.hand
          .map((c, i) => (c.alive ? i : -1))
          .filter((i) => i >= 0);
        const pick = aliveIdx[Math.floor(Math.random() * aliveIdx.length)];
        killSpecificInfluence(room, pl, pick, room.loss.reason + " (auto)");
      }
      const next = room.loss?.next;
      room.loss = null;
      room.lossEndsAt = 0;
      if (typeof next === "function") next();
      broadcast(room);
      continue;
    }

    if (
      room.phase === "exchange_select" &&
      room.exchange &&
      now() >= room.exchange.endsAt
    ) {
      const actor = findPlayer(room, room.exchange.actorId);
      if (actor) {
        const keep = room.exchange.options.slice(0, room.exchange.keepCount);
        applyExchangeSelection(room, actor, keep);
        addLog(room, `${actor.nick} não escolheu: TROCA automática.`);
      }
      const next = room.exchange?.next;
      room.exchange = null;
      if (typeof next === "function") next();
      broadcast(room);
      continue;
    }
  }
}, 250);

io.on("connection", (socket) => {
  let joinedRoomKey = null;
  let myPid = null; // identidade estável desta aba (não muda ao reconectar)

  socket.on("join", ({ roomKey, nick, pid, avatar }) => {
    const key = roomKeyFromPath(roomKey);
    const room = getRoom(key);
    joinedRoomKey = key;

    const cleanNick = (nick ?? "").toString().trim().slice(0, 20) || "Jogador";
    const cleanAvatar = safeAvatarUrl(avatar);

    myPid = cleanPid(pid) || randomPid();

    // reconexão: se já existe alguém com esse pid, ele volta para o MESMO
    // lugar (cadeira, mão, moedas, vez) em vez de virar um jogador novo
    let p = findPlayer(room, myPid);
    const reconnecting = !!p;

    if (!p) {
      // senta se houver cadeira livre E a partida nao tiver comecado;
      // caso contrario vai para a fila e espera o host puxar
      const canSit = !room.started && seatedPlayers(room).length < MAX_SEATS;

      p = {
        id: myPid,
        socketId: socket.id,
        nick: cleanNick,
        avatar: cleanAvatar,
        connected: true,
        seated: canSit,
        ready: false,
        inGame: false,
        coins: 2,
        hand: [],
      };
      room.players.push(p);
      addLog(
        room,
        canSit
          ? `${cleanNick} entrou na sala.`
          : `${cleanNick} entrou na FILA (${room.started ? "partida em andamento" : "sala cheia"}).`,
      );
    } else {
      p.socketId = socket.id;
      p.nick = cleanNick;
      p.avatar = cleanAvatar;
      const wasOffline = !p.connected;
      p.connected = true;
      if (wasOffline) {
        addLog(room, `🔌 ${cleanNick} reconectou.`);
        pushEvent(room, "reconnected", { playerId: p.id, nick: cleanNick });
      }
    }

    if (!room.hostId) room.hostId = p.id;
    room.emptySince = 0;

    socket.join(key);
    socket.emit("me", { pid: myPid, reconnected: reconnecting });
    broadcast(room);
  });

  socket.on("toggle_ready", () => {
    if (!joinedRoomKey) return;
    const room = getRoom(joinedRoomKey);
    const p = findPlayer(room, myPid);
    if (!p || !p.connected) return;

    // não mexe ready durante jogo, e quem está na fila não fica READY
    if (room.started) return;
    if (!p.seated) return;

    p.ready = !p.ready;
    addLog(room, `${p.nick} está ${p.ready ? "READY" : "NOT READY"}.`);
    broadcast(room);
  });

  socket.on("start", () => {
    if (!joinedRoomKey) return;
    const room = getRoom(joinedRoomKey);
    if (myPid !== room.hostId) return;
    if (room.started) return;

    const res = startGame(room);
    if (!res.ok) addLog(room, res.msg);
    broadcast(room);
  });

  // host puxa alguem da fila para uma cadeira livre
  socket.on("promote", ({ playerId }) => {
    if (!joinedRoomKey) return;
    const room = getRoom(joinedRoomKey);
    if (myPid !== room.hostId) return;
    if (room.started) return;
    if (seatedPlayers(room).length >= MAX_SEATS) return;

    const p = findPlayer(room, playerId);
    if (!p || !p.connected || p.seated) return;

    p.seated = true;
    p.ready = false;
    addLog(room, `${p.nick} foi puxado da fila para a sala.`);
    broadcast(room);
  });

  // host manda alguem da sala de volta para a fila
  socket.on("demote", ({ playerId }) => {
    if (!joinedRoomKey) return;
    const room = getRoom(joinedRoomKey);
    if (myPid !== room.hostId) return;
    if (room.started) return;

    const p = findPlayer(room, playerId);
    if (!p || !p.connected || !p.seated) return;

    p.seated = false;
    p.ready = false;
    addLog(room, `${p.nick} voltou para a fila.`);
    broadcast(room);
  });

  socket.on("pause", () => {
    if (!joinedRoomKey) return;
    const room = getRoom(joinedRoomKey);
    if (myPid !== room.hostId) return;
    const p = findPlayer(room, myPid);
    if (!p) return;
    if (pauseGame(room, p.nick)) broadcast(room);
  });

  socket.on("resume", () => {
    if (!joinedRoomKey) return;
    const room = getRoom(joinedRoomKey);
    if (myPid !== room.hostId) return;
    if (resumeGame(room, false)) broadcast(room);
  });

  socket.on("restart", () => {
    if (!joinedRoomKey) return;
    const room = getRoom(joinedRoomKey);
    if (myPid !== room.hostId) return;
    if (!room.started) return;

    endToLobby(room, `Host reiniciou a sala.`);
    broadcast(room);
  });

  socket.on("action", ({ type, targetId }) => {
    if (!joinedRoomKey) return;
    const room = getRoom(joinedRoomKey);
    if (!room.started || isPaused(room) || room.phase !== "turn") return;

    const ig = inGamePlayers(room);
    const actor = ig[room.turnIndex];
    if (!actor || actor.id !== myPid || !isAlive(actor)) return;

    const action = { type, targetId: targetId ?? null };
    const claimRole = actionRequiresClaim(type)
      ? claimRoleForAction(type)
      : null;

    if (type === "assassinate") {
      if (actor.coins < 3) {
        addLog(room, `Assassinato falhou: moedas insuficientes.`);
        broadcast(room);
        return;
      }
      actor.coins -= 3;
      pushEvent(room, "coins", {
        playerId: actor.id,
        delta: -3,
        reason: "assassinate",
      });
      addLog(room, `${actor.nick} pagou 3 para ASSASSINAR.`);
    }

    if (type === "coup") {
      const res = applyImmediateAction(room, actor, action);
      if (!res.ok) addLog(room, `Golpe falhou.`);
      broadcast(room);
      return;
    }

    room.pendingAction = {
      actorId: actor.id,
      actorNick: actor.nick,
      action,
      claimRole,
      declaredAt: now(),
    };
    room.phase = "reaction";
    room.reactions = {};
    room.block = null;
    room.reactionEndsAt = now() + RESPONSE_MS;

    pushEvent(room, "action_declared", {
      actorId: actor.id,
      actorNick: actor.nick,
      actionType: type,
      targetId: action.targetId,
      claimRole,
    });
    addLog(room, `${actor.nick} declarou: ${type.toUpperCase()}.`);
    broadcast(room);
  });

  socket.on("react", ({ decision }) => {
    if (!joinedRoomKey) return;
    const room = getRoom(joinedRoomKey);
    if (!room.started || isPaused(room) || room.phase !== "reaction") return;

    const pa = room.pendingAction;
    if (!pa || myPid === pa.actorId) return;

    const p = findPlayer(room, myPid);
    if (!p || !p.inGame || !isAlive(p)) return;

    if (!["accept", "contest"].includes(decision)) return;

    if (room.reactions[myPid] == null) {
      room.reactions[myPid] = decision;
      addLog(
        room,
        `${p.nick}: ${decision === "accept" ? "ACEITA" : "CONTESTA"}.`,
      );

      if (shouldResolveReactionNow(room)) {
        resolveReaction(room);
      }

      broadcast(room);
    }
  });

  socket.on("block", ({ role }) => {
    if (!joinedRoomKey) return;
    const room = getRoom(joinedRoomKey);
    if (!room.started || isPaused(room) || room.phase !== "reaction") return;

    const pa = room.pendingAction;
    if (!pa || myPid === pa.actorId) return;

    const p = findPlayer(room, myPid);
    if (!p || !p.inGame || !isAlive(p)) return;

    const info = actionBlockInfo(pa.action.type);
    if (!info.blockable || room.block) return;

    if (info.blockers === "target") {
      if (!pa.action.targetId || myPid !== pa.action.targetId) return;
    }

    const picked = (role || "").toString();
    const claimRole = info.roles.includes(picked) ? picked : info.roles[0];

    room.block = { blockerId: p.id, blockerNick: p.nick, claimRole };
    room.reactions[p.id] = "block";
    pushEvent(room, "block", {
      blockerId: p.id,
      blockerNick: p.nick,
      claimRole,
    });
    addLog(room, `${p.nick} BLOQUEOU (${claimRole}).`);

    if (shouldResolveReactionNow(room)) {
      resolveReaction(room);
    }

    broadcast(room);
  });

  socket.on("block_challenge", ({ decision }) => {
    if (!joinedRoomKey) return;
    const room = getRoom(joinedRoomKey);
    if (!room.started || isPaused(room) || room.phase !== "block_challenge") return;

    if (!room.block || myPid === room.block.blockerId) return;

    const p = findPlayer(room, myPid);
    if (!p || !p.inGame || !isAlive(p)) return;

    if (!["accept", "contest"].includes(decision)) return;

    if (room.blockChallenges[myPid] == null) {
      room.blockChallenges[myPid] = decision;
      addLog(
        room,
        `${p.nick}: ${decision === "accept" ? "ACEITA" : "CONTESTA"} o bloqueio.`,
      );

      if (shouldResolveBlockChallengeNow(room)) {
        resolveBlockChallenge(room);
      }

      broadcast(room);
    }
  });

  socket.on("lose_influence", ({ cardIdx }) => {
    if (!joinedRoomKey) return;
    const room = getRoom(joinedRoomKey);
    if (!room.started || isPaused(room) || room.phase !== "await_loss") return;

    const loss = room.loss;
    if (!loss || loss.playerId !== myPid) return;

    const p = findPlayer(room, myPid);
    if (!p) return;

    const idx = Number(cardIdx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= p.hand.length) return;
    if (!p.hand[idx].alive) return;

    killSpecificInfluence(room, p, idx, loss.reason);

    const next = loss.next;
    room.loss = null;
    room.lossEndsAt = 0;
    if (typeof next === "function") next();
    broadcast(room);
  });

  socket.on("exchange_pick", ({ keep }) => {
    if (!joinedRoomKey) return;
    const room = getRoom(joinedRoomKey);
    if (!room.started || isPaused(room) || room.phase !== "exchange_select") return;

    if (!room.exchange || room.exchange.actorId !== myPid) return;

    const actor = findPlayer(room, myPid);
    if (!actor) return;

    const keepArr = Array.isArray(keep) ? keep.map(String) : [];
    const keepCount = room.exchange.keepCount;

    const pool = room.exchange.options.slice();
    const chosen = [];
    for (const k of keepArr.slice(0, keepCount)) {
      const i = pool.indexOf(k);
      if (i >= 0) {
        chosen.push(k);
        pool.splice(i, 1);
      }
    }
    if (chosen.length !== keepCount) return;

    applyExchangeSelection(room, actor, chosen);

    const next = room.exchange.next;
    room.exchange = null;
    if (typeof next === "function") next();
    broadcast(room);
  });

  socket.on("disconnect", () => {
    if (!joinedRoomKey) return;
    const room = getRoom(joinedRoomKey);
    const p = findPlayer(room, myPid);
    if (!p) return;

    p.connected = false;
    p.socketId = null;

    if (p.inGame) {
      // não perde a vez, a mão nem a cadeira — pode voltar
      addLog(room, `🔌 ${p.nick} caiu (pode reconectar).`);
      pushEvent(room, "disconnected", { playerId: p.id, nick: p.nick });
    } else {
      addLog(room, `${p.nick} saiu.`);
    }

    if (room.hostId === myPid) {
      electHost(room);
      if (room.hostId)
        addLog(
          room,
          `Novo host: ${findPlayer(room, room.hostId)?.nick ?? "?"}`,
        );
    }

    broadcast(room);
    removeRoomIfEmpty(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on", PORT));
