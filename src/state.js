// Monta o que cada jogador enxerga. É o único lugar que decide o que é
// segredo: a mão dos outros sai sem os papéis.
const { findPlayer, seatedPlayers, queuedPlayers, lobbyPlayers, inGamePlayers,
        aliveCount, MAX_SEATS } = require("./rooms");
const { actionBlockInfo } = require("./rules");
const { THEMES, DEFAULT_THEME } = require("./constants");

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
    color: p.color ?? 0,
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
      color: p.color ?? 0,
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

    theme: room.theme || DEFAULT_THEME,
    themes: THEMES,
  };
}

module.exports = { roomPublicState };
