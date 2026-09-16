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

  avatarInput: document.getElementById("avatarInput"),
  avatarPreview: document.getElementById("avatarPreview"),
  avatarHint: document.getElementById("avatarHint"),

  hostControls: document.getElementById("hostControls"),
  startBtn: document.getElementById("startBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  restartBtn: document.getElementById("restartBtn"),
  readyBtn: document.getElementById("readyBtn"),

  editProfileBtn: document.getElementById("editProfileBtn"),
  themePicker: document.getElementById("themePicker"),
  themeRow: document.getElementById("themeRow"),

  profileModal: document.getElementById("profileModal"),
  pfNick: document.getElementById("pfNick"),
  pfAvatar: document.getElementById("pfAvatar"),
  pfPreview: document.getElementById("pfPreview"),
  pfHint: document.getElementById("pfHint"),
  pfSave: document.getElementById("pfSave"),
  pfCancel: document.getElementById("pfCancel"),

  pauseOverlay: document.getElementById("pauseOverlay"),
  pauseBy: document.getElementById("pauseBy"),
  pauseClock: document.getElementById("pauseClock"),
  resumeBtn: document.getElementById("resumeBtn"),

  roomPeople: document.getElementById("roomPeople"),
  seatCount: document.getElementById("seatCount"),
  queue: document.getElementById("queue"),
  queueCount: document.getElementById("queueCount"),

  turnHint: document.getElementById("turnHint"),
  actions: document.getElementById("actions"),
  targetBar: document.getElementById("targetBar"),
  targetActionName: document.getElementById("targetActionName"),
  cancelTargetBtn: document.getElementById("cancelTargetBtn"),

  responseModal: document.getElementById("responseModal"),
  respTimer: document.getElementById("respTimer"),
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
  bankPile: document.getElementById("bankPile"),
  deckCount: document.getElementById("deckCount"),

  quickChat: document.getElementById("quickChat"),
  chatInput: document.getElementById("chatInput"),
  chatSend: document.getElementById("chatSend"),
  chatLeft: document.getElementById("chatLeft"),

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

/* ------------------------------------------------------------------ */
/* identidade persistente                                               */
/*                                                                      */
/* O pid fica no sessionStorage (por ABA), não no localStorage:         */
/*  - sobrevive a F5 e a queda de conexão -> você volta para o mesmo    */
/*    lugar, com a mesma mão, moedas e vez;                             */
/*  - duas abas na mesma máquina continuam sendo DOIS jogadores, o que  */
/*    localStorage quebraria (as duas virariam a mesma pessoa).         */
/* Nick e foto ficam no localStorage só para pré-preencher o formulário.*/
/* ------------------------------------------------------------------ */

function store(area, key, val) {
  try {
    if (val === undefined) return area.getItem(key);
    area.setItem(key, val);
    return val;
  } catch {
    return null;
  }
}

function getMyPid() {
  let pid = store(sessionStorage, "coup.pid");
  if (!pid) {
    pid =
      "p" +
      Math.random().toString(36).slice(2, 12) +
      Math.random().toString(36).slice(2, 8);
    store(sessionStorage, "coup.pid", pid);
  }
  return pid;
}

const MY_PID = getMyPid();

let myId = MY_PID;
let state = null;
let joined = false;
let myNick = store(localStorage, "coup.nick") || "";
let myAvatar = store(localStorage, "coup.avatar") || "";

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
    icon: "💵",
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
    tag: "↔",
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

// chat rápido: cada opção vira um evento "emote" no servidor
const QUICK = [
  { kind: "bang", icon: "🤜", label: "Bater na mesa" },
  { kind: "clap", icon: "👏", label: "Nice!" },
  { kind: "thumbs", icon: "👍", label: "Boa!" },
  { kind: "laugh", icon: "😂", label: "Kkkk" },
  { kind: "think", icon: "🤔", label: "Será?" },
  { kind: "lie", icon: "🤥", label: "Mentira!" },
  { kind: "sweat", icon: "😰", label: "Tenso..." },
  // "L" como letra: os emojis de mão em L são de 2022 e podem não existir
  { kind: "l13", icon: "L", label: "Faz o L" },
  { kind: "finger", icon: "🖕", label: "FDP" },
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
  myId = MY_PID;
  // reentra sozinho após F5 / queda: o servidor reconhece o pid e devolve
  // o mesmo lugar na partida
  if (myNick) doJoin();
});

socket.on("me", ({ pid }) => {
  if (pid) myId = pid;
});

socket.on("state", (s) => {
  const prev = state;
  state = s;
  // o tema decide de qual pasta vêm as artes: tem de valer antes do render
  applyTheme(s.theme);
  renderAll();
  // a cena 3D recebe o MESMO estado; muda só o desenho
  window.COUP3D?.onState(s, myId);
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
// banco de moedas no centro: origem/destino das moedas que entram e saem
function bankRect() {
  return FX.rect(els.bankPile) || deckRect();
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
        const bank = bankRect();
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
        FX.ping(els.bankPile, "bankPulse", 600);
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

    case "chat":
      // balão não entra na fila: tem de aparecer na hora
      showChatBubble(ev.playerId, ev.text);
      break;

    case "emote":
      playEmote(ev);
      break;

    case "paused":
      FX.clearQueue();
      FX.banner({ title: `⏸ ${ev.byNick} pausou`, cls: "warn", dur: 1400 });
      break;

    case "resumed":
      FX.banner({
        title: "▶ Partida retomada",
        sub: ev.auto ? "a pausa esgotou" : "",
        cls: "good",
        dur: 1300,
      });
      break;

    case "disconnected":
      FX.enqueue(() => {
        FX.banner({
          title: `🔌 ${ev.nick} caiu`,
          sub: "pode voltar sem perder o lugar",
          cls: "warn",
          dur: 1500,
        });
        FX.ping(seatEls.get(ev.playerId)?.root, "blockPulse", 900);
      }, 700);
      break;

    case "reconnected":
      FX.enqueue(() => {
        FX.banner({
          title: `🔌 ${ev.nick} voltou`,
          sub: ev.seated === false ? "a sala encheu — foi para a fila" : "",
          cls: "good",
          dur: 1400,
        });
        FX.ping(seatEls.get(ev.playerId)?.root, "turnPulse", 900);
      }, 700);
      break;

    // ---- presença no lobby ----
    case "joined":
      FX.banner({
        title: `👋 ${ev.nick} entrou`,
        sub: ev.seated ? "" : "está na fila",
        dur: 1200,
      });
      break;

    case "left":
      FX.banner({ title: `${ev.nick} saiu`, cls: "warn", dur: 1100 });
      break;

    case "ready":
      FX.banner({
        title: `${ev.ready ? "✔" : "✖"} ${ev.nick}`,
        sub: ev.ready ? "pronto" : "cancelou o READY",
        cls: ev.ready ? "good" : "",
        dur: 1000,
      });
      break;

    case "host":
      FX.banner({ title: `👑 ${ev.nick} agora é o host`, cls: "warn", dur: 1500 });
      break;

    case "seated":
      FX.banner({ title: `${ev.nick} entrou na mesa`, cls: "good", dur: 1200 });
      break;

    case "queued":
      FX.banner({ title: `${ev.nick} voltou para a fila`, cls: "warn", dur: 1200 });
      break;
  }
}

/* ------------------------------------------------------------------ */
/* chat e chat rápido na mesa                                           */
/* ------------------------------------------------------------------ */

const chatTimers = new Map();

function showChatBubble(playerId, text) {
  const s = seatEls.get(playerId);
  if (!s) return; // quem está na fila não tem card; a mensagem fica só no Log

  s.chat.textContent = text;
  s.chat.classList.add("on");
  FX.ping(s.chat, "chatIn", 420);

  clearTimeout(chatTimers.get(playerId));
  // mensagens longas ficam mais tempo na tela
  const ms = Math.min(9000, 3200 + text.length * 45);
  chatTimers.set(
    playerId,
    setTimeout(() => s.chat.classList.remove("on"), ms),
  );
}

const EMOTE_TEXT = {
  clap: "Nice!",
  thumbs: "Boa!",
  laugh: "Kkkkk",
  think: "Será?",
  lie: "Mentira!",
  sweat: "Tenso...",
  bang: "",
  finger: "filha da puta",
  l13: "",
};

function playEmote(ev) {
  window.COUP3D?.onEmote(ev);
  // a mensagem não depende de medir o card: vem primeiro, para nunca se
  // perder caso o assento ainda não tenha layout
  const txt = EMOTE_TEXT[ev.kind];
  if (txt) showChatBubble(ev.playerId, txt);

  const s = seatEls.get(ev.playerId);
  const at = seatRect(ev.playerId);
  if (!at) return;

  switch (ev.kind) {
    case "bang":
      // mão batendo na mesa: o card treme e as cartas de TODOS balançam
      FX.handBang(at);
      FX.ping(s?.card, "cardShakeHard", 900);
      for (const [, o] of seatEls)
        o.cards.forEach((c, i) => FX.ping(c, "cardJolt", 700 + i * 60));
      break;

    case "finger":
      FX.handRise(at, "🖕");
      break;

    case "l13":
      FX.handL(at);
      break;

    case "clap":
      FX.clap(at);
      break;

    default:
      FX.floatText({ at, text: QUICK.find((q) => q.kind === ev.kind)?.icon || "!", cls: "big" });
  }
}

/* ------------------------------------------------------------------ */
/* inputs                                                               */
/* ------------------------------------------------------------------ */

function doJoin() {
  socket.emit("join", {
    roomKey,
    nick: myNick,
    pid: MY_PID,
    avatar: myAvatar || null,
  });
  joined = true;
}

els.joinBtn.onclick = () => {
  const nick = (els.nickInput.value || "").trim().slice(0, 20);
  if (!nick) return alert("Digite um nick.");

  const avatar = (els.avatarInput.value || "").trim();
  if (avatar && !/^https?:\/\//i.test(avatar))
    return alert("O link da foto precisa começar com http:// ou https://");

  myNick = nick;
  myAvatar = avatar;
  store(localStorage, "coup.nick", myNick);
  store(localStorage, "coup.avatar", myAvatar);

  doJoin();
};

els.nickInput.onkeydown = (e) => {
  if (e.key === "Enter") els.joinBtn.click();
};
els.avatarInput.onkeydown = (e) => {
  if (e.key === "Enter") els.joinBtn.click();
};

// prévia da foto enquanto digita
function refreshAvatarPreview() {
  const url = (els.avatarInput.value || "").trim();
  const ok = /^https?:\/\//i.test(url);
  els.avatarPreview.innerHTML = ok
    ? `<img src="${UI.escape(url)}" alt="" onerror="this.parentElement.innerHTML='<span>❌</span>'" />`
    : `<span>👤</span>`;
  els.avatarHint.textContent = url
    ? ok
      ? "Se a imagem não aparecer aqui, o link não serve."
      : "Precisa começar com http:// ou https://"
    : "Opcional. Aparece no seu card na mesa.";
}
els.avatarInput.oninput = refreshAvatarPreview;

// pré-preenche com o que já foi usado antes
els.nickInput.value = myNick;
els.avatarInput.value = myAvatar;
refreshAvatarPreview();

els.pauseBtn.onclick = () => socket.emit("pause");
els.resumeBtn.onclick = () => socket.emit("resume");

/* ---------------- perfil (nick + foto) ---------------- */

function pfRefreshPreview() {
  const url = (els.pfAvatar.value || "").trim();
  const ok = /^https?:\/\//i.test(url);
  els.pfPreview.innerHTML = ok
    ? `<img src="${UI.escape(url)}" alt="" onerror="this.parentElement.innerHTML='<span>❌</span>'" />`
    : `<span>👤</span>`;
  els.pfHint.textContent = url
    ? ok
      ? "Se a imagem não aparecer aqui, o link não serve."
      : "Precisa começar com http:// ou https://"
    : "Opcional. Aparece no seu card na mesa.";
}

function openProfile() {
  if (state?.started) return; // trava durante a partida
  els.pfNick.value = myNick;
  els.pfAvatar.value = myAvatar;
  pfRefreshPreview();
  els.profileModal.classList.remove("hidden");
  els.pfNick.focus();
}

function closeProfile() {
  els.profileModal.classList.add("hidden");
}

els.editProfileBtn.onclick = openProfile;
els.pfCancel.onclick = closeProfile;
els.pfAvatar.oninput = pfRefreshPreview;

els.pfSave.onclick = () => {
  const nick = (els.pfNick.value || "").trim().slice(0, 20);
  if (!nick) return alert("Digite um nick.");

  const avatar = (els.pfAvatar.value || "").trim();
  if (avatar && !/^https?:\/\//i.test(avatar))
    return alert("O link da foto precisa começar com http:// ou https://");

  myNick = nick;
  myAvatar = avatar;
  store(localStorage, "coup.nick", myNick);
  store(localStorage, "coup.avatar", myAvatar);

  socket.emit("profile", { nick: myNick, avatar: myAvatar || null });
  closeProfile();
};

els.pfNick.onkeydown = els.pfAvatar.onkeydown = (e) => {
  if (e.key === "Enter") els.pfSave.click();
};

/* ---------------- tema ---------------- */

const THEME_META = {
  politica: { label: "Política", dot: "#2dd36f" },
  qualitas: { label: "Qualitas", dot: "#ff8a00" },
};

function applyTheme(theme) {
  const t = THEME_META[theme] ? theme : "politica";

  // marca sempre: no primeiro estado o tema já é o padrão e, sem isso,
  // o body ficaria sem data-theme nenhum
  document.body.dataset.theme = t;

  if (UI.theme === t) return;
  UI.theme = t;

  // as artes já renderizadas apontam para a pasta do tema antigo:
  // força o redesenho de tudo que usa imagem de carta
  for (const [, s] of seatEls) s.cards.forEach((c) => (c.dataset.sig = ""));
  els.roleGuide.dataset.done = "";
  els.roleGuide.innerHTML = "";
  els.discard.dataset.n = "";
}

function renderThemePicker() {
  const themes = state?.themes || ["politica", "qualitas"];
  const cur = state?.theme || "politica";
  const isHost = state?.hostId === myId;

  const sig = `${themes.join(",")}|${cur}|${isHost}`;
  if (els.themePicker.dataset.sig === sig) return;
  els.themePicker.dataset.sig = sig;

  els.themePicker.innerHTML = "";
  for (const t of themes) {
    const meta = THEME_META[t] || { label: t, dot: "#888" };
    const b = document.createElement("button");
    b.className = `themeBtn ${t === cur ? "on" : ""}`;
    b.innerHTML = `<i style="background:${meta.dot}"></i>${UI.escape(meta.label)}`;
    b.disabled = !isHost;
    b.title = isHost
      ? `Usar o tema ${meta.label}`
      : "Só o host troca o tema da sala";
    b.onclick = () => socket.emit("theme", { theme: t });
    els.themePicker.appendChild(b);
  }
}

/* ---------------- chat ---------------- */

function sendChat() {
  const t = (els.chatInput.value || "").trim().slice(0, 150);
  if (!t) return;
  socket.emit("chat", { text: t });
  els.chatInput.value = "";
  updateChatCount();
}

function updateChatCount() {
  els.chatLeft.textContent = String(150 - (els.chatInput.value || "").length);
}

els.chatSend.onclick = sendChat;
els.chatInput.oninput = updateChatCount;
els.chatInput.onkeydown = (e) => {
  if (e.key === "Enter") sendChat();
};
updateChatCount();

function renderQuickChat() {
  if (els.quickChat.dataset.done) return;
  els.quickChat.dataset.done = "1";

  for (const q of QUICK) {
    const b = document.createElement("button");
    b.className = `qBtn q-${q.kind}`;
    b.title = q.label;
    b.innerHTML = `<span class="qIcon">${q.icon}</span><span class="qLbl">${UI.escape(q.label)}</span>`;
    b.onclick = () => socket.emit("emote", { kind: q.kind });
    els.quickChat.appendChild(b);
  }
}

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

  // só conta quem está SENTADO — a fila não entra na conta
  const seated = state.roomPlayers || [];
  const max = state.maxSeats ?? 6;

  const allReady = seated.length >= 2 && seated.every((p) => p.ready);
  const canStart =
    !state.started && seated.length >= 2 && seated.length <= max && allReady;

  els.pauseBtn.style.display = state.started ? "inline-flex" : "none";
  els.pauseBtn.disabled = !state.started || !!state.paused;
  els.pauseBtn.title = state.paused
    ? "Já está pausado"
    : "Pausar a partida (máx. 3 min)";

  els.startBtn.disabled = !canStart;
  els.startBtn.title = canStart
    ? "Começar a partida"
    : state.started
      ? "A partida já começou"
      : seated.length < 2
        ? "Precisa de pelo menos 2 jogadores na sala"
        : "Todos na sala precisam estar READY";
  els.restartBtn.disabled = !state.started;
}

function renderRoomPeople() {
  const people = state?.roomPlayers || [];
  const isHost = state?.hostId === myId;
  const max = state?.maxSeats ?? 6;

  els.seatCount.textContent = `${people.length}/${max}`;

  // sem isso a lista inteira re-animava a cada mensagem de chat
  const sig = JSON.stringify([
    people.map((p) => [p.id, p.nick, p.ready, p.inGame, p.connected, p.isHost]),
    isHost,
    !!state.started,
  ]);
  if (els.roomPeople.dataset.sig === sig) return;
  els.roomPeople.dataset.sig = sig;

  els.roomPeople.innerHTML = "";

  if (!people.length) {
    els.roomPeople.innerHTML = `<div class="emptyNote">Sala vazia.</div>`;
    return;
  }

  for (const p of people) {
    const off = p.connected === false;
    const row = document.createElement("div");
    row.className = `lobbyItem ${off ? "offlineRow" : ""}`;
    row.innerHTML = `
      <div class="lobbyWho">
        <span class="readyDot ${off ? "off" : p.ready ? "on" : ""}"></span>
        <b>${UI.escape(p.nick)}${p.isHost ? " 👑" : ""}</b>
      </div>
      <span class="readyTag">${
        off
          ? "CAIU — pode voltar"
          : p.inGame
            ? "EM JOGO"
            : p.ready
              ? "READY"
              : "NOT READY"
      }</span>
    `;

    // host pode devolver alguém para a fila enquanto não começou
    if (isHost && !state.started && p.id !== myId) {
      const btn = document.createElement("button");
      btn.className = "btn tiny";
      btn.textContent = "→ fila";
      btn.title = `Mandar ${p.nick} para a fila`;
      btn.onclick = () => socket.emit("demote", { playerId: p.id });
      row.querySelector(".readyTag").replaceWith(btn);
    }

    els.roomPeople.appendChild(row);
  }
}

function renderQueue() {
  const list = state?.queue || [];
  const isHost = state?.hostId === myId;
  const free = state?.seatsFree ?? 0;

  els.queueCount.textContent = list.length ? String(list.length) : "";

  const sig = JSON.stringify([
    list.map((p) => [p.id, p.nick, p.isHost]),
    isHost,
    free,
    !!state.started,
  ]);
  if (els.queue.dataset.sig === sig) return;
  els.queue.dataset.sig = sig;

  els.queue.innerHTML = "";

  if (!list.length) {
    els.queue.innerHTML = `<div class="emptyNote">Ninguém esperando.</div>`;
    return;
  }

  for (const p of list) {
    const row = document.createElement("div");
    row.className = `lobbyItem ${p.id === myId ? "meRow" : ""}`;
    row.innerHTML = `
      <div class="lobbyWho">
        <span class="queueDot"></span>
        <b>${UI.escape(p.nick)}${p.isHost ? " 👑" : ""}</b>
      </div>
    `;

    if (isHost) {
      const btn = document.createElement("button");
      btn.className = "btn tiny ok";
      btn.textContent = "Puxar";
      const can = !state.started && free > 0;
      btn.disabled = !can;
      btn.title = can
        ? `Trazer ${p.nick} para a sala`
        : state.started
          ? "Não dá para puxar com a partida em andamento"
          : "A sala está cheia";
      btn.onclick = () => socket.emit("promote", { playerId: p.id });
      row.appendChild(btn);
    } else {
      const tag = document.createElement("span");
      tag.className = "readyTag";
      tag.textContent = "AGUARDANDO";
      row.appendChild(tag);
    }

    els.queue.appendChild(row);
  }
}

function renderProfileButton() {
  const playing = !!state?.started;
  els.editProfileBtn.disabled = playing;
  els.editProfileBtn.title = playing
    ? "Não dá para trocar nick ou foto durante a partida"
    : "Trocar seu nick e sua foto";

  // se a partida começar com o modal aberto, fecha
  if (playing && !els.profileModal.classList.contains("hidden"))
    closeProfile();
}

function renderReadyButton() {
  const seat = (state?.roomPlayers || []).find((p) => p.id === myId);

  // quem está na fila não fica READY
  if (!seat) {
    els.readyBtn.textContent = "Na fila";
    els.readyBtn.classList.remove("ok");
    els.readyBtn.disabled = true;
    els.readyBtn.title = "Você está na fila — aguarde o host puxar você";
    return;
  }

  els.readyBtn.textContent = seat.ready ? "Cancelar READY" : "Ficar READY";
  els.readyBtn.classList.toggle("ok", !!seat.ready);
  els.readyBtn.disabled = !!state.started;
  els.readyBtn.title = state.started
    ? "Partida em andamento"
    : "Marque READY para o host poder iniciar";
}

function renderTurnHint() {
  if (!state?.started) {
    els.turnHint.className = "turnHint";
    els.turnHint.textContent = "Partida não iniciada.";
    return;
  }
  if (!amIInGame()) {
    const inQueue = (state.queue || []).some((p) => p.id === myId);
    els.turnHint.className = "turnHint";
    els.turnHint.textContent = inQueue
      ? "Você está na fila. O host precisa te puxar para a sala."
      : "Você está na sala, mas fora desta partida. Aguarde a próxima.";
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
      <span class="gThumb">${UI.roleArt(role)}</span>
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
  const m = me();
  if (!m || m.aliveCount <= 0) {
    els.reactionBox.classList.add("hidden");
    els.blockChallengeBox.classList.add("hidden");
    els.responseModal.classList.add("hidden");
    return;
  }

  const pending = state?.pendingAction;
  resetChoiceStyles();

  // ---- fase de reação ----
  // o modal some assim que EU respondo: minha resposta passa a aparecer
  // ao lado do meu card na mesa
  const myReactionNow = state?.reactions?.[myId];
  if (
    !pending ||
    state.phase !== "reaction" ||
    pending.actorId === myId ||
    myReactionNow
  ) {
    els.reactionBox.classList.add("hidden");
  } else {
    const claim = pending.claimRole
      ? ` alegando ${UI.rolePt(pending.claimRole)}`
      : "";
    const targetNick = pending.action.targetId
      ? nickOf(pending.action.targetId)
      : null;

    // nomes destacados: quem está agindo e quem vai receber
    els.pendingText.innerHTML =
      `<span class="nmActor">${UI.escape(pending.actorNick)}</span> declarou ` +
      `${UI.escape(UI.actionLabel(pending.action.type))}${UI.escape(claim)}` +
      (targetNick
        ? ` contra <span class="nmTarget">${UI.escape(targetNick)}</span>`
        : "");

    els.reactionHint.textContent = blockHint(pending);

    // só aparece o que dá para usar
    els.contestBtn.style.display = pending.claimRole ? "inline-flex" : "none";
    els.blockBtn.style.display = canIBlock(pending) ? "inline-flex" : "none";

    els.reactionBox.classList.remove("hidden");
  }

  // ---- fase de contestação do bloqueio ----
  const myDecisionNow = state?.blockChallenges?.[myId];
  if (
    state.phase !== "block_challenge" ||
    !pending?.block ||
    pending.block.blockerId === myId ||
    myDecisionNow
  ) {
    els.blockChallengeBox.classList.add("hidden");
  } else {
    const blk = pending.block;

    els.blockText.textContent = `${blk.blockerNick} bloqueou alegando ${UI.rolePt(blk.claimRole)}.`;
    els.blockChallengeHint.textContent = `Se você contestar e ${blk.blockerNick} tiver mesmo ${UI.rolePt(blk.claimRole)}, você perde uma carta.`;

    els.blockChallengeBox.classList.remove("hidden");
  }

  // o modal existe enquanto houver alguma pergunta aberta para mim
  const open =
    !els.reactionBox.classList.contains("hidden") ||
    !els.blockChallengeBox.classList.contains("hidden");

  els.responseModal.classList.toggle("hidden", !open);
  if (open) renderRespTimer();
}

// contagem regressiva dentro do modal de resposta
function renderRespTimer() {
  if (!state || els.responseModal.classList.contains("hidden")) return;

  const ts =
    state.phase === "reaction"
      ? state.reactionEndsAt
      : state.blockChallengeEndsAt;
  if (!ts) {
    els.respTimer.textContent = "";
    return;
  }

  const left = UI.secsLeft(ts);
  els.respTimer.textContent = `⏱ ${UI.timeLeft(ts)}`;
  els.respTimer.classList.toggle("urgent", left <= 10);
}

/* ---------------- mesa (render incremental) ---------------- */

const seatEls = new Map();

function buildSeat(pid) {
  const root = document.createElement("div");
  root.className = "seat";
  root.dataset.pid = pid;
  // .seat é só o container de posicionamento; .seatCard é a caixa visível.
  // A resposta (ACEITA/CONTESTA) fica FORA do card, ao lado; o cronômetro
  // fica FORA também, logo abaixo.
  root.innerHTML = `
    <div class="seatCard">
      <div class="seatRing"></div>

      <div class="seatAvatar"><span class="avaFallback">👤</span></div>

      <div class="seatTop">
        <div class="playerName">
          <span class="nick"></span>
          <span class="roleTag hidden"></span>
        </div>
        <div class="moneyTag">
          <span class="coinStack"></span>
          <span class="coins">0</span>
        </div>
      </div>

      <div class="miniHand">
        <div class="miniCard back" data-idx="0"><div class="cMark">C</div></div>
        <div class="miniCard back" data-idx="1"><div class="cMark">C</div></div>
      </div>
      <div class="seatTargetTag">🎯 Escolher</div>
    </div>

    <div class="seatBadge hidden"></div>
    <div class="seatChat"></div>

    <div class="seatTimer">
      <span class="tText">—</span>
      <span class="tBar"><i></i></span>
    </div>
  `;

  const refs = {
    root,
    card: root.querySelector(".seatCard"),
    avatar: root.querySelector(".seatAvatar"),
    nick: root.querySelector(".nick"),
    roleTag: root.querySelector(".roleTag"),
    coins: root.querySelector(".coins"),
    stack: root.querySelector(".coinStack"),
    money: root.querySelector(".moneyTag"),
    badge: root.querySelector(".seatBadge"),
    chat: root.querySelector(".seatChat"),
    timerWrap: root.querySelector(".seatTimer"),
    timer: root.querySelector(".tText"),
    bar: root.querySelector(".tBar i"),
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
    ? `${UI.roleArt(roleToShow)}<div class="label">${UI.escape(UI.rolePt(roleToShow))}</div>`
    : `<div class="cMark">C</div>`;
}

// moedas viram peças de verdade: 1 dourada vale 5, 1 prateada vale 1.
// 7 moedas = 1 dourada + 2 prateadas.
function coinStackHTML(coins) {
  const n = Math.max(0, coins | 0);
  const gold = Math.floor(n / 5);
  const silver = n % 5;
  let h = "";
  let i = 0;
  for (let g = 0; g < gold; g++) h += `<i class="coinPc c5" style="--i:${i++}"></i>`;
  for (let s = 0; s < silver; s++) h += `<i class="coinPc c1" style="--i:${i++}"></i>`;
  return h;
}

function updateCoinStack(refs, coins) {
  const sig = String(coins);
  if (refs.stack.dataset.sig === sig) return;
  const grew = refs.stack.dataset.sig !== undefined && coins > +refs.stack.dataset.sig;
  refs.stack.dataset.sig = sig;
  refs.stack.innerHTML = coinStackHTML(coins);
  if (grew) {
    const last = refs.stack.lastElementChild;
    if (last) FX.ping(last, "coinDrop", 420);
  }
}

function updateAvatar(refs, p) {
  const url = p.avatar || "";
  if (refs.avatar.dataset.src === url) return;
  refs.avatar.dataset.src = url;
  refs.avatar.innerHTML = url
    ? `<img src="${UI.escape(url)}" alt="" draggable="false"
         onerror="this.parentElement.innerHTML='<span class=\\'avaFallback\\'>👤</span>'" />`
    : `<span class="avaFallback">👤</span>`;
}

// quem está dando a ação e quem vai receber, para não restar dúvida
function seatActionRole(p) {
  const pa = state.pendingAction;
  if (!pa) return null;
  if (pa.block && pa.block.blockerId === p.id)
    return { t: "BLOQUEIA", c: "blocker" };
  if (pa.actorId === p.id) return { t: "ATACA", c: "actor" };
  if (pa.action?.targetId === p.id) return { t: "ALVO", c: "target" };
  return null;
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

  // raio ajustado ao tamanho real da mesa: o assento é largo e a foto vaza
  // ~20px para fora, então o círculo tem de encolher em telas estreitas
  const areaW = els.tableArea?.clientWidth || 900;
  const areaH = els.tableArea?.clientHeight || 620;
  const anySeat = seatEls.values().next().value;
  const seatW = (anySeat?.root.offsetWidth || 268) + 26; // + folga da foto
  const seatH = (anySeat?.root.offsetHeight || 200) + 16;

  const rx = Math.max(12, Math.min(38, ((areaW - seatW) / 2 / areaW) * 100));
  const ry = Math.max(12, Math.min(33, ((areaH - seatH) / 2 / areaH) * 100));

  const pos = UI.seatPositions(players.length, rx, ry);
  const validTargets = targeting
    ? new Set(aliveOpponents().map((p) => p.id))
    : null;

  players.forEach((p, i) => {
    const s = seatEls.get(p.id) || buildSeat(p.id);

    s.root.style.left = pos[i].x + "%";
    s.root.style.top = pos[i].y + "%";
    // assentos da metade direita jogam o badge para o lado de dentro,
    // senão ele sairia da mesa
    s.root.classList.toggle("badgeLeft", pos[i].x > 50);
    // o balão de fala fica à esquerda do card; nos assentos da metade
    // esquerda ele iria para fora da mesa, então vira para dentro
    s.root.classList.toggle("chatRight", pos[i].x < 50);

    // cor própria de cada jogador (contorno do card)
    const col = `var(--pc${(p.color ?? 0) % 6})`;
    if (s.root.dataset.col !== String(p.color)) {
      s.root.dataset.col = String(p.color);
      s.root.style.setProperty("--seatColor", col);
    }

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
    updateAvatar(s, p);

    if (s.coins.textContent !== String(p.coins))
      s.coins.textContent = String(p.coins);
    updateCoinStack(s, p.coins);
    s.money.classList.toggle("rich", p.coins >= 10);

    // destaque de quem ataca e quem recebe
    const role = seatActionRole(p);
    s.roleTag.classList.toggle("hidden", !role);
    s.root.classList.toggle("isActor", role?.c === "actor");
    s.root.classList.toggle("isTarget", role?.c === "target");
    s.root.classList.toggle("isBlocker", role?.c === "blocker");
    if (role && s.roleTag.dataset.t !== role.t) {
      s.roleTag.dataset.t = role.t;
      s.roleTag.textContent = role.t;
      s.roleTag.className = `roleTag ${role.c}`;
    } else if (!role) {
      s.roleTag.dataset.t = "";
    }

    const badge = seatResponseBadge(p);
    const wasHidden = s.badge.classList.contains("hidden");
    s.badge.classList.toggle("hidden", !badge);
    if (badge) {
      if (s.badge.dataset.t !== badge.t) {
        s.badge.dataset.t = badge.t;
        s.badge.textContent = badge.t;
      }
      s.badge.className = `seatBadge ${badge.c}`;
      if (wasHidden) FX.ping(s.badge, "badgeIn", 520);
    } else {
      s.badge.dataset.t = "";
    }

    if (current) {
      const left = UI.secsLeft(state.turnEndsAt);
      s.timer.textContent = `⏱ ${UI.timeLeft(state.turnEndsAt)}`;
      s.timerWrap.className = `seatTimer on ${left <= 10 ? "urgent" : ""}`;
      s.bar.style.width =
        Math.max(0, Math.min(100, (left / (TURN_MS / 1000)) * 100)) + "%";
    } else {
      s.timer.textContent = dead ? "ELIMINADO" : "—";
      s.timerWrap.className = "seatTimer";
      s.bar.style.width = "0%";
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
    card.innerHTML = `${UI.roleArt(c.role)}<div class="label">${UI.escape(UI.rolePt(c.role))}</div>`;
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
    card.innerHTML = `${UI.roleArt(role)}<div class="label">${UI.escape(UI.rolePt(role))}</div>`;

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

function renderPause() {
  const pz = state?.paused;
  if (!pz) {
    els.pauseOverlay.classList.add("hidden");
    return;
  }

  els.pauseBy.textContent = `por ${pz.byNick}`;
  els.pauseClock.textContent = UI.timeLeft(pz.untilAt);
  els.pauseOverlay.classList.toggle(
    "urgent",
    UI.secsLeft(pz.untilAt) <= 20,
  );

  // só o host retoma
  els.resumeBtn.style.display =
    state.hostId === myId ? "inline-flex" : "none";

  els.pauseOverlay.classList.remove("hidden");
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
  renderQueue();
  renderReadyButton();
  renderHostButtons();

  renderProfileButton();
  renderThemePicker();
  renderTurnHint();
  renderQuickChat();
  renderActions();
  renderRoleGuide();
  renderReactionBoxes();
  renderTable();

  renderLog();
  renderDiscard();
  renderLossModal();
  renderExchangeModal();
  renderPause();
  renderWinner();
}

setInterval(() => {
  if (!state) return;
  renderTop();
  renderRespTimer();
  if (state.paused) renderPause();
  if (state.started) renderTable();
}, 250);
