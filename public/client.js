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

  actions: document.getElementById("actions"),
  targetWrap: document.getElementById("targetWrap"),
  targetSelect: document.getElementById("targetSelect"),
  confirmActionBtn: document.getElementById("confirmActionBtn"),

  reactionBox: document.getElementById("reactionBox"),
  pendingText: document.getElementById("pendingText"),
  acceptBtn: document.getElementById("acceptBtn"),
  contestBtn: document.getElementById("contestBtn"),
  blockBtn: document.getElementById("blockBtn"),
  blockPickRow: document.getElementById("blockPickRow"),
  blockCaptainBtn: document.getElementById("blockCaptainBtn"),
  blockAmbBtn: document.getElementById("blockAmbBtn"),

  blockChallengeBox: document.getElementById("blockChallengeBox"),
  blockText: document.getElementById("blockText"),
  blockAcceptBtn: document.getElementById("blockAcceptBtn"),
  blockContestBtn: document.getElementById("blockContestBtn"),

  tableSeats: document.getElementById("tableSeats"),
  log: document.getElementById("log"),
  discard: document.getElementById("discard"),

  lossModal: document.getElementById("lossModal"),
  lossReason: document.getElementById("lossReason"),
  lossChoices: document.getElementById("lossChoices"),

  exchangeModal: document.getElementById("exchangeModal"),
  exchangeInfo: document.getElementById("exchangeInfo"),
  exchangeChoices: document.getElementById("exchangeChoices"),
  exchangeConfirmBtn: document.getElementById("exchangeConfirmBtn"),
};

let myId = null;
let state = null;
let joined = false;

let hideMyCards = false;
let selectedAction = null;
let exchangeSelected = [];

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
  { type: "income", label: "Renda (+1)", needsTarget: false },
  {
    type: "foreign_aid",
    label: "Ajuda Externa (+2) (bloqueável)",
    needsTarget: false,
  },
  { type: "tax", label: "Taxar (+3) [Duque]", needsTarget: false },
  {
    type: "assassinate",
    label: "Assassinar (3) [Assassino] (bloqueável)",
    needsTarget: true,
  },
  {
    type: "steal",
    label: "Roubar (2) [Capitão] (bloqueável)",
    needsTarget: true,
  },
  { type: "exchange", label: "Trocar [Embaixador]", needsTarget: false },
  { type: "coup", label: "Golpe (7)", needsTarget: true },
];

socket.on("connect", () => {
  myId = socket.id;
});

socket.on("state", (s) => {
  state = s;
  renderAll();
});

els.joinBtn.onclick = () => {
  const nick = (els.nickInput.value || "").trim().slice(0, 20);
  if (!nick) return alert("Digite um nick.");
  socket.emit("join", { roomKey, nick });
  joined = true;
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

els.confirmActionBtn.onclick = () => {
  if (!selectedAction?.needsTarget) return;
  const targetId = els.targetSelect.value || null;
  socket.emit("action", { type: selectedAction.type, targetId });
  selectedAction = null;
  els.targetWrap.classList.add("hidden");
};

els.exchangeConfirmBtn.onclick = () => {
  if (!state?.exchangeForViewer) return;
  socket.emit("exchange_pick", { keep: exchangeSelected.map((x) => x.role) });
};

function isMyTurn() {
  return (
    state?.started && state.phase === "turn" && state.currentPlayerId === myId
  );
}

function amIInGame() {
  return (state?.playersInGame || []).some((p) => p.id === myId);
}

function resetChoiceStyles() {
  // reaction
  els.acceptBtn.classList.remove("chosen");
  els.contestBtn.classList.remove("chosen");
  els.blockBtn.classList.remove("chosen");
  els.acceptBtn.disabled = false;
  els.contestBtn.disabled = false;
  els.blockBtn.disabled = false;
  els.blockPickRow.classList.add("hidden");

  // block challenge
  els.blockAcceptBtn.classList.remove("chosen");
  els.blockContestBtn.classList.remove("chosen");
  els.blockAcceptBtn.disabled = false;
  els.blockContestBtn.disabled = false;
}

function renderJoinOrGame() {
  if (!joined) {
    els.joinBox.classList.remove("hidden");
    els.gameBox.classList.add("hidden");
  } else {
    els.joinBox.classList.add("hidden");
    els.gameBox.classList.remove("hidden");
  }
}

function renderTop() {
  if (!state) return;

  els.phase.textContent = state.started
    ? `Fase: ${state.phase.toUpperCase()}`
    : "Lobby (aguardando READY e início)";

  if (!state.started) {
    els.timer.textContent = "";
    return;
  }

  if (state.phase === "turn")
    els.timer.textContent = `Turno: ${UI.timeLeft(state.turnEndsAt)}`;
  else if (state.phase === "reaction")
    els.timer.textContent = `Resposta: ${UI.timeLeft(state.reactionEndsAt)}`;
  else if (state.phase === "block_challenge")
    els.timer.textContent = `Contestação do bloqueio: ${UI.timeLeft(state.blockChallengeEndsAt)}`;
  else if (state.phase === "exchange_select" && state.exchangeForViewer?.endsAt)
    els.timer.textContent = `Troca: ${UI.timeLeft(state.exchangeForViewer.endsAt)}`;
  else els.timer.textContent = "";
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
  const canRestart = !!state.started;

  els.startBtn.disabled = !canStart;
  els.restartBtn.disabled = !canRestart;
}

function renderRoomPeople() {
  els.roomPeople.innerHTML = "";
  const people = state?.roomPlayers || [];

  if (!people.length) {
    const empty = document.createElement("div");
    empty.style.color = "rgba(255,255,255,.65)";
    empty.textContent = "Ninguém conectado.";
    els.roomPeople.appendChild(empty);
    return;
  }

  for (const p of people) {
    const row = document.createElement("div");
    row.className = "lobbyItem";
    row.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px">
        <span class="readyDot ${p.ready ? "on" : ""}"></span>
        <b>${p.nick}${p.isHost ? " 👑" : ""}</b>
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
    const empty = document.createElement("div");
    empty.style.color = "rgba(255,255,255,.65)";
    empty.textContent = "Ninguém no lobby.";
    els.lobby.appendChild(empty);
  } else {
    for (const p of list) {
      const row = document.createElement("div");
      row.className = "lobbyItem";
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px">
          <span class="readyDot ${p.ready ? "on" : ""}"></span>
          <b>${p.nick}</b>
        </div>
        <span class="readyTag">${p.ready ? "READY" : "NOT READY"}</span>
      `;
      els.lobby.appendChild(row);
    }
  }

  const meLobby = list.find((p) => p.id === myId);
  els.readyBtn.textContent = meLobby?.ready ? "Cancelar READY" : "Ficar READY";
  els.readyBtn.disabled = !!state.started;
}

function renderActions() {
  // ✅ FILA / ESPECTADOR não vê ações
  if (!amIInGame()) {
    els.actions.innerHTML = `<div style="color:rgba(255,255,255,.65);font-size:13px">
      Você está na fila. Aguarde a próxima partida.
    </div>`;
    els.targetWrap.classList.add("hidden");
    selectedAction = null;
    return;
  }

  els.actions.innerHTML = "";
  const can = isMyTurn() && amIInGame();

  for (const a of ACTIONS) {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = a.label;
    btn.disabled = !can;

    btn.onclick = () => {
      selectedAction = a;

      if (!a.needsTarget) {
        socket.emit("action", { type: a.type, targetId: null });
        selectedAction = null;
        els.targetWrap.classList.add("hidden");
        return;
      }

      renderTargets();
      els.targetWrap.classList.remove("hidden");
    };

    els.actions.appendChild(btn);
  }

  if (!can) {
    selectedAction = null;
    els.targetWrap.classList.add("hidden");
  }
}

function renderTargets() {
  els.targetSelect.innerHTML = "";
  const players = state?.playersInGame || [];
  const targets = players.filter(
    (p) => p.id !== myId && p.connected && p.aliveCount > 0,
  );

  for (const p of targets) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.nick;
    els.targetSelect.appendChild(opt);
  }

  if (!targets.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "(sem alvos)";
    els.targetSelect.appendChild(opt);
  }
}

function canIBlock(pending) {
  if (!pending?.blockInfo?.blockable) return false;
  if (pending.block) return false;

  const t = pending.action.type;
  if (t === "foreign_aid") return myId !== pending.actorId;
  if ((t === "assassinate" || t === "steal") && pending.action.targetId)
    return myId === pending.action.targetId;
  return false;
}

function renderReactionBoxes() {
  // ✅ FILA / ESPECTADOR não vê responder
  if (!amIInGame()) {
    els.reactionBox.classList.add("hidden");
    els.blockChallengeBox.classList.add("hidden");
    return;
  }

  const pending = state?.pendingAction;

  // sempre reseta o visual antes (pra não ficar “travado” entre fases)
  resetChoiceStyles();

  // ========= Reaction phase =========
  if (!pending || state.phase !== "reaction" || pending.actorId === myId) {
    els.reactionBox.classList.add("hidden");
  } else {
    const claim = pending.claimRole ? ` (alegando ${pending.claimRole})` : "";
    const players = state.playersInGame || [];
    const targetNick = pending.action.targetId
      ? players.find((p) => p.id === pending.action.targetId)?.nick || "?"
      : null;

    els.pendingText.textContent =
      `${pending.actorNick} declarou ${pending.action.type.toUpperCase()}${claim}` +
      (targetNick ? ` em ${targetNick}` : "");

    const myReaction = state.reactions?.[myId];

    // destaque visual da escolha
    els.acceptBtn.classList.toggle("chosen", myReaction === "accept");
    els.contestBtn.classList.toggle("chosen", myReaction === "contest");
    els.blockBtn.classList.toggle("chosen", myReaction === "block");

    // se já escolheu, trava tudo
    if (myReaction) {
      els.acceptBtn.disabled = true;
      els.contestBtn.disabled = true;
      els.blockBtn.disabled = true;
    }

    // contestar só quando há claim
    els.contestBtn.style.display = pending.claimRole ? "inline-block" : "none";

    const canBlock = canIBlock(pending) && !myReaction;
    els.blockBtn.disabled = !canBlock;
    els.blockBtn.style.display = pending.blockInfo?.blockable
      ? "inline-block"
      : "none";

    els.reactionBox.classList.remove("hidden");
  }

  // ========= Block challenge phase =========
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

    if (myDecision) {
      els.blockAcceptBtn.disabled = true;
      els.blockContestBtn.disabled = true;
    }

    els.blockText.textContent = `${blk.blockerNick} bloqueou (${blk.claimRole}). Você aceita ou contesta?`;
    els.blockChallengeBox.classList.remove("hidden");
  }
}

function renderMiniCard(card, showRole) {
  if (!card)
    return `<div class="miniCard back"><div class="label">CARTA</div></div>`;
  const alive = card.alive;
  const roleToShow = showRole ? card.role : alive ? null : card.role;
  const cls = roleToShow ? UI.roleClass(roleToShow) : "back";
  const deadCls = alive ? "" : "dead";
  const label = roleToShow ? roleToShow : "CARTA";
  return `<div class="miniCard ${cls} ${deadCls}"><div class="label">${label}</div></div>`;
}

function getSeatResponseBadgeText(p) {
  // mostra decisão ao lado do jogador na mesa
  if (state.phase === "reaction" && state.pendingAction) {
    const v = state.reactions?.[p.id];
    if (v === "accept") return "ACEITA";
    if (v === "contest") return "CONTESTA";
    if (v === "block") return "BLOQUEIA";
  }
  if (state.phase === "block_challenge" && state.pendingAction?.block) {
    const v = state.blockChallenges?.[p.id];
    if (v === "accept") return "ACEITA";
    if (v === "contest") return "CONTESTA";
  }
  return "";
}

function renderTable() {
  els.tableSeats.innerHTML = "";

  const players = state?.playersInGame || [];
  const n = Math.min(players.length, 6);

  if (state?.started && n === 0) {
    els.tableSeats.innerHTML = `
      <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
      padding:14px;border:1px solid rgba(255,255,255,.15);border-radius:14px;
      background:rgba(0,0,0,.35);color:rgba(255,255,255,.85);max-width:520px;text-align:center">
        <b>Mesa vazia:</b> playersInGame veio vazio do servidor.<br/>
        Isso normalmente acontece se ninguém estava READY no momento do start, ou se não atualizou todos arquivos.
      </div>
    `;
    return;
  }

  if (n <= 0) return;

  const pos = UI.seatPositions(n);

  for (let i = 0; i < n; i++) {
    const p = players[i];
    const seat = document.createElement("div");
    seat.className = `seat ${p.id === myId ? "me" : ""}`;

    const responded =
      (state.phase === "reaction" &&
        p.id !== state.pendingAction?.actorId &&
        state.reactionResponded?.[p.id] != null) ||
      (state.phase === "block_challenge" &&
        p.id !== state.pendingAction?.block?.blockerId &&
        state.blockResponded?.[p.id] != null);

    if (responded) seat.classList.add("responded");

    seat.style.left = pos[i].x + "%";
    seat.style.top = pos[i].y + "%";

    const current = state.phase === "turn" && state.currentPlayerId === p.id;
    const timerText = current ? `Vez: ${UI.timeLeft(state.turnEndsAt)}` : "—";
    const showMy = p.id === myId && !hideMyCards;

    const badge = getSeatResponseBadgeText(p);

    seat.innerHTML = `
      <div class="seatTop">
        <div class="playerName"><span class="personIcon">👤</span> <span>${p.nick}</span></div>
        <div style="display:flex;align-items:center;gap:8px">
          ${badge ? `<span class="respBadge">${badge}</span>` : ``}
          <div class="moneyTag"><span class="micon">🟡</span><span>${p.coins}</span></div>
        </div>
      </div>
      <div class="turnTimer ${current ? "on" : ""}">${timerText}</div>
      <div class="miniHand">
        ${renderMiniCard(p.hand?.[0], showMy)}
        ${renderMiniCard(p.hand?.[1], showMy)}
      </div>
    `;

    els.tableSeats.appendChild(seat);
  }
}

function renderLog() {
  els.log.innerHTML = "";
  for (const it of state?.actionLog || []) {
    const div = document.createElement("div");
    div.className = "item";
    div.textContent = it.text;
    els.log.appendChild(div);
  }
  els.log.scrollTop = els.log.scrollHeight;
}

function renderDiscard() {
  els.discard.innerHTML = "";
  for (const d of state?.discard || []) {
    const div = document.createElement("div");
    div.className = "item";
    div.textContent = `${d.ownerNick}: ${d.role} — ${d.reason}`;
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

  els.lossReason.textContent = lf.reason;
  els.lossChoices.innerHTML = "";

  for (const c of lf.aliveCards) {
    const card = document.createElement("div");
    card.className = `card ${UI.roleClass(c.role)} pickable`;
    card.innerHTML = `<div class="label">${c.role}</div>`;
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

  els.exchangeInfo.textContent = `Escolha ${ex.keepCount} carta(s) para manter.`;
  els.exchangeChoices.innerHTML = "";
  exchangeSelected = [];

  for (let idx = 0; idx < ex.options.length; idx++) {
    const role = ex.options[idx];
    const card = document.createElement("div");
    card.className = `card ${UI.roleClass(role)} pickable`;
    card.dataset.role = role;
    card.dataset.idx = String(idx);
    card.innerHTML = `<div class="label">${role}</div>`;

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
  }

  els.exchangeConfirmBtn.disabled = true;
  els.exchangeModal.classList.remove("hidden");
}

function renderAll() {
  if (!state) return;

  renderJoinOrGame();
  renderTop();

  renderRoomPeople();
  renderLobby();
  renderHostButtons();

  renderActions();
  renderReactionBoxes();
  renderTable();

  renderLog();
  renderDiscard();
  renderLossModal();
  renderExchangeModal();
}

setInterval(() => {
  if (!state) return;
  renderTop();
  if (state.started) renderTable();
}, 250);
