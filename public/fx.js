// Motor de animação. Não conhece regras do jogo — só desenha coisas voando,
// piscando e aparecendo por cima da tela. O client.js traduz eventos do
// servidor em chamadas daqui.

(function () {
  const reduced = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  )?.matches;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let layer = null;
  function getLayer() {
    if (!layer) layer = document.getElementById("fxLayer");
    return layer;
  }

  function rect(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return r;
  }

  function centerOf(r) {
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // cria um elemento efêmero na camada de FX e o remove no fim
  function spawn(html, cls, style) {
    const el = document.createElement("div");
    el.className = `fxItem ${cls || ""}`;
    el.innerHTML = html || "";
    Object.assign(el.style, style || {});
    getLayer().appendChild(el);
    return el;
  }

  function run(el, keyframes, options) {
    return new Promise((resolve) => {
      // sem Web Animations API (ou com movimento reduzido): sem animação
      if (reduced || typeof el.animate !== "function") {
        el.remove();
        resolve();
        return;
      }
      const anim = el.animate(keyframes, {
        easing: "cubic-bezier(.22,.9,.28,1)",
        fill: "forwards",
        ...options,
      });
      anim.onfinish = () => {
        el.remove();
        resolve();
      };
      anim.oncancel = () => {
        el.remove();
        resolve();
      };
    });
  }

  const FX = {
    rect,

    // ---------- fila sequencial ----------
    _q: [],
    _running: false,

    enqueue(fn, dur = 400) {
      this._q.push({ fn, dur });
      this._pump();
    },

    async _pump() {
      if (this._running) return;
      this._running = true;
      while (this._q.length) {
        // se a fila cresceu (muita coisa aconteceu de uma vez), acelera
        const speed = this._q.length > 5 ? 0.35 : this._q.length > 2 ? 0.6 : 1;
        const { fn, dur } = this._q.shift();
        try {
          fn(speed);
        } catch (e) {
          console.error("[FX]", e);
        }
        await sleep(Math.max(60, dur * speed));
      }
      this._running = false;
    },

    clearQueue() {
      this._q.length = 0;
    },

    // ---------- primitivas ----------

    // voa um elemento fantasma de um retângulo a outro
    fly({
      from,
      to,
      html,
      cls = "",
      dur = 620,
      delay = 0,
      arc = 0,
      rotate = 0,
      scaleTo = 1,
      fadeOut = false,
    }) {
      if (!from || !to) return Promise.resolve();

      const a = centerOf(from);
      const b = centerOf(to);

      const el = spawn(html, cls, {
        left: `${a.x}px`,
        top: `${a.y}px`,
      });

      const dx = b.x - a.x;
      const dy = b.y - a.y;

      const mid = {
        x: dx / 2,
        y: dy / 2 - arc,
      };

      return run(
        el,
        [
          {
            transform: `translate(-50%,-50%) translate(0px,0px) scale(1) rotate(0deg)`,
            opacity: 1,
          },
          {
            transform: `translate(-50%,-50%) translate(${mid.x}px,${mid.y}px) scale(${(1 + scaleTo) / 2}) rotate(${rotate / 2}deg)`,
            opacity: 1,
            offset: 0.55,
          },
          {
            transform: `translate(-50%,-50%) translate(${dx}px,${dy}px) scale(${scaleTo}) rotate(${rotate}deg)`,
            opacity: fadeOut ? 0 : 1,
          },
        ],
        { duration: dur, delay },
      );
    },

    flyCard({ from, to, role, faceDown = true, dur = 620, delay = 0 }) {
      const cls = faceDown ? "back" : UI.roleClass(role);
      const label = faceDown
        ? `<div class="fxCardMark">C</div>`
        : `<div class="fxCardIcon">${UI.roleIcon(role)}</div>
           <div class="fxCardName">${UI.escape(UI.rolePt(role))}</div>`;

      return this.fly({
        from,
        to,
        cls: `fxCard ${cls}`,
        html: label,
        dur,
        delay,
        arc: 60,
        rotate: faceDown ? 360 : 0,
      });
    },

    flyCoins({ from, to, count = 1, dur = 560, delay = 0 }) {
      const n = Math.min(Math.abs(count) || 1, 7);
      const jobs = [];
      for (let i = 0; i < n; i++) {
        jobs.push(
          this.fly({
            from,
            to,
            cls: "fxCoin",
            html: "🪙",
            dur,
            delay: delay + i * 70,
            arc: 40 + i * 12,
          }),
        );
      }
      return Promise.all(jobs);
    },

    floatText({ at, text, cls = "", dur = 1100 }) {
      if (!at) return Promise.resolve();
      const c = centerOf(at);
      const el = spawn(UI.escape(text), `fxFloat ${cls}`, {
        left: `${c.x}px`,
        top: `${c.y}px`,
      });

      return run(
        el,
        [
          { transform: "translate(-50%,-50%) scale(.6)", opacity: 0 },
          {
            transform: "translate(-50%,-115%) scale(1.15)",
            opacity: 1,
            offset: 0.25,
          },
          { transform: "translate(-50%,-230%) scale(1)", opacity: 0 },
        ],
        { duration: dur },
      );
    },

    // carta virando para cima em cima do assento
    revealCard({ at, role, dur = 1000 }) {
      if (!at) return Promise.resolve();
      const c = centerOf(at);
      const el = spawn(
        `<div class="fxRevealInner">
           <div class="fxCardIcon">${UI.roleIcon(role)}</div>
           <div class="fxCardName">${UI.escape(UI.rolePt(role))}</div>
           <div class="fxRevealTag">REVELADA</div>
         </div>`,
        `fxCard fxReveal ${UI.roleClass(role)}`,
        { left: `${c.x}px`, top: `${c.y}px` },
      );

      return run(
        el,
        [
          {
            transform: "translate(-50%,-50%) rotateY(180deg) scale(1)",
            opacity: 0.2,
          },
          {
            transform: "translate(-50%,-50%) rotateY(90deg) scale(1.35)",
            opacity: 1,
            offset: 0.25,
          },
          {
            transform: "translate(-50%,-70%) rotateY(0deg) scale(1.9)",
            opacity: 1,
            offset: 0.55,
          },
          {
            transform: "translate(-50%,-70%) rotateY(0deg) scale(1.9)",
            opacity: 1,
            offset: 0.8,
          },
          {
            transform: "translate(-50%,-50%) rotateY(0deg) scale(1)",
            opacity: 0,
          },
        ],
        { duration: dur },
      );
    },

    // faixa no centro da mesa
    banner({ title, sub = "", cls = "", dur = 1500 }) {
      const host = document.getElementById("centerBanner");
      if (!host) return Promise.resolve();

      const el = document.createElement("div");
      el.className = `bannerItem ${cls}`;
      el.innerHTML = `<div class="bannerTitle">${UI.escape(title)}</div>${
        sub ? `<div class="bannerSub">${UI.escape(sub)}</div>` : ""
      }`;
      host.innerHTML = "";
      host.appendChild(el);

      if (reduced || typeof el.animate !== "function") {
        setTimeout(() => el.remove(), dur);
        return Promise.resolve();
      }

      const anim = el.animate(
        [
          { transform: "translateY(14px) scale(.9)", opacity: 0 },
          { transform: "translateY(0) scale(1)", opacity: 1, offset: 0.18 },
          { transform: "translateY(0) scale(1)", opacity: 1, offset: 0.78 },
          { transform: "translateY(-14px) scale(.96)", opacity: 0 },
        ],
        { duration: dur, easing: "cubic-bezier(.22,.9,.28,1)", fill: "both" },
      );
      return new Promise((res) => {
        anim.onfinish = () => {
          el.remove();
          res();
        };
      });
    },

    // aplica uma classe de animação e remove depois
    ping(el, cls, dur = 700) {
      if (!el) return;
      el.classList.remove(cls);
      // força reflow para poder repetir a mesma animação
      void el.offsetWidth;
      el.classList.add(cls);
      setTimeout(() => el.classList.remove(cls), dur);
    },

    shake(el) {
      this.ping(el, "fxShake", 520);
    },

    confetti(host, count = 90) {
      if (!host || reduced) return;
      host.innerHTML = "";
      const colors = [
        "#ffd400",
        "#3aa6ff",
        "#2dd36f",
        "#ff3b3b",
        "#ff8ae2",
        "#ffffff",
      ];
      for (let i = 0; i < count; i++) {
        const p = document.createElement("i");
        p.className = "confettiPiece";
        p.style.left = Math.random() * 100 + "%";
        p.style.background = colors[(Math.random() * colors.length) | 0];
        p.style.animationDelay = Math.random() * 2.2 + "s";
        p.style.animationDuration = 2.6 + Math.random() * 2.4 + "s";
        p.style.transform = `rotate(${Math.random() * 360}deg)`;
        p.style.width = 6 + Math.random() * 7 + "px";
        p.style.height = 9 + Math.random() * 10 + "px";
        host.appendChild(p);
      }
    },

    stopConfetti(host) {
      if (host) host.innerHTML = "";
    },
  };

  window.FX = FX;
})();
