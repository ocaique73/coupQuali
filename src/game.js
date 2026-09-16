// O jogo em si: pausa, início/fim de partida, turnos, contestações,
// bloqueios, troca e vitória. Muta a sala; quem chama é que faz o broadcast.
const { now, shuffle, makeDeck, draw } = require("./util");
const {
  TURN_MS, RESPONSE_MS, CHOICE_MS, PAUSE_MAX_MS, MAX_SEATS,
} = require("./constants");
const {
  addLog, pushEvent, findPlayer,
  seatedPlayers, inGamePlayers, isAlive,
} = require("./rooms");
const { actionBlockInfo } = require("./rules");

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

  // Reseta TODO mundo, inclusive quem está offline. Antes havia um
  // `if (!p.connected) continue` aqui: quem tinha caído durante a partida
  // ficava com inGame = true para sempre, aparecia na mesa depois do fim,
  // segurava uma cadeira e ainda surgia para quem entrasse na sala depois.
  for (const p of room.players) {
    p.inGame = false;
    p.ready = false;
    p.coins = 2;
    p.hand = [];
  }

  // Acabada a partida, quem está desconectado não tem mais nada a preservar
  // (mão, moedas e vez já foram zeradas): sai da sala e libera a cadeira.
  room.players = room.players.filter((p) => p.connected);

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

  // Quem começa é SORTEADO. Com turnIndex fixo em 0 o host saía sempre na
  // frente, o que dá vantagem e cansa.
  room.turnIndex = Math.floor(Math.random() * inGamePlayers(room).length);
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

module.exports = {
  isPaused, pauseGame, resumeGame,
  endToLobby, startGame, nextAliveIndex, resetToNextTurn, checkWin,
  requestLoseInfluence, killSpecificInfluence,
  actorHasRoleAlive, revealAndReplace, resolveContest,
  applyImmediateAction, continueAfterActionChallenge,
  resolveReaction, resolveBlockChallenge,
  aliveInGameIdsExcept, shouldResolveReactionNow, shouldResolveBlockChallengeNow,
  applyExchangeSelection,
};
