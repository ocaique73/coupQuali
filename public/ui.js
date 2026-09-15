// helpers UI (sem socket)

const ROLE_META = {
  Duke: {
    pt: "Duque",
    icon: "👑",
    cls: "duke",
    does: "Taxar: +3 moedas",
    blocks: "Bloqueia Ajuda Externa",
  },
  Assassin: {
    pt: "Assassino",
    icon: "🗡️",
    cls: "assassin",
    does: "Assassinar: paga 3, alvo perde 1 carta",
    blocks: "—",
  },
  Captain: {
    pt: "Capitão",
    icon: "⚓",
    cls: "captain",
    does: "Roubar: pega 2 moedas de alguém",
    blocks: "Bloqueia Roubo",
  },
  Ambassador: {
    pt: "Embaixador",
    icon: "🎭",
    cls: "ambassador",
    does: "Trocar cartas com o baralho",
    blocks: "Bloqueia Roubo",
  },
  Contessa: {
    pt: "Condessa",
    icon: "🛡️",
    cls: "contessa",
    does: "—",
    blocks: "Bloqueia Assassinato",
  },
};

const ACTION_LABELS = {
  income: "Renda",
  foreign_aid: "Ajuda Externa",
  tax: "Taxar",
  assassinate: "Assassinar",
  steal: "Roubar",
  exchange: "Trocar",
  coup: "Golpe",
};

window.UI = {
  ROLE_META,
  ACTION_LABELS,

  timeLeft(ts) {
    const ms = Math.max(0, ts - Date.now());
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  },

  secsLeft(ts) {
    return Math.max(0, Math.ceil((ts - Date.now()) / 1000));
  },

  roleClass(role) {
    if (!role) return "back";
    return ROLE_META[role]?.cls || "back";
  },

  rolePt(role) {
    return ROLE_META[role]?.pt || role || "Carta";
  },

  roleIcon(role) {
    return ROLE_META[role]?.icon || "🂠";
  },

  // arte da carta (public/img/<cls>.webp)
  roleImg(role) {
    const cls = ROLE_META[role]?.cls;
    return cls ? `/img/${cls}.webp` : null;
  },

  // <img> da carta, com o emoji como fallback se a arte não carregar
  roleArt(role, extraCls) {
    const src = this.roleImg(role);
    if (!src) return `<span class="cIcon">${this.roleIcon(role)}</span>`;
    return `<img class="cArt ${extraCls || ""}" src="${src}" alt="${this.escape(
      this.rolePt(role),
    )}" draggable="false"
      onerror="this.outerHTML='<span class=\\'cIcon\\'>${this.roleIcon(role)}</span>'" />`;
  },

  actionLabel(type) {
    return ACTION_LABELS[type] || (type || "").toUpperCase();
  },

  escape(s) {
    return String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  },

  // posições em círculo (2..6 perfeito).
  // rx/ry vêm do renderTable já ajustados ao tamanho real da mesa, para que
  // os assentos (que são largos e ainda têm a foto vazando para fora) nunca
  // fiquem cortados na borda.
  seatPositions(n, rx, ry) {
    const positions = [];
    const centerX = 50;
    const centerY = 52;
    const radiusX = rx ?? 38;
    const radiusY = ry ?? 33;

    for (let i = 0; i < n; i++) {
      const angle = (-90 + (360 / n) * i) * (Math.PI / 180);
      const x = centerX + Math.cos(angle) * radiusX;
      const y = centerY + Math.sin(angle) * radiusY;
      positions.push({ x, y });
    }
    return positions;
  },
};
