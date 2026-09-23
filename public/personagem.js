// Tela de modelar o personagem — /personagem
//
// Por que existe: acertar "o antebraço está acima do braço", "o ombro está
// gigante", "o boné tapa o olho" dentro de uma partida é impossível. O boneco
// aparece pequeno, longe, no escuro e de costas. Aqui ele fica em tela cheia,
// bem iluminado, girando, e cada número do corpo tem uma barra que muda o
// boneco na hora.
//
// Usa o MESMO buildCharacter da mesa. Se esta tela montasse o boneco por
// outro caminho, ela mentiria sobre o resultado — foi por isso que a prévia
// do editor de perfil também foi feita assim.

import * as THREE from "three";
import { buildCharacter } from "/three/scene3d.js";

const A = window.AJUSTES3D;
const palco = document.getElementById("palco");
const aviso = document.getElementById("aviso");

// Só os grupos do CORPO entram aqui. Mesa, luz e câmera continuam em /teste:
// esta tela é sobre o boneco, e a lista inteira viraria um paredão de barras.
const GRUPOS = ["Personagens", "Tronco e ombros", "Braços", "Cabeça e chapéu"];

/* ------------------------------------------------------------------ */
/* cena                                                                */
/* ------------------------------------------------------------------ */

let renderer, scene, camera, boneco, chao;
let girando = true;
let giro = 0;

// Câmera em volta do boneco: ângulo, altura e distância.
const orbita = { yaw: 0.5, pitch: 0.1, dist: 2.6, arrastando: false, lx: 0, ly: 0 };
const PITCH_MIN = -0.9;
const PITCH_MAX = 1.2;

function montarCena() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(palco.clientWidth, palco.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  palco.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11141c);

  camera = new THREE.PerspectiveCamera(
    40,
    palco.clientWidth / palco.clientHeight,
    0.05,
    60,
  );

  // Luz de ESTÚDIO, não a da mesa: aqui o boneco precisa estar bem visível
  // para dar para julgar a forma. A mesa é escura de propósito e esconde
  // justamente os defeitos que esta tela existe para achar.
  scene.add(new THREE.AmbientLight(0xffffff, 1.15));

  const principal = new THREE.DirectionalLight(0xfff2e0, 2.4);
  principal.position.set(2.2, 4, 2.6);
  principal.castShadow = true;
  principal.shadow.mapSize.set(1024, 1024);
  principal.shadow.camera.top = 3;
  principal.shadow.camera.bottom = -1;
  principal.shadow.camera.left = -2;
  principal.shadow.camera.right = 2;
  scene.add(principal);

  // contraluz azulada: separa a silhueta do fundo, que é onde se vê ombro
  // largo demais e braço torto
  const contra = new THREE.DirectionalLight(0x8fb4ff, 1.5);
  contra.position.set(-2.6, 2, -2.2);
  scene.add(contra);

  const baixo = new THREE.DirectionalLight(0xffd9b0, 0.5);
  baixo.position.set(0, -2, 1.6);
  scene.add(baixo);

  chao = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 48),
    new THREE.MeshStandardMaterial({ color: 0x1b2030, roughness: 0.95 }),
  );
  chao.rotation.x = -Math.PI / 2;
  chao.receiveShadow = true;
  scene.add(chao);

  // grade de meio metro: dá referência de tamanho para as barras
  const grade = new THREE.GridHelper(4.8, 24, 0x2e3950, 0x232b3c);
  grade.position.y = 0.002;
  scene.add(grade);

  refazer();
  animar();
}

// Refaz o boneco do zero. É o jeito honesto: buildCharacter monta a geometria
// a partir dos números, então mudar um número obriga a remontar — não dá para
// "editar" uma cápsula que já nasceu com outro comprimento.
function refazer() {
  if (!scene) return;
  if (boneco) {
    scene.remove(boneco);
    boneco.traverse((o) => o.geometry?.dispose?.());
  }
  boneco = buildCharacter({ color: escolha.color, look: escolha.look, seed: 0 });
  boneco.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  boneco.scale.setScalar(A.get("bonecoEscala") || 1);
  boneco.rotation.x = A.get("bonecoInclina") || 0;
  scene.add(boneco);
}

function animar() {
  requestAnimationFrame(animar);
  if (!renderer) return;

  if (girando && !orbita.arrastando) giro += 0.006;
  if (boneco) boneco.rotation.y = giro;

  const alvoY = 1.05;
  const r = orbita.dist;
  camera.position.set(
    Math.sin(orbita.yaw) * Math.cos(orbita.pitch) * r,
    alvoY + Math.sin(orbita.pitch) * r,
    Math.cos(orbita.yaw) * Math.cos(orbita.pitch) * r,
  );
  camera.lookAt(0, alvoY, 0);

  renderer.render(scene, camera);
}

function redimensionar() {
  if (!renderer) return;
  renderer.setSize(palco.clientWidth, palco.clientHeight);
  camera.aspect = palco.clientWidth / palco.clientHeight;
  camera.updateProjectionMatrix();
}

/* ------------------------------------------------------------------ */
/* variações do visual                                                 */
/* ------------------------------------------------------------------ */

// O mesmo número tem de ficar bom em TODAS as variações: manga curta mostra
// o antebraço de pele, o corpo gordo alarga tudo, o chapéu muda a cabeça.
// Sem poder trocar aqui, seria preciso acertar num e descobrir depois que
// quebrou noutro.
const VARIACOES = [
  ["shirt", "Manga", [["short", "Curta"], ["long", "Longa"]]],
  ["body", "Corpo", [["thin", "Magro"], ["fat", "Gordo"]]],
  [
    "head",
    "Cabeça",
    [["hair", "Cabelo"], ["bald", "Careca"], ["cap", "Boné"], ["cowboy", "Chapéu"]],
  ],
  ["prop", "Boca", [["none", "Nada"], ["smoke", "Cigarro"]]],
];

const escolha = {
  color: 4,
  look: { shirt: "short", body: "thin", skin: 2, prop: "none", head: "hair" },
};

function montarVariacoes() {
  const host = document.getElementById("vars");
  for (const [chave, rotulo, opcoes] of VARIACOES) {
    const linha = document.createElement("div");
    linha.className = "pgVar";
    linha.innerHTML = `<span class="pgVarNome">${rotulo}</span>`;

    const caixa = document.createElement("div");
    caixa.className = "pgVarBotoes";
    for (const [valor, texto] of opcoes) {
      const b = document.createElement("button");
      b.className = "themeBtn" + (escolha.look[chave] === valor ? " on" : "");
      b.textContent = texto;
      b.onclick = () => {
        escolha.look[chave] = valor;
        for (const irmao of caixa.children) irmao.classList.remove("on");
        b.classList.add("on");
        refazer();
      };
      caixa.appendChild(b);
    }
    linha.appendChild(caixa);
    host.appendChild(linha);
  }

  // tom de pele e cor da camisa: mudam o contraste e por isso mudam o que
  // dá para enxergar da forma
  const extra = document.createElement("div");
  extra.className = "pgVar";
  extra.innerHTML = `<span class="pgVarNome">Pele / cor</span>`;
  const caixa = document.createElement("div");
  caixa.className = "pgVarBotoes";

  const pele = document.createElement("button");
  pele.className = "themeBtn";
  pele.textContent = "Trocar pele";
  pele.onclick = () => {
    escolha.look.skin = (escolha.look.skin + 1) % 6;
    refazer();
  };

  const cor = document.createElement("button");
  cor.className = "themeBtn";
  cor.textContent = "Trocar cor";
  cor.onclick = () => {
    escolha.color = (escolha.color + 1) % 6;
    refazer();
  };

  caixa.append(pele, cor);
  extra.appendChild(caixa);
  host.appendChild(extra);
}

/* ------------------------------------------------------------------ */
/* barras                                                              */
/* ------------------------------------------------------------------ */

function montarBarras() {
  const host = document.getElementById("corpo");

  for (const [grupo, itens] of A.CONTROLES) {
    if (!GRUPOS.includes(grupo)) continue;

    const t = document.createElement("div");
    t.className = "bcGrupo";
    t.textContent = grupo;
    host.appendChild(t);

    for (const [chave, rotulo, min, max, passo] of itens) {
      // a distância da mesa não quer dizer nada aqui: não existe mesa
      if (chave === "assentoRaio") continue;

      const linha = document.createElement("label");
      linha.className = "bcLinha";
      linha.dataset.chave = chave;

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
      host.appendChild(linha);
    }
  }
}

function recarregarBarras() {
  for (const linha of document.querySelectorAll("#corpo .bcLinha")) {
    const k = linha.dataset.chave;
    linha.querySelector("input").value = A.get(k);
    linha.querySelector(".bcVal").textContent = A.get(k);
  }
}

/* ------------------------------------------------------------------ */
/* ligações                                                            */
/* ------------------------------------------------------------------ */

function ligarBotoes() {
  const painel = document.getElementById("painel");
  const encolher = document.getElementById("encolher");
  encolher.onclick = () => {
    painel.classList.toggle("encolhida");
    encolher.textContent = painel.classList.contains("encolhida") ? "+" : "–";
  };

  const girarBtn = document.getElementById("girar");
  girarBtn.onclick = () => {
    girando = !girando;
    girarBtn.textContent = girando ? "Parar de girar" : "Girar sozinho";
  };

  document.getElementById("zerar").onclick = () => {
    A.restaurar();
    recarregarBarras();
  };

  const copiar = document.getElementById("copiar");
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
      document.querySelector(".pgRodape").appendChild(ta);
      ta.select();
      copiar.textContent = "Copie daí";
    }
    setTimeout(() => (copiar.textContent = "Copiar para o código"), 2500);
  };
}

function ligarMouse() {
  const tela = renderer.domElement;

  tela.addEventListener("pointerdown", (e) => {
    orbita.arrastando = true;
    orbita.lx = e.clientX;
    orbita.ly = e.clientY;
    tela.style.cursor = "grabbing";
  });

  addEventListener("pointerup", () => {
    orbita.arrastando = false;
    tela.style.cursor = "grab";
  });

  addEventListener("pointermove", (e) => {
    if (!orbita.arrastando) return;
    const dx = e.clientX - orbita.lx;
    const dy = e.clientY - orbita.ly;
    orbita.lx = e.clientX;
    orbita.ly = e.clientY;
    // arrastar gira o BONECO no eixo dele e a câmera na altura: é assim que
    // se olha de lado e de cima, que é onde os defeitos de junta aparecem
    giro -= dx * 0.008;
    orbita.pitch = Math.max(
      PITCH_MIN,
      Math.min(PITCH_MAX, orbita.pitch + dy * 0.005),
    );
  });

  tela.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const k = e.deltaY > 0 ? 1.08 : 1 / 1.08;
      orbita.dist = Math.max(0.9, Math.min(6, orbita.dist * k));
    },
    { passive: false },
  );

  tela.addEventListener("dblclick", () => {
    orbita.yaw = 0.5;
    orbita.pitch = 0.1;
    orbita.dist = 2.6;
    giro = 0;
  });

  tela.style.cursor = "grab";
}

/* ------------------------------------------------------------------ */

function ligar() {
  if (!A) {
    aviso.textContent = "ajustes3d.js não carregou — sem barras para mexer.";
    return;
  }

  // O que se ajusta aqui vira padrão do JOGO, não desta aba: sobe para o
  // servidor e desce para todas as salas. Sem socket, as barras ainda mexem o
  // boneco desta tela, mas nada é guardado — e é melhor avisar do que deixar
  // a pessoa ajustar meia hora e perder tudo.
  if (typeof io === "function") {
    const socket = io();
    A.aoSalvar((d) => socket.emit("ajustes", d));
    socket.on("ajustes", (o) => A.aplicarDeFora(o));
    socket.on("connect_error", () => {
      aviso.textContent = "sem conexão com o servidor — nada será salvo";
    });
  } else {
    aviso.textContent = "socket.io não carregou — nada será salvo";
  }
  try {
    montarCena();
  } catch (e) {
    console.error("[personagem]", e);
    aviso.textContent =
      "Não deu para abrir o 3D aqui (WebGL bloqueado ou GPU fraca).";
    return;
  }
  montarVariacoes();
  montarBarras();
  ligarBotoes();
  ligarMouse();

  // Qualquer barra mexida remonta o boneco, venha daqui, de /teste ou de outra
  // pessoa: o aviso sai do próprio ajustes3d.js. As barras acompanham também,
  // menos a que está sob o dedo — senão o valor pulava no meio do arraste.
  A.escutar(() => {
    refazer();
    for (const linha of document.querySelectorAll("#corpo .bcLinha")) {
      const input = linha.querySelector("input");
      if (input === document.activeElement) continue;
      const k = linha.dataset.chave;
      input.value = A.get(k);
      linha.querySelector(".bcVal").textContent = A.get(k);
    }
  });
  addEventListener("resize", redimensionar);
}

ligar();
