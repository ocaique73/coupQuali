// Tudo que chega do navegador. Cada handler valida, muta a sala pelo
// game.js e faz o broadcast.
const { now, cleanPid, randomPid, safeAvatarUrl, roomKeyFromPath } = require("./util");
const {
  MAX_SEATS, RESPONSE_MS, PLAYER_COLORS,
  SHIRTS, BODIES, SKINS, PROPS, HEADS,
  CHAT_MAX, CHAT_MIN_MS, EMOTE_MIN_MS, EMOTES,
} = require("./constants");
const {
  getRoom, addLog, pushEvent, findPlayer,
  seatedPlayers, inGamePlayers, isAlive, assignColor, electHost, ensureHost,
  removeRoomIfEmpty, defaultAppearance, colorFree,
} = require("./rooms");
const { actionRequiresClaim, claimRoleForAction, actionBlockInfo } = require("./rules");
const { broadcast } = require("./net");
const {
  isPaused, pauseGame, resumeGame, endToLobby, startGame,
  applyImmediateAction, resolveReaction, resolveBlockChallenge,
  shouldResolveReactionNow, shouldResolveBlockChallengeNow,
  killSpecificInfluence, applyExchangeSelection,
} = require("./game");

// Aparência que veio do navegador, peneirada: só valores das listas.
// Usada no join e no profile para o visual escolhido sobreviver ao F5 e a
// entrar noutra sala, do mesmo jeito que o nick e a foto sobrevivem.
function limparLook(look, atual) {
  if (!look || typeof look !== "object") return atual;
  return {
    shirt: SHIRTS.includes(look.shirt) ? look.shirt : atual.shirt,
    body: BODIES.includes(look.body) ? look.body : atual.body,
    skin:
      Number.isInteger(look.skin) && look.skin >= 0 && look.skin < SKINS
        ? look.skin
        : atual.skin,
    prop: PROPS.includes(look.prop) ? look.prop : atual.prop,
    head: HEADS.includes(look.head) ? look.head : atual.head,
  };
}

function register(io) {
  io.on("connection", (socket) => {
    let joinedRoomKey = null;
    let myPid = null; // identidade estável desta aba (não muda ao reconectar)
  
    socket.on("join", ({ roomKey, nick, pid, avatar, look, color }) => {
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
        if (canSit) assignColor(room, p);
        // A cor guardada no navegador só vale se ninguém na sala já estiver
        // usando: cor é exclusiva por mesa.
        if (
          canSit &&
          Number.isInteger(color) &&
          color >= 0 &&
          color < PLAYER_COLORS &&
          colorFree(room, p, color)
        )
          p.color = color;
        p.look = limparLook(look, defaultAppearance(p.color ?? 0));
        addLog(
          room,
          canSit
            ? `${cleanNick} entrou na sala.`
            : `${cleanNick} entrou na FILA (${room.started ? "partida em andamento" : "sala cheia"}).`,
        );
        pushEvent(room, "joined", {
          playerId: p.id,
          nick: cleanNick,
          seated: canSit,
        });
      } else {
        p.socketId = socket.id;
        p.nick = cleanNick;
        p.avatar = cleanAvatar;
        const wasOffline = !p.connected;
        p.connected = true;

        // Quem sai do lobby PERDE a cadeira na hora (ver disconnect). Ao
        // voltar, senta de novo só se ainda sobrar lugar — senão a sala
        // passaria de MAX_SEATS quando alguém ocupasse a vaga no meio-tempo.
        if (!p.seated && !room.started && seatedPlayers(room).length < MAX_SEATS) {
          p.seated = true;
          assignColor(room, p);
        }

        if (wasOffline) {
          addLog(
            room,
            p.seated
              ? `${cleanNick} voltou para a sala.`
              : `${cleanNick} voltou, mas a sala encheu — foi para a fila.`,
          );
          pushEvent(room, "reconnected", {
            playerId: p.id,
            nick: cleanNick,
            seated: !!p.seated,
          });
        }
      }
  
      // o host pode ter ficado órfão (caiu sem ser ele o último a sair)
      if (!room.hostId) room.hostId = p.id;
      const novoHost = ensureHost(room);
      if (novoHost) {
        const h = findPlayer(room, novoHost);
        addLog(room, `Novo host: ${h?.nick ?? "?"}`);
        pushEvent(room, "host", { playerId: novoHost, nick: h?.nick ?? "?" });
      }
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
      pushEvent(room, "ready", {
        playerId: p.id,
        nick: p.nick,
        ready: !!p.ready,
      });
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
      assignColor(room, p);
      addLog(room, `${p.nick} foi puxado da fila para a sala.`);
      pushEvent(room, "seated", { playerId: p.id, nick: p.nick });
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
      pushEvent(room, "queued", { playerId: p.id, nick: p.nick });
      broadcast(room);
    });
  
    // trocar nick/foto — só fora de partida
    // Nick, foto e visual. Só fora de partida — ninguém troca de identidade
    // no meio do jogo.
    socket.on("profile", ({ nick, avatar, look, color }) => {
      if (!joinedRoomKey) return;
      const room = getRoom(joinedRoomKey);
      if (room.started) return;

      const p = findPlayer(room, myPid);
      if (!p || !p.connected) return;

      const cleanNick = (nick ?? "").toString().trim().slice(0, 20);
      const before = p.nick;

      if (cleanNick) p.nick = cleanNick;
      p.avatar = safeAvatarUrl(avatar);

      // aparência: só valores das listas; o resto é ignorado
      if (look && typeof look === "object")
        p.look = limparLook(look, p.look || defaultAppearance(p.color ?? 0));

      // A cor é EXCLUSIVA na sala: se outro já usa, mantém a atual e avisa.
      let corNegada = false;
      if (Number.isInteger(color) && color >= 0 && color < PLAYER_COLORS) {
        if (color !== p.color) {
          if (colorFree(room, p, color)) p.color = color;
          else corNegada = true;
        }
      }

      addLog(
        room,
        before !== p.nick
          ? `${before} agora é ${p.nick}.`
          : `${p.nick} mudou o visual.`,
      );
      if (corNegada)
        socket.emit("toast", { text: "Essa cor já é de outro jogador." });

      broadcast(room);
    });
  
    socket.on("chat", ({ text }) => {
      if (!joinedRoomKey) return;
      const room = getRoom(joinedRoomKey);
      const p = findPlayer(room, myPid);
      if (!p || !p.connected) return;
  
      const t = ("" + (text ?? "")).replace(/\s+/g, " ").trim().slice(0, CHAT_MAX);
      if (!t) return;
  
      if (now() - (p.lastChatAt || 0) < CHAT_MIN_MS) return; // anti-spam
      p.lastChatAt = now();
  
      pushEvent(room, "chat", { playerId: p.id, nick: p.nick, text: t });
      addLog(room, `💬 ${p.nick}: ${t}`);
      broadcast(room);
    });
  
    socket.on("emote", ({ kind }) => {
      if (!joinedRoomKey) return;
      const room = getRoom(joinedRoomKey);
      const p = findPlayer(room, myPid);
      if (!p || !p.connected) return;
      if (!EMOTES.has(kind)) return;
  
      if (now() - (p.lastEmoteAt || 0) < EMOTE_MIN_MS) return;
      p.lastEmoteAt = now();
  
      pushEvent(room, "emote", { playerId: p.id, nick: p.nick, kind });
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
        // fora de partida a cadeira é liberada DE VERDADE, para outro poder
        // sentar. Antes ela só sumia das listas, e a sala estourava o limite
        // quando o jogador voltava e reocupava o lugar.
        p.seated = false;
        p.ready = false;
        addLog(room, `${p.nick} saiu.`);
        pushEvent(room, "left", { playerId: p.id, nick: p.nick });
      }
  
      // Re-elege sempre que o host ficar offline, nao so quando foi ele o
      // que caiu: o host podia ficar orfao e ninguem conseguia iniciar,
      // pausar ou reiniciar a sala.
      const novoHost = ensureHost(room);
      if (novoHost) {
        const h = findPlayer(room, novoHost);
        addLog(room, `Novo host: ${h?.nick ?? "?"}`);
        pushEvent(room, "host", { playerId: novoHost, nick: h?.nick ?? "?" });
      }
  
      broadcast(room);
      removeRoomIfEmpty(room);
    });
  });
}



module.exports = { register };
