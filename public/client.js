const socket = io();

const els = {
  roomCode: document.getElementById("roomCode"),
  phase: document.getElementById("phase"),
  timer: document.getElementById("timer"),
  eyeBtn: document.getElementById("eyeBtn"),

  joinBox: document.getElementById("joinBox"),
  gameBox: document.getElementById("gameBox"),
  nickInput: document.getElementById("nickInput"),
  joinBtn: document.getElementById("joinBtn"),

  hostControls: document.getElementById("hostControls"),
  startBtn: document.getElementById("startBtn"),
  restartBtn: document.getElementById("restartBtn"),
  readyBtn: document.getElementById("readyBtn"),

  roomPeople: document.getElementById("roomPeople"),
  lobby: document.getElementById("lobby"),

  turnHint: document.getElementById("turnHint"),
  actions: document.getElementById("actions"),
  targetBar: document.getElementById("targetBar"),
  targetActionName: document.getElementById("targetActionName"),
  cancelTargetBtn: document.getElementById("cancelTargetBtn"),

  reactionBox: document.getElementById("reactionBox"),
  pendingText: document.getElementById("pendingText"),
  reactionHint: document.getElementById("reactionHint"),
  acceptBtn: document.getElementById("acceptBtn"),
  contestBtn: document.getElementById("contestBtn"),
  blockBtn: document.getElementById("blockBtn"),
  blockPickRow: document.getElementById("blockPickRow"),
  blockCaptainBtn: document.getElementById("blockCaptainBtn"),
  blockAmbBtn: document.getElementById("blockAmbBtn"),

  blockChallengeBox: document.getElementById("blockChallengeBox"),
  blockText: document.getElementById("blockText"),
  blockChallengeHint: document.getElementById("blockChallengeHint"),
  blockAcceptBtn: document.getElementById("blockAcceptBtn"),
  blockContestBtn: document.getElementById("blockContestBtn"),

  tableArea: document.getElementById("tableArea"),
  tableSeats: document.getElementById("tableSeats"),
  deckStack: document.getElementById("deckStack"),
  deckCount: document.getElementById("deckCount"),

  log: document.getElementById("log"),
  discard: document.getElementById("discard"),
  roleGuide: document.getElementById("roleGuide"),

  lossModal: document.getElementById("lossModal"),
  lossReason: document.getElementById("lossReason"),
  lossChoices: document.getElementById("lossChoices"),

  exchangeModal: document.getElementById("exchangeModal"),
  exchangeInfo: document.getElementById("exchangeInfo"),
  exchangeChoices: document.getElementById("exchangeChoices"),
  exchangeConfirmBtn: document.getElementById("exchangeConfirmBtn"),

  winnerOverlay: document.getElementById("winnerOverlay"),
  winnerName: document.getElementById("winnerName"),
  winnerClose: document.getElementById("winnerClose"),
  winnerBackBtn: document.getElementById("winnerBackBtn"),
  confettiLayer: document.getElementById("confettiLayer"),
};

const TURN_MS = 90_000;

let myId = null;
let state = null;
let joined = false;

let hideMyCards = false;
let targeting = null; // ação escolhida esperando alvo
let exchangeSelected = [];

let lastSeq = 0; // último evento animado
let dismissedWinnerTs = 0;

function roomKeyFromUrl() {
  const p = location.pathname.replace("/", "").trim();
  const cleaned = p
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
  return cleaned.length ? cleaned : "ROOM";
}
const roomKey = roomKeyFromUrl();
els.roomCode.textContent = roomKey;

const ACTIONS = [
  {
    type: "income",
    icon: "🪙",
    label: "Renda",
    tag: "+1",
    tagCls: "gain",
    needsTarget: false,
    claim: null,
    desc: "Pega 1 moeda. Não pode ser bloqueada nem contestada.",
  },
  {
    type: "foreign_aid",
    icon: "💰",
    label: "Ajuda Externa",
    tag: "+2",
    tagCls: "gain",
    needsTarget: false,
    claim: null,
    desc: "Pega 2 moedas. Qualquer um pode bloquear com Duque.",
  },
  {
    type: "tax",
    icon: "👑",
    label: "Taxar",
    tag: "+3",
    tagCls: "gain",
    needsTarget: false,
    claim: "Duke",
    desc: "Pega 3 moedas alegando Duque. Pode ser contestado.",
  },
  {
    type: "assassinate",
    icon: "🗡️",
    label: "Assassinar",
    tag: "-3",
    tagCls: "cost",
    needsTarget: true,
    claim: "Assassin",
    cost: 3,
    desc: "Paga 3, o alvo perde 1 carta. Condessa bloqueia.",
  },
  {
    type: "steal",
    icon: "⚓",
    label: "Roubar",
    tag: "+2",
    tagCls: "gain",
    needsTarget: true,
    claim: "Captain",
    desc: "Rouba 2 moedas. Capitão ou Embaixador bloqueiam.",
  },
  {
    type: "exchange",
    icon: "🎭",
    label: "Trocar",
    tag: "🔄",
    tagCls: "",
    needsTarget: false,
    claim: "Ambassador",
    desc: "Troca cartas com o baralho alegando Embaixador.",
  },
  {
    type: "coup",
    icon: "💥",
    label: "Golpe",
    tag: "-7",
    tagCls: "cost",
    needsTarget: true,
    claim: null,
    cost: 7,
    desc: "Paga 7, o alvo perde 1 carta. Impossível bloquear.",
  },
];

const PHASE_PT = {
  lobby: "Lobby",
  turn: "Turno",
  reaction: "Aguardando respostas",
  block_challenge: "Contestar bloqueio?",
  await_loss: "Escolhendo carta",
  exchange_select: "Trocando cartas",
};

socket.on("connect", () => {
  myId = socket.id;
});

socket.on("state", (s) => {
  const prev = state;
  state = s;
  renderAll();
  // depois do render: os retângulos usados pelas animações já estão corretos
  consumeEvents(s.events, prev);
});

/* ------------------------------------------------------------------ */
/* helpers de estado                                                    */
/* ------------------------------------------------------------------ */

function me() {
  return (state?.playersInGame || []).find((p) => p.id === myId) || null;
}
function amIInGame() {
  return !!me();
}
function isMyTurn() {
  return (
    state?.started && state.phase === "turn" && state.currentPlayerId === myId
  );
}
function aliveOpponents() {
  return (state?.playersInGame || []).filter(
    (p) => p.id !== myId && p.connected && p.aliveCount > 0,
  );
}
function nickOf(id) {
  return (
    (state?.playersInGame || []).find((p) => p.id === id)?.nick ||
    (state?.roomPlayers || []).find((p) => p.id === id)?.nick ||
    "?"
  );
}

/* ------------------------------------------------------------------ */
/* eventos -> animações                                                 */
/* ------------------------------------------------------------------ */

function deckRect() {
  return FX.rect(els.deckStack) || FX.rect(els.tableArea);
}
function seatRect(pid) {
  return FX.rect(seatEls.get(pid)?.root);
}
function seatCardRect(pid, idx) {
  const s = seatEls.get(pid);
  return FX.rect(s?.cards?.[idx]) || seatRect(pid);
}
function seatMoneyRect(pid) {
  const s = seatEls.get(pid);
  return FX.rect(s?.money) || seatRect(pid);
}

function consumeEvents(events) {
  if (!events?.length) return;

  const fresh = events.filter((e) => e.seq > lastSeq);
  if (!fresh.length) return;

  const maxSeq = fresh[fresh.length - 1].seq;

  // primeira sincronização (entrou no meio / reconectou):
  // marca como visto sem animar o histórico todo
  if (lastSeq === 0) {
    lastSeq = maxSeq;
    return;
  }
  lastSeq = maxSeq;

  for (const ev of fresh) scheduleEvent(ev);
}

function scheduleEvent(ev) {
  switch (ev.type) {
    case "game_start":
      FX.enqueue(() => {
        FX.ping(els.deckStack, "deckShuffle", 900);
        FX.banner({
          title: "Partida iniciada!",
          sub: "Distribuindo as cartas...",
          cls: "good",
          dur: 1500,
        });
      }, 800);

      FX.enqueue((sp) => {
        const from = deckRect();
        const ids = ev.playerIds || [];
        let i = 0;
        // uma rodada por vez, como numa mesa de verdade
        for (let idx = 0; idx < 2; idx++) {
          for (const pid of ids) {
            FX.flyCard({
              from,
              to: seatCardRect(pid, idx),
              faceDown: true,
              dur: 620 * sp,
              delay: i * 130 * sp,
            });
            i++;
          }
        }
      }, 1500);
      break;

    case "turn":
      FX.enqueue(() => {
        const s = seatEls.get(ev.playerId);
        FX.ping(s?.root, "turnPulse", 1200);
        FX.banner({
          title: `Vez de ${ev.nick}`,
          sub: ev.playerId === myId ? "É a sua vez!" : "",
          cls: ev.playerId === myId ? "mine" : "",
          dur: 1300,
        });
      }, 620);
      break;

    case "coins": {
      const gain = ev.delta > 0;
      FX.enqueue((sp) => {
        const seat = seatMoneyRect(ev.playerId);
        const bank = deckRect();
        FX.flyCoins({
          from: gain ? bank : seat,
          to: gain ? seat : bank,
          count: Math.abs(ev.delta),
          dur: 560 * sp,
        });
        FX.floatText({
          at: seat,
          text: `${gain ? "+" : ""}${ev.delta}`,
          cls: gain ? "gain" : "cost",
        });
        FX.ping(seatEls.get(ev.playerId)?.money, gain ? "coinUp" : "coinDown");
      }, 620);
      break;
    }

    case "steal":
      FX.enqueue((sp) => {
        const from = seatMoneyRect(ev.fromId);
        const to = seatMoneyRect(ev.toId);
        FX.flyCoins({ from, to, count: ev.amount, dur: 700 * sp });
        FX.floatText({ at: from, text: `-${ev.amount}`, cls: "cost" });
        FX.floatText({ at: to, text: `+${ev.amount}`, cls: "gain" });
        FX.ping(seatEls.get(ev.fromId)?.money, "coinDown");
        FX.ping(seatEls.get(ev.toId)?.money, "coinUp");
      }, 780);
      break;

    case "action_declared": {
      const a = ACTIONS.find((x) => x.type === ev.actionType);
      const claim = ev.claimRole
        ? ` alegando ${UI.rolePt(ev.claimRole)}`
        : " (não pode ser contestado)";
      const alvo = ev.targetId ? ` em ${nickOf(ev.targetId)}` : "";
      FX.enqueue(() => {
        FX.banner({
          title: `${a?.icon || ""} ${ev.actorNick} → ${UI.actionLabel(ev.actionType)}${alvo}`,
          sub: `${claim.trim()}`,
          dur: 1600,
        });
        FX.ping(seatEls.get(ev.actorId)?.root, "actorPulse", 1000);
        if (ev.targetId)
          FX.ping(seatEls.get(ev.targetId)?.root, "targetPulse", 1000);
      }, 700);
      break;
    }

    case "block":
      FX.enqueue(() => {
        FX.banner({
          title: `🛡️ ${ev.blockerNick} bloqueou`,
          sub: `alegando ${UI.rolePt(ev.claimRole)}`,
          cls: "warn",
          dur: 1500,
        });
        FX.ping(seatEls.get(ev.blockerId)?.root, "blockPulse", 1100);
        FX.floatText({
          at: seatRect(ev.blockerId),
          text: "🛡️ BLOQUEIO",
          cls: "warn",
        });
      }, 800);
      break;

    case "challenge_result":
      FX.enqueue(() => {
        const caught = ev.bluffCaught;
        FX.banner({
          title: caught
            ? `❌ Blefe de ${ev.claimerNick} descoberto!`
            : `✅ ${ev.claimerNick} tinha mesmo ${UI.rolePt(ev.claimRole)}`,
          sub: caught
            ? `${ev.challengerNick} contestou e ganhou`
            : `${ev.challengerNick} contestou e perdeu`,
          cls: caught ? "bad" : "good",
          dur: 1900,
        });
        FX.shake(seatEls.get(caught ? ev.claimerId : ev.challengerId)?.root);
      }, 1000);
      break;

    case "reveal_replace":
      // prova a carta, devolve ao baralho e compra outra
      FX.enqueue((sp) => {
        FX.revealCard({
          at: seatCardRect(ev.playerId, ev.idx),
          role: ev.role,
          dur: 950 * sp,
        });
      }, 1000);
      FX.enqueue((sp) => {
        FX.flyCard({
          from: seatCardRect(ev.playerId, ev.idx),
          to: deckRect(),
          role: ev.role,
          faceDown: false,
          dur: 560 * sp,
        });
        FX.ping(els.deckStack, "deckShuffle", 700);
      }, 620);
      FX.enqueue((sp) => {
        FX.flyCard({
          from: deckRect(),
          to: seatCardRect(ev.playerId, ev.idx),
          faceDown: true,
          dur: 560 * sp,
        });
      }, 620);
      break;

    case "card_lost":
      FX.enqueue((sp) => {
        FX.revealCard({
          at: seatCardRect(ev.playerId, ev.idx),
          role: ev.role,
          dur: 1050 * sp,
        });
        FX.shake(seatEls.get(ev.playerId)?.root);
        FX.floatText({
          at: seatRect(ev.playerId),
          text: `perdeu ${UI.rolePt(ev.role)}`,
          cls: "cost",
        });
      }, 1150);
      break;

    case "eliminated":
      FX.enqueue(() => {
        FX.banner({
          title: `💀 ${ev.nick} foi eliminado`,
          cls: "bad",
          dur: 1500,
        });
        FX.ping(seatEls.get(ev.playerId)?.root, "eliminatePulse", 1400);
      }, 900);
      break;

    case "coup":
      FX.enqueue(() => {
        FX.floatText({
          at: seatRect(ev.targetId),
          text: "💥 GOLPE",
          cls: "cost",
        });
        FX.shake(seatEls.get(ev.targetId)?.root);
      }, 500);
      break;

    case "deck_draw":
      FX.enqueue((sp) => {
        const from = deckRect();
        for (let i = 0; i < (ev.count || 2); i++) {
          FX.flyCard({
            from,
            to: seatRect(ev.playerId),
            faceDown: true,
            dur: 620 * sp,
            delay: i * 150 * sp,
          });
        }
        FX.banner({
          title: `🎭 ${ev.nick} está trocando cartas`,
          sub: `comprou ${ev.count} do baralho`,
          dur: 1400,
        });
      }, 900);
      break;

    case "deck_return":
      FX.enqueue((sp) => {
        const to = deckRect();
        for (let i = 0; i < (ev.count || 0); i++) {
          FX.flyCard({
            from: seatRect(ev.playerId),
            to,
            faceDown: true,
            dur: 560 * sp,
            delay: i * 130 * sp,
          });
        }
        FX.ping(els.deckStack, "deckShuffle", 800);
      }, 800);
      break;

    case "winner":
      FX.enqueue(() => {
        FX.banner({
          title: `🏆 ${ev.nick} venceu!`,
          cls: "good",
          dur: 1600,
        });
      }, 600);
      break;
  }
}

/* ------------------------------------------------------------------ */
/* inputs                                                               */
/* ------------------------------------------------------------------ */

els.joinBtn.onclick = () => {
  const nick = (els.nickInput.value || "").trim().slice(0, 20);
  if (!nick) return alert("Digite um nick.");
  socket.emit("join", { roomKey, nick });
  joined = true;
};
els.nickInput.onkeydown = (e) => {
  if (e.key === "Enter") els.joinBtn.click();
};

els.readyBtn.onclick = () => socket.emit("toggle_ready");
els.startBtn.onclick = () => socket.emit("start");
els.restartBtn.onclick = () => socket.emit("restart");

els.eyeBtn.onclick = () => {
  hideMyCards = !hideMyCards;
  els.eyeBtn.textContent = hideMyCards ? "🙈" : "👁️";
  renderTable();
};

els.acceptBtn.onclick = () => socket.emit("react", { decision: "accept" });
els.contestBtn.onclick = () => socket.emit("react", { decision: "contest" });

els.blockBtn.onclick = () => {
  if (!state?.pendingAction?.blockInfo?.blockable) return;
  const t = state.pendingAction.action.type;
  if (t === "steal") {
    els.blockPickRow.classList.remove("hidden");
  } else if (t === "foreign_aid") {
    socket.emit("block", { role: "Duke" });
  } else if (t === "assassinate") {
    socket.emit("block", { role: "Contessa" });
  }
};
els.blockCaptainBtn.onclick = () => socket.emit("block", { role: "Captain" });
els.blockAmbBtn.onclick = () => socket.emit("block", { role: "Ambassador" });

els.blockAcceptBtn.onclick = () =>
  socket.emit("block_challenge", { decision: "accept" });
els.blockContestBtn.onclick = () =>
  socket.emit("block_challenge", { decision: "contest" });

els.cancelTargetBtn.onclick = () => cancelTargeting();

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (targeting) cancelTargeting();
    else if (!els.winnerOverlay.classList.contains("hidden")) closeWinner();
  }
});

els.exchangeConfirmBtn.onclick = () => {
  if (!state?.exchangeForViewer) return;
  socket.emit("exchange_pick", { keep: exchangeSelected.map((x) => x.role) });
};

els.winnerClose.onclick = () => closeWinner();
els.winnerBackBtn.onclick = () => closeWinner();

function closeWinner() {
  dismissedWinnerTs = state?.winner?.ts || Date.now();
  els.winnerOverlay.classList.add("hidden");
  FX.stopConfetti(els.confettiLayer);
}

/* ------------------------------------------------------------------ */
/* alvo por clique na mesa                                              */
/* ------------------------------------------------------------------ */

function startTargeting(action) {
  targeting = action;
  els.targetActionName.textContent = action.label.toUpperCase();
  els.targetBar.classList.remove("hidden");
  renderActions();
  renderTable();
}

function cancelTargeting() {
  targeting = null;
  els.targetBar.classList.add("hidden");
  renderActions();
  renderTable();
}

function pickTarget(playerId) {
  if (!targeting) return;
  const t = targeting;
  targeting = null;
  els.targetBar.classList.add("hidden");
  socket.emit("action", { type: t.type, targetId: playerId });
  renderActions();
  renderTable();
}

/* ------------------------------------------------------------------ */
/* disponibilidade das ações (o "porquê" de cada botão travado)          */
/* ------------------------------------------------------------------ */

function actionAvailability(a) {
  const m = me();

  if (!m) return { ok: false, why: "Você está na fila desta partida" };
  if (!state.started) return { ok: false, why: "A partida ainda não começou" };
  if (m.aliveCount <= 0) return { ok: false, why: "Você foi eliminado" };

  if (state.phase !== "turn")
    return { ok: false, why: "Aguardando a jogada atual terminar" };

  if (state.currentPlayerId !== myId)
    return { ok: false, why: `É a vez de ${nickOf(state.currentPlayerId)}` };

  // 10+ moedas: golpe obrigatório
  if (m.coins >= 10 && a.type !== "coup")
    return { ok: false, why: "Com 10+ moedas o Golpe é obrigatório" };

  if (a.cost && m.coins < a.cost)
    return {
      ok: false,
      why: `Precisa de ${a.cost} moedas (você tem ${m.coins})`,
    };

  if (a.needsTarget && aliveOpponents().length === 0)
    return { ok: false, why: "Não há alvo disponível" };

  return { ok: true, why: "" };
}

/* ------------------------------------------------------------------ */
/* render                                                               */
/* ------------------------------------------------------------------ */

function renderJoinOrGame() {
  els.joinBox.classList.toggle("hidden", joined);
  els.gameBox.classList.toggle("hidden", !joined);
}

function renderTop() {
  if (!state) return;

  els.phase.textContent = state.started
    ? `Fase: ${PHASE_PT[state.phase] || state.phase}`
    : "Lobby — aguardando READY e início";

  if (!state.started) {
    els.timer.textContent = "";
    els.timer.classList.remove("urgent");
    return;
  }

  let ts = 0;
  let label = "";
  if (state.phase === "turn") {
    ts = state.turnEndsAt;
    label = "Turno";
  } else if (state.phase === "reaction") {
    ts = state.reactionEndsAt;
    label = "Resposta";
  } else if (state.phase === "block_challenge") {
    ts = state.blockChallengeEndsAt;
    label = "Bloqueio";
  } else if (
    state.phase === "exchange_select" &&
    state.exchangeForViewer?.endsAt
  ) {
    ts = state.exchangeForViewer.endsAt;
    label = "Troca";
  }

  if (!ts) {
    els.timer.textContent = "";
    els.timer.classList.remove("urgent");
    return;
  }

  els.timer.textContent = `${label}: ${UI.timeLeft(ts)}`;
  els.timer.classList.toggle("urgent", UI.secsLeft(ts) <= 10);
}

function renderHostButtons() {
  const isHost = state?.hostId === myId;
  els.hostControls.style.display = isHost ? "flex" : "none";
  if (!isHost) return;

  const people = state.roomPlayers || [];
  const lobby = state.lobby || [];
  const connectedCount = people.length;

  const allReady = lobby.length >= 2 && lobby.every((p) => p.ready);
  const canStart =
    !state.started && connectedCount >= 2 && connectedCount <= 6 && allReady;

  els.startBtn.disabled = !canStart;
  els.startBtn.title = canStart
    ? "Começar a partida"
    : state.started
      ? "A partida já começou"
      : "Precisa de 2 a 6 jogadores, todos READY";
  els.restartBtn.disabled = !state.started;
}

function renderRoomPeople() {
  els.roomPeople.innerHTML = "";
  const people = state?.roomPlayers || [];

  if (!people.length) {
    els.roomPeople.innerHTML = `<div class="emptyNote">Ninguém conectado.</div>`;
    return;
  }

  for (const p of people) {
    const row = document.createElement("div");
    row.className = "lobbyItem";
    row.innerHTML = `
      <div class="lobbyWho">
        <span class="readyDot ${p.ready ? "on" : ""}"></span>
        <b>${UI.escape(p.nick)}${p.isHost ? " 👑" : ""}</b>
      </div>
      <span class="readyTag">${p.inGame ? "EM JOGO" : p.ready ? "READY" : "NOT READY"}</span>
    `;
    els.roomPeople.appendChild(row);
  }
}

function renderLobby() {
  els.lobby.innerHTML = "";
  const list = state?.lobby || [];

  if (!list.length) {
    els.lobby.innerHTML = `<div class="emptyNote">Ninguém no lobby.</div>`;
  } else {
    for (const p of list) {
      const row = document.createElement("div");
      row.className = "lobbyItem";
      row.innerHTML = `
        <div class="lobbyWho">
          <span class="readyDot ${p.ready ? "on" : ""}"></span>
          <b>${UI.escape(p.nick)}</b>
        </div>
        <span class="readyTag">${p.ready ? "READY" : "NOT READY"}</span>
      `;
      els.lobby.appendChild(row);
    }
  }

  const meLobby = list.find((p) => p.id === myId);
  els.readyBtn.textContent = meLobby?.ready ? "Cancelar READY" : "Ficar READY";
  els.readyBtn.classList.toggle("ok", !!meLobby?.ready);
  els.readyBtn.disabled = !!state.started;
}

function renderTurnHint() {
  if (!state?.started) {
    els.turnHint.className = "turnHint";
    els.turnHint.textContent = "Partida não iniciada.";
    return;
  }
  if (!amIInGame()) {
    els.turnHint.className = "turnHint";
    els.turnHint.textContent = "Você está na fila. Aguarde a próxima partida.";
    return;
  }
  const m = me();
  if (m.aliveCount <= 0) {
    els.turnHint.className = "turnHint out";
    els.turnHint.textContent = "Você foi eliminado. Assista até o fim!";
    return;
  }
  if (isMyTurn()) {
    els.turnHint.className = "turnHint mine";
    els.turnHint.textContent =
      m.coins >= 10
        ? "Sua vez — você tem 10+ moedas: Golpe obrigatório!"
        : "Sua vez! Escolha uma ação abaixo.";
    return;
  }
  els.turnHint.className = "turnHint";
  els.turnHint.textContent =
    state.phase === "turn"
      ? `Vez de ${nickOf(state.currentPlayerId)}...`
      : `${PHASE_PT[state.phase] || state.phase}...`;
}

function renderActions() {
  els.actions.innerHTML = "";

  for (const a of ACTIONS) {
    const { ok, why } = actionAvailability(a);
    const selected = targeting?.type === a.type;

    const btn = document.createElement("button");
    btn.className = `actionBtn ${ok ? "on" : "off"} ${selected ? "picking" : ""}`;
    btn.disabled = !ok;
    btn.title = ok ? a.desc : why;

    const claim = a.claim
      ? `<span class="aClaim ${UI.roleClass(a.claim)}">${UI.roleIcon(a.claim)} ${UI.rolePt(a.claim)}</span>`
      : `<span class="aClaim safe">sem alegação</span>`;

    btn.innerHTML = `
      <span class="aIcon">${a.icon}</span>
      <span class="aBody">
        <span class="aTitle">
          ${a.label}
          <em class="aTag ${a.tagCls}">${a.tag}</em>
        </span>
        <span class="aDesc">${a.desc}</span>
        <span class="aFoot">${claim}${
          ok
            ? a.needsTarget
              ? `<span class="aNeed">🎯 escolha o alvo</span>`
              : ""
            : `<span class="aLock">🔒 ${UI.escape(why)}</span>`
        }</span>
      </span>
    `;

    btn.onclick = () => {
      if (!actionAvailability(a).ok) return;
      if (a.needsTarget) {
        if (targeting?.type === a.type) cancelTargeting();
        else startTargeting(a);
        return;
      }
      cancelTargeting();
      socket.emit("action", { type: a.type, targetId: null });
    };

    els.actions.appendChild(btn);
  }

  // alvo deixou de existir / não é mais minha vez
  if (targeting && !actionAvailability(targeting).ok) cancelTargeting();
}

function renderRoleGuide() {
  if (els.roleGuide.dataset.done) return;
  els.roleGuide.dataset.done = "1";

  for (const [role, meta] of Object.entries(UI.ROLE_META)) {
    const row = document.createElement("div");
    row.className = `guideRow ${meta.cls}`;
    row.innerHTML = `
      <span class="gIcon">${meta.icon}</span>
      <span class="gBody">
        <b>${meta.pt}</b>
        <span class="gDoes">${meta.does}</span>
        <span class="gBlocks">${meta.blocks !== "—" ? "🛡️ " + meta.blocks : ""}</span>
      </span>
      <span class="gCount">×3</span>
    `;
    els.roleGuide.appendChild(row);
  }
}

/* ---------------- reações ---------------- */

function canIBlock(pending) {
  if (!pending?.blockInfo?.blockable) return false;
  if (pending.block) return false;

  const t = pending.action.type;
  if (t === "foreign_aid") return myId !== pending.actorId;
  if ((t === "assassinate" || t === "steal") && pending.action.targetId)
    return myId === pending.action.targetId;
  return false;
}

function blockHint(pending) {
  const t = pending.action.type;
  const tgt = pending.action.targetId
    ? nickOf(pending.action.targetId)
    : "o alvo";

  if (t === "foreign_aid")
    return "Qualquer jogador pode bloquear alegando Duque. Ajuda Externa não pode ser contestada.";
  if (t === "assassinate")
    return myId === pending.action.targetId
      ? "Só você pode bloquear, alegando Condessa."
      : `Só ${tgt} pode bloquear (com Condessa). Você só pode aceitar ou contestar o Assassino.`;
  if (t === "steal")
    return myId === pending.action.targetId
      ? "Só você pode bloquear, alegando Capitão ou Embaixador."
      : `Só ${tgt} pode bloquear (Capitão/Embaixador). Você só pode aceitar ou contestar o Capitão.`;
  if (!pending.claimRole)
    return "Esta ação não alega nenhuma carta — não dá para contestar.";
  return `Contestar significa dizer que ${pending.actorNick} NÃO tem ${UI.rolePt(pending.claimRole)}. Se estiver errado, você perde uma carta.`;
}

function resetChoiceStyles() {
  for (const b of [
    els.acceptBtn,
    els.contestBtn,
    els.blockBtn,
    els.blockAcceptBtn,
    els.blockContestBtn,
  ]) {
    b.classList.remove("chosen");
    b.disabled = false;
    b.style.display = "inline-flex";
  }
  els.blockPickRow.classList.add("hidden");
}

function renderReactionBoxes() {
  if (!amIInGame()) {
    els.reactionBox.classList.add("hidden");
    els.blockChallengeBox.classList.add("hidden");
    return;
  }

  const pending = state?.pendingAction;
  resetChoiceStyles();

  // ---- fase de reação ----
  if (!pending || state.phase !== "reaction" || pending.actorId === myId) {
    els.reactionBox.classList.add("hidden");
  } else {
    const claim = pending.claimRole
      ? ` alegando ${UI.rolePt(pending.claimRole)}`
      : "";
    const targetNick = pending.action.targetId
      ? nickOf(pending.action.targetId)
      : null;

    els.pendingText.textContent =
      `${pending.actorNick} declarou ${UI.actionLabel(pending.action.type)}${claim}` +
      (targetNick ? ` em ${targetNick}` : "");

    els.reactionHint.textContent = blockHint(pending);

    const myReaction = state.reactions?.[myId];

    els.acceptBtn.classList.toggle("chosen", myReaction === "accept");
    els.contestBtn.classList.toggle("chosen", myReaction === "contest");
    els.blockBtn.classList.toggle("chosen", myReaction === "block");

    // só aparece o que dá para usar
    els.contestBtn.style.display = pending.claimRole ? "inline-flex" : "none";
    els.blockBtn.style.display = canIBlock(pending) ? "inline-flex" : "none";

    if (myReaction) {
      els.acceptBtn.disabled = true;
      els.contestBtn.disabled = true;
      els.blockBtn.disabled = true;
      els.reactionHint.textContent = "Resposta enviada. Aguardando os outros...";
    }

    els.reactionBox.classList.remove("hidden");
  }

  // ---- fase de contestação do bloqueio ----
  if (
    state.phase !== "block_challenge" ||
    !pending?.block ||
    pending.block.blockerId === myId
  ) {
    els.blockChallengeBox.classList.add("hidden");
  } else {
    const blk = pending.block;
    const myDecision = state.blockChallenges?.[myId];

    els.blockAcceptBtn.classList.toggle("chosen", myDecision === "accept");
    els.blockContestBtn.classList.toggle("chosen", myDecision === "contest");

    els.blockText.textContent = `${blk.blockerNick} bloqueou alegando ${UI.rolePt(blk.claimRole)}.`;
    els.blockChallengeHint.textContent = myDecision
      ? "Resposta enviada. Aguardando os outros..."
      : `Se você contestar e ${blk.blockerNick} tiver mesmo ${UI.rolePt(blk.claimRole)}, você perde uma carta.`;

    if (myDecision) {
      els.blockAcceptBtn.disabled = true;
      els.blockContestBtn.disabled = true;
    }

    els.blockChallengeBox.classList.remove("hidden");
  }
}

/* ---------------- mesa (render incremental) ---------------- */

const seatEls = new Map();

function buildSeat(pid) {
  const root = document.createElement("div");
  root.className = "seat";
  root.dataset.pid = pid;
  root.innerHTML = `
    <div class="seatRing"></div>
    <div class="seatTop">
      <div class="playerName">
        <span class="personIcon">👤</span>
        <span class="nick"></span>
      </div>
      <div class="seatRight">
        <span class="respBadge hidden"></span>
        <div class="moneyTag"><span class="micon">🪙</span><span class="coins">0</span></div>
      </div>
    </div>
    <div class="turnTimer">—</div>
    <div class="turnBar"><i></i></div>
    <div class="miniHand">
      <div class="miniCard back" data-idx="0"><div class="cMark">C</div></div>
      <div class="miniCard back" data-idx="1"><div class="cMark">C</div></div>
    </div>
    <div class="seatTargetTag">🎯 Escolher</div>
  `;

  const refs = {
    root,
    nick: root.querySelector(".nick"),
    coins: root.querySelector(".coins"),
    money: root.querySelector(".moneyTag"),
    badge: root.querySelector(".respBadge"),
    timer: root.querySelector(".turnTimer"),
    bar: root.querySelector(".turnBar i"),
    cards: [...root.querySelectorAll(".miniCard")],
  };

  root.addEventListener("click", () => {
    if (targeting && root.classList.contains("targetable")) pickTarget(pid);
  });

  seatEls.set(pid, refs);
  els.tableSeats.appendChild(root);
  return refs;
}

function updateMiniCard(el, card, showRole) {
  const alive = !!card?.alive;
  const roleToShow = card ? (showRole ? card.role : alive ? null : card.role) : null;

  const sig = `${roleToShow || "?"}|${alive}|${card ? 1 : 0}`;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;

  el.className = `miniCard ${roleToShow ? UI.roleClass(roleToShow) : "back"}${alive ? "" : " dead"}`;
  el.innerHTML = roleToShow
    ? `<div class="cIcon">${UI.roleIcon(roleToShow)}</div><div class="label">${UI.escape(UI.rolePt(roleToShow))}</div>`
    : `<div class="cMark">C</div>`;
}

function seatResponseBadge(p) {
  if (state.phase === "reaction" && state.pendingAction) {
    const v = state.reactions?.[p.id];
    if (v === "accept") return { t: "ACEITA", c: "ok" };
    if (v === "contest") return { t: "CONTESTA", c: "bad" };
    if (v === "block") return { t: "BLOQUEIA", c: "warn" };
  }
  if (state.phase === "block_challenge" && state.pendingAction?.block) {
    const v = state.blockChallenges?.[p.id];
    if (v === "accept") return { t: "ACEITA", c: "ok" };
    if (v === "contest") return { t: "CONTESTA", c: "bad" };
  }
  return null;
}

function renderTable() {
  const players = (state?.playersInGame || []).slice(0, 6);
  const ids = new Set(players.map((p) => p.id));

  // remove assentos de quem saiu
  for (const [pid, refs] of seatEls) {
    if (!ids.has(pid)) {
      refs.root.remove();
      seatEls.delete(pid);
    }
  }

  els.deckCount.textContent = state?.deckCount ?? "—";
  els.tableArea?.classList.toggle("playing", !!state?.started);

  if (!players.length) return;

  const pos = UI.seatPositions(players.length);
  const validTargets = targeting
    ? new Set(aliveOpponents().map((p) => p.id))
    : null;

  players.forEach((p, i) => {
    const s = seatEls.get(p.id) || buildSeat(p.id);

    s.root.style.left = pos[i].x + "%";
    s.root.style.top = pos[i].y + "%";

    const current = state.phase === "turn" && state.currentPlayerId === p.id;
    const dead = p.aliveCount <= 0;

    s.root.classList.toggle("me", p.id === myId);
    s.root.classList.toggle("current", current);
    s.root.classList.toggle("eliminated", dead);
    s.root.classList.toggle("offline", !p.connected);
    s.root.classList.toggle(
      "targetable",
      !!(targeting && validTargets.has(p.id)),
    );

    const responded =
      (state.phase === "reaction" &&
        p.id !== state.pendingAction?.actorId &&
        state.reactionResponded?.[p.id] != null) ||
      (state.phase === "block_challenge" &&
        p.id !== state.pendingAction?.block?.blockerId &&
        state.blockResponded?.[p.id] != null);
    s.root.classList.toggle("responded", responded);

    if (s.nick.textContent !== p.nick) s.nick.textContent = p.nick;

    if (s.coins.textContent !== String(p.coins))
      s.coins.textContent = String(p.coins);
    s.money.classList.toggle("rich", p.coins >= 10);

    const badge = seatResponseBadge(p);
    s.badge.classList.toggle("hidden", !badge);
    if (badge) {
      s.badge.textContent = badge.t;
      s.badge.className = `respBadge ${badge.c}`;
    }

    if (current) {
      const left = UI.secsLeft(state.turnEndsAt);
      s.timer.textContent = `⏱ ${UI.timeLeft(state.turnEndsAt)}`;
      s.timer.className = `turnTimer on ${left <= 10 ? "urgent" : ""}`;
      s.bar.style.width =
        Math.max(0, Math.min(100, (left / (TURN_MS / 1000)) * 100)) + "%";
      s.bar.parentElement.style.visibility = "visible";
    } else {
      s.timer.textContent = dead ? "💀 eliminado" : "—";
      s.timer.className = "turnTimer";
      s.bar.parentElement.style.visibility = "hidden";
    }

    const showMy = p.id === myId && !hideMyCards;
    updateMiniCard(s.cards[0], p.hand?.[0], showMy);
    updateMiniCard(s.cards[1], p.hand?.[1], showMy);
  });
}

/* ---------------- listas / modais ---------------- */

function renderLog() {
  const items = state?.actionLog || [];
  if (els.log.dataset.n === String(items.length)) return;
  els.log.dataset.n = String(items.length);

  els.log.innerHTML = "";
  for (const it of items) {
    const div = document.createElement("div");
    div.className = "item";
    div.textContent = it.text;
    els.log.appendChild(div);
  }
  els.log.scrollTop = els.log.scrollHeight;
}

function renderDiscard() {
  const items = state?.discard || [];
  if (els.discard.dataset.n === String(items.length)) return;
  els.discard.dataset.n = String(items.length);

  els.discard.innerHTML = "";
  if (!items.length) {
    els.discard.innerHTML = `<div class="emptyNote">Nenhuma carta revelada ainda.</div>`;
    return;
  }
  for (const d of items) {
    const div = document.createElement("div");
    div.className = `discardItem ${UI.roleClass(d.role)}`;
    div.innerHTML = `
      <span class="dIcon">${UI.roleIcon(d.role)}</span>
      <span class="dBody"><b>${UI.escape(d.ownerNick)}</b> perdeu ${UI.escape(UI.rolePt(d.role))}
      <span class="dReason">${UI.escape(d.reason || "")}</span></span>
    `;
    els.discard.appendChild(div);
  }
  els.discard.scrollTop = els.discard.scrollHeight;
}

function renderLossModal() {
  const lf = state?.lossForViewer;
  if (!lf) {
    els.lossModal.classList.add("hidden");
    els.lossChoices.innerHTML = "";
    return;
  }
  if (!els.lossModal.classList.contains("hidden")) return; // já aberto

  els.lossReason.textContent = lf.reason;
  els.lossChoices.innerHTML = "";

  for (const c of lf.aliveCards) {
    const card = document.createElement("div");
    card.className = `card ${UI.roleClass(c.role)} pickable`;
    card.innerHTML = `<div class="cIcon big">${UI.roleIcon(c.role)}</div><div class="label">${UI.escape(UI.rolePt(c.role))}</div>`;
    card.onclick = () => socket.emit("lose_influence", { cardIdx: c.idx });
    els.lossChoices.appendChild(card);
  }

  els.lossModal.classList.remove("hidden");
}

function renderExchangeModal() {
  const ex = state?.exchangeForViewer;
  if (!ex) {
    els.exchangeModal.classList.add("hidden");
    els.exchangeChoices.innerHTML = "";
    exchangeSelected = [];
    return;
  }
  if (!els.exchangeModal.classList.contains("hidden")) return; // já aberto

  els.exchangeInfo.textContent = `Escolha ${ex.keepCount} carta(s) para manter. As outras voltam para o baralho.`;
  els.exchangeChoices.innerHTML = "";
  exchangeSelected = [];

  ex.options.forEach((role, idx) => {
    const card = document.createElement("div");
    card.className = `card ${UI.roleClass(role)} pickable`;
    card.innerHTML = `<div class="cIcon big">${UI.roleIcon(role)}</div><div class="label">${UI.escape(UI.rolePt(role))}</div>`;

    card.onclick = () => {
      const key = `${role}#${idx}`;
      const pos = exchangeSelected.findIndex((x) => x.key === key);
      if (pos >= 0) {
        exchangeSelected.splice(pos, 1);
        card.classList.remove("selected");
      } else {
        if (exchangeSelected.length >= ex.keepCount) return;
        exchangeSelected.push({ key, role });
        card.classList.add("selected");
      }
      els.exchangeConfirmBtn.disabled =
        exchangeSelected.length !== ex.keepCount;
    };

    els.exchangeChoices.appendChild(card);
  });

  els.exchangeConfirmBtn.disabled = true;
  els.exchangeModal.classList.remove("hidden");
}

function renderWinner() {
  const w = state?.winner;
  const fresh = w && Date.now() - w.ts < 3 * 60_000;

  if (!fresh || w.ts === dismissedWinnerTs) {
    if (!els.winnerOverlay.classList.contains("hidden")) {
      els.winnerOverlay.classList.add("hidden");
      FX.stopConfetti(els.confettiLayer);
    }
    return;
  }

  if (!els.winnerOverlay.classList.contains("hidden")) return; // já aberto

  els.winnerName.textContent = w.nick;
  els.winnerOverlay.classList.toggle("isMe", w.playerId === myId);
  els.winnerOverlay.classList.remove("hidden");
  FX.confetti(els.confettiLayer, 110);
}

function renderAll() {
  if (!state) return;

  renderJoinOrGame();
  renderTop();

  renderRoomPeople();
  renderLobby();
  renderHostButtons();

  renderTurnHint();
  renderActions();
  renderRoleGuide();
  renderReactionBoxes();
  renderTable();

  renderLog();
  renderDiscard();
  renderLossModal();
  renderExchangeModal();
  renderWinner();
}

setInterval(() => {
  if (!state) return;
  renderTop();
  if (state.started) renderTable();
}, 250);
