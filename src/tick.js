// O relógio do servidor: expira salas vazias, respeita a pausa e resolve
// prazos vencidos (turno, resposta, bloqueio, escolha de carta e troca).
const { now } = require("./util");
const { ROOM_GRACE_MS, TURN_MS_OFFLINE, CHOICE_MS } = require("./constants");
const {
  rooms, findPlayer, inGamePlayers, addLog, pushEvent, isAlive,
} = require("./rooms");
const { broadcast } = require("./net");
const {
  resumeGame, resetToNextTurn, resolveReaction, resolveBlockChallenge,
  killSpecificInfluence, applyExchangeSelection,
} = require("./game");

function start() {
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
}



module.exports = { start };
