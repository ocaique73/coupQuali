// Bancada de ajustes do 3D — só existe na sala /teste.
//
// Por que existe: acertar "a mesa está pequena", "o boneco está longe", "a
// luz está forte" pelo código é um ciclo de editar, salvar, recarregar,
// entrar na sala, começar a partida. Aqui a mesa já aparece montada com
// cinco pessoas jogando, e cada número tem um controle que muda a cena na
// hora.
//
// Nada aqui fala com o servidor: o estado é de mentira e entra pelo mesmo
// caminho que o estado de verdade, para o que se vê ser o que o jogo desenha.
(function () {
  if (!/^\/teste\/?$/i.test(location.pathname)) return;

  // O pid TEM de ser o mesmo que o client.js leu no carregamento: e por ele
  // que a cena sabe quem sou eu e esconde a minha propria placa.
  const PID = (function () {
    try {
      return sessionStorage.getItem("coup.pid") || "bancada-000001";
    } catch {
      return "bancada-000001";
    }
  })();
  const h = (role, alive) => ({ role, alive, revealed: !alive });

  // Variedade de propósito: cada um com um item de cabeça diferente, um com
  // carta perdida virada para cima e um já eliminado — assim dá para ajustar
  // a cena vendo todos os estados de uma vez.
  const gente = [
    { nick: "Você", color: 4, look: { shirt: "short", body: "thin", skin: 1, prop: "smoke", head: "hair" },
      coins: 7, hand: [h("Duke", true), h("Captain", true)] },
    { nick: "Bruna", color: 2, look: { shirt: "long", body: "fat", skin: 4, prop: "none", head: "cowboy" },
      coins: 3, hand: [h("Assassin", false), h(null, true)] },
    { nick: "Rafael", color: 1, look: { shirt: "long", body: "thin", skin: 2, prop: "smoke", head: "cap" },
      coins: 12, hand: [h(null, true), h(null, true)] },
    { nick: "Lu", color: 3, look: { shirt: "short", body: "fat", skin: 5, prop: "none", head: "bald" },
      coins: 0, hand: [h("Duke", false), h("Contessa", false)] },
    { nick: "Téo", color: 0, look: { shirt: "short", body: "thin", skin: 3, prop: "smoke", head: "hair" },
      coins: 5, hand: [h(null, true), h(null, true)] },
  ];

  const players = gente.map((g, i) => ({
    id: i === 0 ? PID : "bancada-p" + i,
    nick: g.nick,
    avatar: null,
    color: g.color,
    look: g.look,
    coins: g.coins,
    connected: true,
    aliveCount: g.hand.filter((c) => c.alive).length,
    hand: g.hand,
  }));

  function estado() {
    return {
      key: "TESTE",
      hostId: PID,
      started: true,
      phase: "turn",
      roomPlayers: players.map((p, i) => ({
        id: p.id, nick: p.nick, avatar: null, color: p.color, look: p.look,
        ready: true, inGame: true, connected: true, isHost: i === 0,
      })),
      queue: [],
      seatsFree: 1,
      maxSeats: 6,
      lobby: [],
      playersInGame: players,
      currentPlayerId: PID,
      turnEndsAt: Date.now() + 90000,
      pendingAction: null,
      reactionEndsAt: 0,
      reactions: {},
      reactionResponded: {},
      blockChallengeEndsAt: 0,
      blockChallenges: {},
      blockResponded: {},
      loss: null,
      lossForViewer: null,
      exchangeForViewer: null,
      discard: [],
      actionLog: [{ ts: Date.now(), text: "Bancada de ajustes — nada aqui é uma partida de verdade." }],
      deckCount: 7,
      winner: null,
      events: [],
      paused: null,
      themes: ["politica", "qualitas"],
    };
  }

  /* ------------------------------------------------------------------ */
  /* o painel                                                            */
  /* ------------------------------------------------------------------ */

  function montarPainel() {
    const A = window.AJUSTES3D;
    if (!A) return;

    const box = document.createElement("div");
    box.id = "bancada";
    box.className = "bancada";

    const topo = document.createElement("div");
    topo.className = "bcTopo";
    // O corpo do boneco tem bancada PRÓPRIA (/personagem, tela cheia): aqui
    // ele aparece pequeno e longe, e não dá para julgar junta nem chapéu.
    topo.innerHTML =
      '<b>Ajustes do 3D</b><span class="bcNota">vale para <b>todas as salas</b>' +
      ' — some no próximo deploy; use <i>Copiar para o código</i> para fixar.' +
      ' O corpo do boneco é em <a href="/personagem">/personagem</a></span>';

    const fechar = document.createElement("button");
    fechar.className = "btn tiny";
    fechar.textContent = "–";
    fechar.title = "Encolher";
    fechar.onclick = () => {
      box.classList.toggle("encolhida");
      fechar.textContent = box.classList.contains("encolhida") ? "+" : "–";
    };
    topo.appendChild(fechar);
    box.appendChild(topo);

    const corpo = document.createElement("div");
    corpo.className = "bcCorpo";

    for (const [grupo, itens] of A.CONTROLES) {
      const t = document.createElement("div");
      t.className = "bcGrupo";
      t.textContent = grupo;
      corpo.appendChild(t);

      for (const [chave, rotulo, min, max, passo] of itens) {
        const linha = document.createElement("label");
        linha.className = "bcLinha";

        const nome = document.createElement("span");
        nome.className = "bcNome";
        nome.textContent = rotulo;

        const val = document.createElement("b");
        val.className = "bcVal";
        val.textContent = A.get(chave);

        const range = document.createElement("input");
        range.type = "range";
        range.min = min;
        range.max = max;
        range.step = passo;
        range.value = A.get(chave);
        range.oninput = () => {
          A.set(chave, range.value);
          val.textContent = range.value;
        };

        linha.append(nome, val, range);
        corpo.appendChild(linha);
        linha.dataset.chave = chave;
      }
    }
    box.appendChild(corpo);

    const rodape = document.createElement("div");
    rodape.className = "bcRodape";

    const copiar = document.createElement("button");
    copiar.className = "btn small primary";
    copiar.textContent = "Copiar para o código";
    copiar.title =
      "Copia o bloco pronto para virar o padrão do jogo em public/ajustes3d.js";
    copiar.onclick = async () => {
      const txt = A.paraCodigo();
      try {
        await navigator.clipboard.writeText(txt);
        copiar.textContent = "Copiado!";
      } catch {
        // clipboard bloqueado (http, permissão): mostra para copiar na mão
        const ta = document.createElement("textarea");
        ta.className = "bcSaida";
        ta.value = txt;
        rodape.appendChild(ta);
        ta.select();
        copiar.textContent = "Copie daí";
      }
      setTimeout(() => (copiar.textContent = "Copiar para o código"), 2500);
    };

    const zerar = document.createElement("button");
    zerar.className = "btn small";
    zerar.textContent = "Restaurar padrão";
    zerar.onclick = () => {
      A.restaurar();
      for (const linha of corpo.querySelectorAll(".bcLinha")) {
        const k = linha.dataset.chave;
        linha.querySelector("input").value = A.get(k);
        linha.querySelector(".bcVal").textContent = A.get(k);
      }
    };

    // O ritmo da virada é o único número que não dá para julgar parado:
    // este botão roda a cena de revelação na mesa de mentira, com o valor
    // que estiver no controle agora.
    const virar = document.createElement("button");
    virar.className = "btn small warn";
    virar.textContent = "Ver uma revelação";
    virar.title = "Roda a virada de carta com o ritmo atual";
    let qual = 0;
    virar.onclick = () => {
      const papeis = ["Duke", "Contessa", "Captain", "Assassin", "Ambassador"];
      const alvo = players[1 + (qual % (players.length - 1))];
      window.__coupTesteRevelacao?.(alvo.id, 1, papeis[qual % papeis.length]);
      qual++;
    };

    rodape.append(zerar, virar, copiar);
    box.appendChild(rodape);

    // Outra pessoa (ou a /personagem noutra aba) mexeu numa barra: as daqui
    // acompanham. A que está sob o dedo fica de fora, senão o valor pulava
    // no meio do arraste.
    A.escutar(() => {
      for (const linha of corpo.querySelectorAll(".bcLinha")) {
        const input = linha.querySelector("input");
        if (input === document.activeElement) continue;
        const k = linha.dataset.chave;
        input.value = A.get(k);
        linha.querySelector(".bcVal").textContent = A.get(k);
      }
    });

    document.body.appendChild(box);
  }

  /* ------------------------------------------------------------------ */

  function ligar() {
    // Entra direto e SEM servidor: clicar em "Entrar" mandaria um join de
    // verdade, e qualquer resposta do servidor apagaria os bonecos de mentira.
    window.__coupBancada?.();

    window.COUP3D?.setMode?.("3d");
    window.__coupAplicarEstado?.(estado());
    montarPainel();

    // reenvia de tempos em tempos: mantém o cronômetro vivo e reaplica o
    // estado se alguma coisa redesenhar a mesa
    setInterval(() => window.__coupAplicarEstado?.(estado()), 1000);
  }

  if (document.readyState === "loading")
    addEventListener("DOMContentLoaded", ligar);
  else ligar();
})();
