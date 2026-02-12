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
    });
  }
  return rooms.get(key);
}

function addLog(room, text) {
  room.actionLog.push({ ts: now(), text });
}

function findPlayer(room, id) {
  return room.players.find((p) => p.id === id);
}

function connectedPlayers(room) {
  return room.players.filter((p) => p.connected);
}
function lobbyPlayers(room) {
  return room.players.filter((p) => p.connected && !p.inGame);
}
function inGamePlayers(room) {
  return room.players.filter((p) => p.connected && p.inGame);
}

function isAlive(p) {
  return (p.hand || []).some((c) => c.alive);
}
function aliveCount(p) {
  return (p.hand || []).filter((c) => c.alive).length;
}

function electHost(room) {
  const conn = connectedPlayers(room);
  room.hostId = conn.length ? conn[0].id : null;
}

function removeRoomIfEmpty(room) {
  if (!room.players.some((p) => p.connected)) rooms.delete(room.key);
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

  // lista completa (isso resolve seu painel esquerdo “pessoas na sala”)
  const roomPlayers = connectedPlayers(room).map((p) => ({
    id: p.id,
    nick: p.nick,
    ready: !!p.ready,
    inGame: !!p.inGame,
    isHost: p.id === room.hostId,
  }));

  return {
    key: room.key,
    hostId: room.hostId,
    started: room.started,
    phase: room.phase,

    roomPlayers, // <<< NOVO
    lobby: lobbyPlayers(room).map((p) => ({
      id: p.id,
      nick: p.nick,
      ready: !!p.ready,
      connected: p.connected,
    })),

    playersInGame: ig.map((p) => ({
      id: p.id,
      nick: p.nick,
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
  };
}

function broadcast(room) {
  for (const p of room.players)
    io.to(p.id).emit("state", roomPublicState(room, p.id));
}

function endToLobby(room, reason) {
  room.started = false;
  room.phase = "lobby";

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
  const lobby = lobbyPlayers(room);

  if (lobby.length < 2)
    return { ok: false, msg: "Precisa de pelo menos 2 jogadores." };
  if (lobby.length > 6) return { ok: false, msg: "Máximo 6 jogadores." };
  if (!lobby.every((p) => p.ready))
    return { ok: false, msg: "Todos precisam estar READY." };

  for (const p of room.players) p.inGame = p.connected && p.ready;

  room.started = true;
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

  addLog(room, `Partida iniciada!`);
  return { ok: true };
}

function nextAliveIndex(room, startIdx) {
  const ig = inGamePlayers(room);
  const n = ig.length;
  for (let step = 1; step <= n; step++) {
    const idx = (startIdx + step) % n;
    const p = ig[idx];
    if (p && p.connected && isAlive(p)) return idx;
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
}

function checkWin(room) {
  const alive = inGamePlayers(room).filter((p) => isAlive(p));
  if (alive.length === 1 && room.started) {
    addLog(room, `🏆 ${alive[0].nick} venceu!`);
    endToLobby(room, `Partida encerrada. Todos voltaram para o lobby.`);
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
  addLog(room, `${player.nick} perdeu influência (${c.role}).`);
  return true;
}

function actorHasRoleAlive(actor, role) {
  return actor.hand.some((c) => c.alive && c.role === role);
}
function revealAndReplace(room, actor, role) {
  const idx = actor.hand.findIndex((c) => c.alive && c.role === role);
  if (idx < 0) return;
  room.deck = shuffle(room.deck.concat([actor.hand[idx].role]));
  actor.hand[idx].role = draw(room.deck);
}

function resolveContest(room, claimedRole, claimedById, challengerId, label) {
  const claimer = findPlayer(room, claimedById);
  const challenger = findPlayer(room, challengerId);
  if (!claimer || !challenger) return { ok: false };

  const has = actorHasRoleAlive(claimer, claimedRole);
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
      addLog(room, `${actor.nick} fez RENDA (+1).`);
      return { ok: true };

    case "foreign_aid":
      actor.coins += 2;
      addLog(room, `${actor.nick} pediu AJUDA EXTERNA (+2).`);
      return { ok: true };

    case "tax":
      actor.coins += 3;
      addLog(room, `${actor.nick} TAXOU (+3).`);
      return { ok: true };

    case "steal": {
      if (!target || !target.connected || !isAlive(target))
        return { ok: false };
      const amt = Math.min(2, target.coins);
      target.coins -= amt;
      actor.coins += amt;
      addLog(room, `${actor.nick} ROUBOU ${amt} de ${target.nick}.`);
      return { ok: true };
    }

    case "assassinate": {
      if (!target || !target.connected || !isAlive(target))
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
      if (!target || !target.connected || !isAlive(target))
        return { ok: false };
      if (actor.coins < 7) return { ok: false };
      actor.coins -= 7;
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

  addLog(room, `${actor.nick} concluiu TROCA.`);
}

setInterval(() => {
  for (const room of rooms.values()) {
    if (!room.started) continue;

    const ig = inGamePlayers(room);
    const current = ig[room.turnIndex];

    if (room.phase === "turn" && now() >= room.turnEndsAt) {
      if (current && current.connected && isAlive(current)) {
        addLog(room, `${current.nick} não jogou: padrão -> RENDA (+1).`);
        current.coins += 1;
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

  socket.on("join", ({ roomKey, nick }) => {
    const key = roomKeyFromPath(roomKey);
    const room = getRoom(key);
    joinedRoomKey = key;

    const cleanNick = (nick ?? "").toString().trim().slice(0, 20) || "Jogador";

    let p = findPlayer(room, socket.id);
    if (!p) {
      p = {
        id: socket.id,
        nick: cleanNick,
        connected: true,
        ready: false,
        inGame: false,
        coins: 2,
        hand: [],
      };
      room.players.push(p);
    } else {
      p.nick = cleanNick;
      p.connected = true;
    }

    if (!room.hostId) room.hostId = socket.id;

    socket.join(key);
    addLog(room, `${cleanNick} entrou na sala.`);
    broadcast(room);
  });

  socket.on("toggle_ready", () => {
    if (!joinedRoomKey) return;
    const room = getRoom(joinedRoomKey);
    const p = findPlayer(room, socket.id);
    if (!p || !p.connected) return;

    // não mexe ready durante jogo
    if (room.started) return;

    p.ready = !p.ready;
    addLog(room, `${p.nick} está ${p.ready ? "READY" : "NOT READY"}.`);
    broadcast(room);
  });

  socket.on("start", () => {
    if (!joinedRoomKey) return;
    const room = getRoom(joinedRoomKey);
    if (socket.id !== room.hostId) return;
    if (room.started) return;

    const res = startGame(room);
    if (!res.ok) addLog(room, res.msg);
    broadcast(room);
  });

  socket.on("restart", () => {
    if (!joinedRoomKey) return;
    const room = getRoom(joinedRoomKey);
    if (socket.id !== room.hostId) return;
    if (!room.started) return;

    endToLobby(room, `Host reiniciou a sala.`);
    broadcast(room);
  });

  socket.on("action", ({ type, targetId }) => {
    if (!joinedRoomKey) return;
    const room = getRoom(joinedRoomKey);
    if (!room.started || room.phase !== "turn") return;

    const ig = inGamePlayers(room);
    const actor = ig[room.turnIndex];
    if (!actor || actor.id !== socket.id || !isAlive(actor)) return;

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

    addLog(room, `${actor.nick} declarou: ${type.toUpperCase()}.`);
    broadcast(room);
  });

  socket.on("react", ({ decision }) => {
    if (!joinedRoomKey) return;
    const room = getRoom(joinedRoomKey);
    if (!room.started || room.phase !== "reaction") return;

    const pa = room.pendingAction;
    if (!pa || socket.id === pa.actorId) return;

    const p = findPlayer(room, socket.id);
    if (!p || !p.inGame || !isAlive(p)) return;

    if (!["accept", "contest"].includes(decision)) return;

    if (room.reactions[socket.id] == null) {
      room.reactions[socket.id] = decision;
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
    if (!room.started || room.phase !== "reaction") return;

    const pa = room.pendingAction;
    if (!pa || socket.id === pa.actorId) return;

    const p = findPlayer(room, socket.id);
    if (!p || !p.inGame || !isAlive(p)) return;

    const info = actionBlockInfo(pa.action.type);
    if (!info.blockable || room.block) return;

    if (info.blockers === "target") {
      if (!pa.action.targetId || socket.id !== pa.action.targetId) return;
    }

    const picked = (role || "").toString();
    const claimRole = info.roles.includes(picked) ? picked : info.roles[0];

    room.block = { blockerId: p.id, blockerNick: p.nick, claimRole };
    room.reactions[p.id] = "block";
    addLog(room, `${p.nick} BLOQUEOU (${claimRole}).`);

    if (shouldResolveReactionNow(room)) {
      resolveReaction(room);
    }

    broadcast(room);
  });

  socket.on("block_challenge", ({ decision }) => {
    if (!joinedRoomKey) return;
    const room = getRoom(joinedRoomKey);
    if (!room.started || room.phase !== "block_challenge") return;

    if (!room.block || socket.id === room.block.blockerId) return;

    const p = findPlayer(room, socket.id);
    if (!p || !p.inGame || !isAlive(p)) return;

    if (!["accept", "contest"].includes(decision)) return;

    if (room.blockChallenges[socket.id] == null) {
      room.blockChallenges[socket.id] = decision;
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
    if (!room.started || room.phase !== "await_loss") return;

    const loss = room.loss;
    if (!loss || loss.playerId !== socket.id) return;

    const p = findPlayer(room, socket.id);
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
    if (!room.started || room.phase !== "exchange_select") return;

    if (!room.exchange || room.exchange.actorId !== socket.id) return;

    const actor = findPlayer(room, socket.id);
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
    const p = findPlayer(room, socket.id);
    if (!p) return;

    p.connected = false;
    addLog(room, `${p.nick} saiu.`);

    if (room.hostId === socket.id) {
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
