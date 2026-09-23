// Os números da cena 3D num lugar só.
//
// Existe porque acertar "a mesa está pequena", "o boneco está baixo", "a luz
// está forte" editando código e recarregando levava uma eternidade. Aqui os
// valores ficam nomeados, a bancada em /teste mexe neles ao vivo, e o que
// ficar bom volta para PADRAO como o novo padrão do jogo.
//
// Script clássico de propósito: o client.js (que monta o painel) não é módulo,
// e a cena lê isto de window, como já faz com window.UI.
(function () {
  const PADRAO = {
    // ---- mesa ----
    mesaRaio: 2.05, // raio do tampo
    mesaAltura: 0.92, // altura do tampo a partir do chão
    mesaEspessura: 0.16,

    // ---- personagens ----
    assentoRaio: 2.62, // distância de cada boneco ao centro da mesa
    bonecoEscala: 1.0,
    bonecoAltura: 0, // sobe ou desce o boneco inteiro
    bonecoInclina: 0, // 0 = de pé; positivo deita para a frente

    // ---- corpo do boneco (a tela /personagem mexe nisto) ----
    ombroAltura: 1.43, // altura da junta do ombro; o tronco pendura daqui
    ombroLargura: 0.34, // distância do ombro ao centro
    ombroTamanho: 0.09, // raio da bola do ombro
    troncoOmbro: 0.285, // raio do tronco em cima
    troncoCintura: 0.25, // raio do tronco na cintura
    troncoAltura: 0.52,
    quadrilRaio: 0.31,

    // ---- braços ----
    // O ângulo é em radianos: 0 é o braço reto para baixo, negativo joga
    // para a frente. O comprimento é só a parte reta da cápsula.
    bracoGrossura: 0.07,
    bracoComprimento: 0.24,
    bracoAngulo: -0.55,
    anteGrossura: 0.058,
    anteComprimento: 0.24,
    anteAngulo: -1.25,
    maoAngulo: 0.9, // o quanto a mão quebra em relação ao antebraço

    // ---- cabeça ----
    cabecaTamanho: 1.0,
    // Uma altura POR tipo: boné, chapéu e cabelo assentam em alturas
    // diferentes, e uma barra só fazia um subir demais enquanto o outro
    // ainda estava baixo.
    //
    // O que estas barras movem é a LINHA do corte — onde o cabelo ou o boné
    // acaba na testa. Negativo desce a linha e cobre mais testa; positivo
    // sobe e descobre. A peça acompanha o crânio, então nenhum valor a
    // descola da cabeça.
    boneAltura: -0.008,
    chapeuAltura: -0.012,
    cabeloAltura: 0,
    // tamanho da aba do boné: o quanto ela avança à frente da testa e a
    // meia-largura dela. A copa tem ~0.131 de meia-largura nessa altura.
    abaComprimento: 0.1,
    abaLargura: 0.142,

    // ---- cartas e fichas na mesa ----
    cartaTamanho: 1.0,
    cartaBorda: 0.34, // o quanto as cartas ficam para dentro da borda
    cartaAfasta: 0.15, // meia distância entre as duas cartas de um jogador
    fichaAfasta: 0.46, // distância das fichas até as cartas

    // ---- lâmpada ----
    lampadaAltura: 4.4, // onde o fio nasce no teto
    lampadaFio: 1.5, // comprimento do fio
    lampadaAbajur: 0.45, // raio do abajur
    lampadaAmortece: 0.3, // quanto o balanço perde por segundo

    // ---- roupa acesa na vez ----
    roupaForca: 0.8, // o quanto a roupa acende
    roupaVel: 3.4, // velocidade da pulsação

    // ---- HUD ----
    hudEscala: 1.0,

    // ---- revelação de carta ----
    // Ritmo da virada (1 = padrão). Abaixo de 1 a carta vira mais rápido,
    // acima de 1 mais devagar. Vale para o 2D e para o 3D.
    revelaRitmo: 1.0,

    // ---- luz ----
    luzForca: 42, // foco de cima
    luzAlcance: 14,
    luzRebote: 13, // o feltro devolvendo luz nos rostos
    luzAmbiente: 1.0,
    // O quanto a poça de luz PASSEIA pela mesa quando a lâmpada balança.
    // Em 0 a luz fica pregada no centro (era o que acontecia antes).
    luzPasseio: 3.2,

    // ---- mau contato ----
    piscaLigado: 1, // 0 desliga
    piscaCada: 7, // segundos entre as crises
    piscaQuantas: 3, // apagadas por crise
    piscaForca: 0.78, // quanto a luz cai (0 a 1)

    // ---- câmera ----
    camPrimAltura: 2.12,
    camPrimDist: 1.34,
    // Em 1ª pessoa: o quanto a cabeça vira para os lados (radianos) e o quanto
    // a câmera pode RECUAR. Recuar demais tirava o jogador de dentro de si
    // mesmo e ele ficava olhando os próprios braços de longe. Aproximar
    // continua solto, que é como se olha a mesa de perto.
    olharLimite: 0.55,
    primZoomMax: 1.12,
    camTercAltura: 3.1,
    camTercDist: 1.78,
    camAbertura: 64, // ângulo de visão
  };

  // Faixa e passo de cada controle. O rótulo é o que aparece na bancada.
  const CONTROLES = [
    ["Mesa", [
      ["mesaRaio", "Tamanho da mesa", 1.2, 3.4, 0.01],
      ["mesaAltura", "Altura da mesa", 0.5, 1.5, 0.01],
      ["mesaEspessura", "Espessura do tampo", 0.06, 0.4, 0.01],
    ]],
    ["Personagens", [
      ["assentoRaio", "Distância da mesa", 1.6, 4.2, 0.01],
      ["bonecoEscala", "Tamanho", 0.5, 1.8, 0.01],
      ["bonecoAltura", "Altura", -0.8, 0.8, 0.01],
      ["bonecoInclina", "Inclinação (0 = de pé)", -0.5, 0.6, 0.01],
    ]],
    ["Tronco e ombros", [
      ["ombroAltura", "Altura do ombro", 1.1, 1.7, 0.005],
      ["ombroLargura", "Largura dos ombros", 0.15, 0.45, 0.005],
      ["ombroTamanho", "Bola do ombro", 0.02, 0.18, 0.005],
      ["troncoOmbro", "Tronco em cima", 0.14, 0.4, 0.005],
      ["troncoCintura", "Tronco na cintura", 0.14, 0.4, 0.005],
      ["troncoAltura", "Altura do tronco", 0.3, 0.75, 0.01],
      ["quadrilRaio", "Quadril", 0.15, 0.4, 0.005],
    ]],
    ["Braços", [
      ["bracoGrossura", "Grossura do braço", 0.03, 0.12, 0.002],
      ["bracoComprimento", "Comprimento do braço", 0.1, 0.45, 0.005],
      ["bracoAngulo", "Ângulo do braço", -1.6, 0.3, 0.01],
      ["anteGrossura", "Grossura do antebraço", 0.03, 0.12, 0.002],
      ["anteComprimento", "Comprimento do antebraço", 0.1, 0.45, 0.005],
      ["anteAngulo", "Ângulo do antebraço", -2, 0.3, 0.01],
      ["maoAngulo", "Quebra do pulso", -0.6, 1.8, 0.02],
    ]],
    ["Cabeça e chapéu", [
      ["cabecaTamanho", "Tamanho da cabeça", 0.6, 1.5, 0.01],
      // as faixas param onde o número ainda faz alguma coisa: acima do alto
      // da cabeça a calota é aparada e a barra andava à toa
      ["boneAltura", "Linha do boné na testa", -0.07, 0.02, 0.002],
      ["chapeuAltura", "Altura do chapéu", -0.07, 0.09, 0.002],
      ["cabeloAltura", "Linha do cabelo na testa", -0.07, 0.03, 0.002],
      ["abaComprimento", "Aba do boné — avanço", 0.03, 0.2, 0.005],
      ["abaLargura", "Aba do boné — largura", 0.08, 0.22, 0.005],
    ]],
    ["Cartas e fichas", [
      ["cartaTamanho", "Tamanho da carta", 0.5, 2, 0.02],
      ["cartaBorda", "Distância da borda", 0.05, 1.2, 0.01],
      ["cartaAfasta", "Espaço entre as duas", 0.05, 0.5, 0.01],
      ["fichaAfasta", "Fichas ao lado", 0.1, 1.2, 0.01],
    ]],
    ["Roupa acesa na vez", [
      ["roupaForca", "Intensidade", 0, 2, 0.02],
      ["roupaVel", "Velocidade", 0.5, 10, 0.1],
    ]],
    ["HUD", [
      ["hudEscala", "Tamanho do HUD", 0.6, 1.8, 0.02],
    ]],
    ["Revelação de carta", [
      ["revelaRitmo", "Ritmo da virada (1 = padrão)", 0.5, 2, 0.05],
    ]],
    ["Lâmpada", [
      ["lampadaAltura", "Altura do teto", 2.5, 6, 0.05],
      ["lampadaFio", "Comprimento do fio", 0.3, 3, 0.05],
      ["lampadaAbajur", "Tamanho do abajur", 0.2, 1.2, 0.01],
      ["lampadaAmortece", "Freio do balanço", 0.02, 2, 0.02],
    ]],
    ["Luz", [
      ["luzForca", "Força do foco", 0, 120, 1],
      ["luzAlcance", "Alcance do foco", 5, 30, 0.5],
      ["luzRebote", "Luz de baixo (rostos)", 0, 40, 0.5],
      ["luzAmbiente", "Luz ambiente", 0, 3, 0.05],
      ["luzPasseio", "Luz passeia com o balanço", 0, 8, 0.1],
    ]],
    ["Mau contato", [
      ["piscaLigado", "Ligado (0 ou 1)", 0, 1, 1],
      ["piscaCada", "Segundos entre crises", 2, 30, 0.5],
      ["piscaQuantas", "Apagadas por crise", 1, 8, 1],
      ["piscaForca", "Quanto apaga", 0.1, 1, 0.02],
    ]],
    ["Câmera", [
      ["camPrimAltura", "1ª pessoa — altura", 1, 4, 0.02],
      ["camPrimDist", "1ª pessoa — recuo", 0.8, 2.5, 0.02],
      ["olharLimite", "1ª pessoa — virar a cabeça", 0.15, 0.9, 0.01],
      ["primZoomMax", "1ª pessoa — recuo máximo do zoom", 1, 2, 0.01],
      ["camTercAltura", "3ª pessoa — altura", 1.5, 6, 0.02],
      ["camTercDist", "3ª pessoa — recuo", 1, 3.5, 0.02],
      ["camAbertura", "Ângulo de visão", 35, 100, 1],
    ]],
  ];

  // Sempre parte do PADRAO: um número novo que eu acrescente aqui aparece para
  // todo mundo, em vez de chegar indefinido.
  const atual = Object.assign({}, PADRAO);

  // Quem leva o que foi salvo até o servidor. O client.js e a /personagem
  // preenchem com um emit do socket.
  //
  // O localStorage SAIU daqui: guardado por navegador, mexer uma barra mudava
  // só a mesa de quem mexeu e o mesmo jogo ficava diferente para cada pessoa
  // na sala. Quem manda agora é o servidor, e o número vale para o jogo todo.
  let mandar = null;
  let fixarNoRepo = null;

  // Só o que difere do padrão viaja: assim o servidor guarda um punhado de
  // números em vez de uma cópia inteira da tabela.
  function diferenca() {
    const d = {};
    for (const k of Object.keys(PADRAO)) if (atual[k] !== PADRAO[k]) d[k] = atual[k];
    return d;
  }

  // Arrastar a barra dispara um `set` por quadro. Manda o primeiro na hora (a
  // mesa dos outros acompanha o arraste) e SEMPRE agenda um último — sem esse
  // de trás, o valor final do arraste era justamente o que o freio do servidor
  // engolia, e a barra parava num número que ninguém mais recebia.
  let ultimoEnvio = 0;
  let pendente = null;

  function enviar(reset) {
    ultimoEnvio = Date.now();
    try {
      mandar?.({ valores: diferenca(), reset: !!reset });
    } catch (e) {
      console.error("[ajustes]", e);
    }
  }

  function salvar(reset) {
    clearTimeout(pendente);
    if (reset) return enviar(true);
    if (Date.now() - ultimoEnvio >= 150) enviar(false);
    // 180 ms é mais folgado que o freio do servidor (120), então este passa
    else pendente = setTimeout(() => enviar(false), 180);
  }

  // Quem quiser ser avisado de que um número mudou. A tela /personagem usa
  // para refazer o boneco na hora; a cena da mesa continua usando o tune().
  const ouvintes = [];
  function avisar() {
    window.COUP3D?.tune?.();
    for (const fn of ouvintes) {
      try {
        fn();
      } catch (e) {
        console.error("[ajustes]", e);
      }
    }
  }

  window.AJUSTES3D = {
    PADRAO,
    CONTROLES,
    valores: atual,
    get: (k) => atual[k],
    escutar: (fn) => ouvintes.push(fn),

    // ligado pelo client.js / personagem.js: é por aqui que o salvo sobe
    aoSalvar(fn) {
      mandar = fn;
    },

    // Pedido de "fixar no repositório". Quem liga é quem tem o socket.
    aoFixar(fn) {
      fixarNoRepo = fn;
    },
    fixar() {
      return new Promise((resolve) => {
        if (!fixarNoRepo)
          return resolve({ ok: false, texto: "sem conexão com o servidor" });
        // a resposta pode demorar (é uma ida ao GitHub): não deixa o botão
        // preso para sempre se ela nunca vier
        const prazo = setTimeout(
          () => resolve({ ok: false, texto: "o servidor não respondeu" }),
          15000,
        );
        fixarNoRepo((r) => {
          clearTimeout(prazo);
          resolve(r || { ok: false, texto: "resposta vazia" });
        });
      });
    },

    // Chegou do servidor: é o que vale para o jogo. Nomes que esta versão do
    // código não conhece são ignorados — é o que deixa o servidor guardar um
    // mapa solto sem precisar repetir a tabela de barras lá dentro.
    aplicarDeFora(obj) {
      let mudou = false;
      for (const k of Object.keys(PADRAO)) {
        const v = obj && Object.prototype.hasOwnProperty.call(obj, k)
          ? Number(obj[k])
          : PADRAO[k];
        const novo = Number.isFinite(v) ? v : PADRAO[k];
        if (atual[k] !== novo) {
          atual[k] = novo;
          mudou = true;
        }
      }
      if (mudou) avisar();
      return mudou;
    },

    set(k, v) {
      if (!(k in PADRAO)) return;
      atual[k] = Number(v);
      salvar();
      avisar();
    },
    restaurar() {
      Object.assign(atual, PADRAO);
      salvar(true);
      avisar();
    },
    // O que a bancada copia para virar o novo padrão no código.
    paraCodigo() {
      const linhas = Object.keys(PADRAO).map(
        (k) => `    ${k}: ${Number(atual[k].toFixed(4))},`,
      );
      return "  const PADRAO = {\n" + linhas.join("\n") + "\n  };";
    },
  };
})();
