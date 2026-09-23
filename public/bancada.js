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


// Botão "Baixar para fixar": entrega os números para virarem código.
  //
  // O que se ajusta aqui vale na hora para todo mundo, mas mora na memória do
  // servidor — some no deploy e quando o Render hiberna. O único lugar
  // permanente é o código, e quem escreve código é uma pessoa. Então o botão
  // faz a parte dele: baixa um arquivo com data no nome, e de lá o
  // `node tools/fixar-ajustes.js --ultimo` carimba os valores no PADRAO.
  function montarFixar(A, onde, dizer) {
    const b = document.createElement("button");
    b.className = "btn small primary";
    b.textContent = "Baixar para fixar";
    b.title = "Baixa os números para carimbar no código (tools/fixar-ajustes.js)";
    b.onclick = async () => {
      const antes = b.textContent;
      b.disabled = true;
      b.textContent = "Gerando...";
      const r = await A.fixar();
      b.disabled = false;
      b.textContent = antes;

      if (!r.conteudo) return dizer(r.texto || "Não deu para gerar.", false);

      try {
        const url = URL.createObjectURL(
          new Blob([r.conteudo], { type: "application/json" }),
        );
        const a = document.createElement("a");
        a.href = url;
        // o nome vem com data e hora do servidor: cada download é um arquivo
        // novo, em vez de empilhar "(1)", "(2)" sem dar para saber qual é o bom
        a.download = r.arquivo || "coup-visual.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        dizer(`Baixei ${a.download} — rode: node tools/fixar-ajustes.js --ultimo`, true);
      } catch (e) {
        dizer("O navegador bloqueou o download: " + e.message, false);
      }
    };
    onde.appendChild(b);
    return b;
  }

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
      ' na hora. Para não perder no deploy, <i>Baixar para fixar</i>.' +
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

    const recado = document.createElement("div");
    recado.className = "bcRecado";
    rodape.appendChild(recado);
    montarFixar(A, rodape, (txt, bom) => {
      recado.textContent = txt;
      recado.className = "bcRecado " + (bom ? "bom" : "ruim");
    });

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

  // Um socket SÓ para os ajustes.
  //
  // A bancada derruba o socket do jogo de propósito (`__coupBancada` troca o
  // emit por um vazio e desconecta), senão qualquer resposta do servidor
  // apagaria a mesa de mentira. Quando os ajustes passaram a morar no
  // servidor, eles caíram nesse mesmo buraco: as barras daqui não mandavam
  // nada e não recebiam nada, e o botão de fixar ficava esperando uma
  // resposta que nunca vinha — era o "o servidor não respondeu" da tela.
  //
  // A ligação é própria e escuta SÓ "ajustes". Nada de "state" passa por ela,
  // então a mesa de mentira continua intacta.
  function ligarAjustes() {
    if (typeof io !== "function") return;
    let sock;
    try {
      sock = io();
    } catch (e) {
      console.error("[bancada]", e);
      return;
    }
    const A = window.AJUSTES3D;
    if (!A) return;
    // depois do montarPainel: o último aoSalvar é o que vale, e o do
    // client.js aponta para o socket morto
    A.aoSalvar((d) => sock.emit("ajustes", d));
    A.aoFixar((cb) => sock.emit("ajustes_fixar", {}, cb));
    sock.on("ajustes", (o) => A.aplicarDeFora(o));
  }

  function ligar() {
    // Entra direto e SEM servidor: clicar em "Entrar" mandaria um join de
    // verdade, e qualquer resposta do servidor apagaria os bonecos de mentira.
    window.__coupBancada?.();

    window.COUP3D?.setMode?.("3d");
    window.__coupAplicarEstado?.(estado());
    montarPainel();
    ligarAjustes();

    // reenvia de tempos em tempos: mantém o cronômetro vivo e reaplica o
    // estado se alguma coisa redesenhar a mesa
    setInterval(() => window.__coupAplicarEstado?.(estado()), 1000);
  }

  if (document.readyState === "loading")
    addEventListener("DOMContentLoaded", ligar);
  else ligar();
})();
