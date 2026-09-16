// Cena 3D da mesa (Three.js, módulo ES).
//
// Não conhece regra de jogo: recebe o mesmo `state` que o cliente 2D e desenha.
// A API é só isto:
//   init(container), update(state, myId), emote(ev), resize(), dispose()
//
// Personagens são placeholders propositais (cápsula + cabeça + braços). A
// customização (corpo, rosto, camisa, cabelo) entra depois — a primeira
// entrega é ver a mesa em pé e julgar o clima.

import * as THREE from "three";

const COLORS = [0x3aa6ff, 0x2dd36f, 0xff6ad5, 0xff9d3a, 0xa78bfa, 0x22d3ee];

let renderer, scene, camera, clock, myHand;
let container = null;
let lamp, lampPivot, lampLight;
let table, deckMesh, bankMesh;
let raf = 0;
let disposed = false;

const seats = new Map(); // playerId -> { group, ... }
const texLoader = new THREE.TextureLoader();
const texCache = new Map();

let myId = null;
let lastState = null;
const shakeUntil = { t: 0 };

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function cardTexture(url) {
  if (!texCache.has(url)) {
    const t = texLoader.load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(url, t);
  }
  return texCache.get(url);
}

// rótulo de texto como sprite (nome e moedas flutuando sobre o jogador)
function makeLabel(text, color = "#ffffff") {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d");
  g.clearRect(0, 0, c.width, c.height);
  g.font = "bold 62px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 10;
  g.strokeStyle = "rgba(0,0,0,.85)";
  g.strokeText(text, 256, 64);
  g.fillStyle = color;
  g.fillText(text, 256, 64);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  spr.scale.set(1.6, 0.4, 1);
  spr.userData.redraw = (txt, col) => {
    g.clearRect(0, 0, c.width, c.height);
    g.lineWidth = 10;
    g.strokeStyle = "rgba(0,0,0,.85)";
    g.strokeText(txt, 256, 64);
    g.fillStyle = col || color;
    g.fillText(txt, 256, 64);
    tex.needsUpdate = true;
  };
  return spr;
}

/* ------------------------------------------------------------------ */
/* cenário                                                             */
/* ------------------------------------------------------------------ */

function buildRoom() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07070a);
  scene.fog = new THREE.Fog(0x07070a, 7, 20);

  // chão e paredes: caixa grande virada para dentro
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(18, 7, 18),
    new THREE.MeshStandardMaterial({
      color: 0x14121a,
      roughness: 1,
      metalness: 0,
      side: THREE.BackSide,
    }),
  );
  room.position.y = 3;
  room.receiveShadow = true;
  scene.add(room);

  // mesa redonda de feltro
  table = new THREE.Group();
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(2.05, 2.05, 0.16, 64),
    new THREE.MeshStandardMaterial({ color: 0x1f5c35, roughness: 0.95 }),
  );
  top.position.y = 0.92;
  top.receiveShadow = true;
  table.add(top);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(2.07, 0.09, 16, 64),
    new THREE.MeshStandardMaterial({ color: 0x3a2412, roughness: 0.6 }),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.95;
  table.add(rim);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.7, 0.9, 24),
    new THREE.MeshStandardMaterial({ color: 0x2a1c10, roughness: 0.8 }),
  );
  base.position.y = 0.45;
  table.add(base);
  scene.add(table);

  // baralho e pilha de fichas no centro
  deckMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.12, 0.48),
    new THREE.MeshStandardMaterial({ color: 0x14203a, roughness: 0.7 }),
  );
  deckMesh.position.set(-0.32, 1.06, 0.1);
  deckMesh.castShadow = true;
  table.add(deckMesh);

  bankMesh = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const chip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.025, 20),
      new THREE.MeshStandardMaterial({
        color: i % 2 ? 0xd9d9d9 : 0xf0b429,
        roughness: 0.35,
        metalness: 0.65,
      }),
    );
    chip.position.set(0.32, 1.02 + i * 0.026, 0.1);
    bankMesh.add(chip);
  }
  table.add(bankMesh);
}

// lâmpada pendurada que balança devagar e ilumina só a mesa
function buildLamp() {
  lampPivot = new THREE.Group();
  lampPivot.position.set(0, 4.4, 0);
  scene.add(lampPivot);

  const cord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 1.5, 6),
    new THREE.MeshBasicMaterial({ color: 0x0a0a0a }),
  );
  cord.position.y = -0.75;
  lampPivot.add(cord);

  lamp = new THREE.Group();
  lamp.position.y = -1.5;

  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.45, 0.4, 24, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x2b2b30,
      roughness: 0.7,
      side: THREE.DoubleSide,
    }),
  );
  shade.rotation.x = Math.PI;
  lamp.add(shade);

  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
  );
  bulb.position.y = -0.14;
  lamp.add(bulb);

  // Luz quente e baixa: a mesa acende, o resto da sala fica no escuro.
  // O cone é largo o bastante para pegar os rostos em volta — mais fechado
  // que isso e os jogadores somem.
  lampLight = new THREE.SpotLight(0xffc987, 75, 14, Math.PI / 3.4, 0.62, 1.3);
  lampLight.position.set(0, -0.12, 0);
  lampLight.target.position.set(0, -4, 0);
  lampLight.castShadow = true;
  lampLight.shadow.mapSize.set(1024, 1024);
  lamp.add(lampLight);
  lamp.add(lampLight.target);

  lampPivot.add(lamp);

  // um respiro ambiente para os rostos não ficarem chapados de preto
  scene.add(new THREE.AmbientLight(0x3a3355, 1.25));
  const fill = new THREE.PointLight(0x5a4a80, 14, 16);
  fill.position.set(0, 3.4, 0);
  scene.add(fill);
}

/* ------------------------------------------------------------------ */
/* personagem                                                          */
/* ------------------------------------------------------------------ */

function buildCharacter(colorIdx, propKind) {
  const g = new THREE.Group();
  const shirt = new THREE.Color(COLORS[colorIdx % COLORS.length]);

  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xc98f5d,
    roughness: 0.85,
  });
  const shirtMat = new THREE.MeshStandardMaterial({
    color: shirt,
    roughness: 0.75,
  });

  // tronco
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.26, 0.42, 6, 14),
    shirtMat,
  );
  torso.position.y = 1.16;
  torso.castShadow = true;
  g.add(torso);

  // cabeça
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 16), skinMat);
  head.position.y = 1.68;
  head.castShadow = true;
  g.add(head);

  // cabelo (calota)
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.9 }),
  );
  hair.position.y = 1.7;
  g.add(hair);

  // braços apoiados na mesa
  const arms = new THREE.Group();
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.075, 0.34, 4, 10),
      shirtMat,
    );
    arm.position.set(s * 0.3, 1.12, 0.16);
    arm.rotation.set(-0.9, 0, s * 0.22);
    arm.castShadow = true;
    arms.add(arm);
  }
  g.add(arms);
  g.userData.arms = arms;

  // adereço: cigarro (com brasa e fumaça) ou capim na boca
  const prop = new THREE.Group();
  prop.position.set(0.09, 1.62, 0.17);
  if (propKind === "smoke") {
    const cig = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6),
      new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.9 }),
    );
    cig.rotation.set(Math.PI / 2, 0, -0.25);
    cig.position.z = 0.08;
    prop.add(cig);

    const ember = new THREE.Mesh(
      new THREE.SphereGeometry(0.016, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff6a1a }),
    );
    ember.position.set(0.02, 0.01, 0.16);
    prop.add(ember);
    prop.userData.ember = ember;

    // fumaça: três puffs subindo em loop
    const puffs = [];
    for (let i = 0; i < 3; i++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 8, 8),
        new THREE.MeshBasicMaterial({
          color: 0xbfc4cc,
          transparent: true,
          opacity: 0.16,
          depthWrite: false,
        }),
      );
      puff.position.set(0.02, 0.05 + i * 0.16, 0.15);
      puff.userData.phase = i / 3;
      prop.add(puff);
      puffs.push(puff);
    }
    prop.userData.puffs = puffs;
  } else {
    const straw = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.004, 0.22, 5),
      new THREE.MeshStandardMaterial({ color: 0x9ab04a, roughness: 1 }),
    );
    straw.rotation.set(Math.PI / 2.4, 0, -0.5);
    straw.position.set(0.01, -0.01, 0.1);
    prop.add(straw);
  }
  g.add(prop);
  g.userData.prop = prop;

  return g;
}

/* ------------------------------------------------------------------ */
/* assentos                                                            */
/* ------------------------------------------------------------------ */

// Onde cada um senta. O jogador local fica no ângulo 0 (perto da câmera) e os
// outros se espalham pelo ARCO OPOSTO da mesa — num círculo completo, quem
// estivesse a 90° ficaria ao lado da câmera e nunca apareceria na tela.
const SEAT_R = 2.9;
const FAR_ARC = Math.PI * 0.55;

function seatAngle(idx, total) {
  if (idx === 0) return 0;
  const k = total - 1; // quantos adversários
  if (k <= 1) return Math.PI;
  const t = (idx - 1) / (k - 1); // 0..1
  return Math.PI - FAR_ARC / 2 + t * FAR_ARC;
}

function buildSeat(p, idx, total) {
  const g = new THREE.Group();

  const ang = seatAngle(idx, total);
  g.position.set(Math.sin(ang) * SEAT_R, 0, Math.cos(ang) * SEAT_R);
  g.lookAt(0, 1, 0);

  const body = buildCharacter(p.color ?? 0, idx % 2 ? "straw" : "smoke");
  g.add(body);

  // as duas cartas na mão, inclinadas para o dono
  const hand = new THREE.Group();
  hand.position.set(0, 1.12, 0.42);
  hand.rotation.x = -0.55;
  const cards = [];
  for (let i = 0; i < 2; i++) {
    const card = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.44),
      new THREE.MeshStandardMaterial({
        color: 0x16213a,
        roughness: 0.6,
        side: THREE.DoubleSide,
      }),
    );
    card.position.set((i - 0.5) * 0.34, 0, i * 0.004);
    card.rotation.z = (i - 0.5) * 0.16;
    card.castShadow = true;
    hand.add(card);
    cards.push(card);
  }
  g.add(hand);

  // fichas do jogador, na frente dele
  const chips = new THREE.Group();
  chips.position.set(0.55, 1.0, 0.28);
  g.add(chips);

  const label = makeLabel(p.nick);
  label.position.set(0, 2.12, 0);
  g.add(label);

  const coinLbl = makeLabel("0", "#ffd400");
  coinLbl.scale.set(0.9, 0.24, 1);
  coinLbl.position.set(0, 1.92, 0);
  g.add(coinLbl);

  // anel no chão marcando de quem é a vez
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.56, 32),
    new THREE.MeshBasicMaterial({
      color: COLORS[(p.color ?? 0) % COLORS.length],
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  g.add(ring);

  scene.add(g);
  return { group: g, body, hand, cards, chips, label, coinLbl, ring, nick: "", sig: "" };
}

function updateChips(seat, coins) {
  if (seat.chipsN === coins) return;
  seat.chipsN = coins;

  seat.chips.clear();
  const gold = Math.floor(coins / 5);
  const silver = coins % 5;
  let i = 0;
  const mk = (isGold, n) => {
    for (let k = 0; k < n; k++) {
      const c = new THREE.Mesh(
        new THREE.CylinderGeometry(0.075, 0.075, 0.022, 16),
        new THREE.MeshStandardMaterial({
          color: isGold ? 0xf0b429 : 0xd9d9d9,
          roughness: 0.35,
          metalness: 0.6,
        }),
      );
      // empilha em colunas de 5 para não virar torre
      const col = Math.floor(i / 5);
      c.position.set(col * 0.19, (i % 5) * 0.023, 0);
      c.castShadow = true;
      seat.chips.add(c);
      i++;
    }
  };
  mk(true, gold);
  mk(false, silver);
}

function updateCards(seat, p, mine) {
  const sig = (p.hand || [])
    .map((c) => `${c.role || "?"}|${c.alive}`)
    .join(",");
  if (seat.sig === sig) return;
  seat.sig = sig;

  (p.hand || []).forEach((c, i) => {
    const mesh = seat.cards[i];
    if (!mesh) return;

    const show = mine ? c.role : c.alive ? null : c.role;
    if (show) {
      mesh.material.map = cardTexture(`/img/${window.UI.theme}/${
        window.UI.roleClass(show)
      }.webp`);
      mesh.material.color.set(0xffffff);
    } else {
      mesh.material.map = null;
      mesh.material.color.set(0x16213a);
    }
    mesh.material.needsUpdate = true;

    // carta perdida tomba na mesa
    mesh.rotation.z = c.alive ? (i - 0.5) * 0.16 : (i - 0.5) * 0.16 + 0.5;
    mesh.material.opacity = c.alive ? 1 : 0.5;
    mesh.material.transparent = !c.alive;
  });
}

// A SUA mão fica presa à câmera, como cartas na mão de verdade: você olha a
// mesa pelos olhos do seu personagem, então não adianta desenhá-la no mundo —
// ficaria atrás da sua própria cabeça.
function buildMyHand() {
  myHand = new THREE.Group();
  myHand.position.set(0, -0.44, -1.32);
  myHand.rotation.x = 0.34;

  for (let i = 0; i < 2; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.6),
      // Basic (sem luz) de propósito: a sala é escura, mas a sua mão
      // precisa estar sempre legível
      new THREE.MeshBasicMaterial({ color: 0x16213a, side: THREE.DoubleSide }),
    );
    m.position.set((i - 0.5) * 0.5, 0, i * 0.002);
    m.rotation.z = (i - 0.5) * -0.18;
    myHand.add(m);
  }

  camera.add(myHand);
  scene.add(camera); // a câmera precisa estar na cena para os filhos aparecerem
}

function updateMyHand(p) {
  if (!myHand || !p) return;
  (p.hand || []).forEach((c, i) => {
    const m = myHand.children[i];
    if (!m) return;
    if (c.role) {
      m.material.map = cardTexture(
        `/img/${window.UI.theme}/${window.UI.roleClass(c.role)}.webp`,
      );
      m.material.color.set(0xffffff);
    } else {
      m.material.map = null;
      m.material.color.set(0x16213a);
    }
    m.material.opacity = c.alive ? 1 : 0.45;
    m.material.transparent = !c.alive;
    m.rotation.z = (i - 0.5) * -0.18 + (c.alive ? 0 : 0.35);
    m.material.needsUpdate = true;
  });
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

export function init(el) {
  container = el;
  disposed = false;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(el.clientWidth || 800, el.clientHeight || 600);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  el.appendChild(renderer.domElement);

  camera = new THREE.PerspectiveCamera(
    64, // largo o bastante para caber todo mundo do outro lado da mesa
    (el.clientWidth || 800) / (el.clientHeight || 600),
    0.1,
    100,
  );

  buildRoom();
  buildLamp();
  buildMyHand();

  clock = new THREE.Clock();
  animate();
}

export function resize() {
  if (!renderer || !container) return;
  const w = container.clientWidth || 800;
  const h = container.clientHeight || 600;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

export function update(state, meId) {
  if (!scene) return;
  lastState = state;
  myId = meId;

  const players = state?.playersInGame || [];
  const ids = new Set(players.map((p) => p.id));

  for (const [id, s] of seats) {
    if (!ids.has(id)) {
      scene.remove(s.group);
      seats.delete(id);
    }
  }

  // roda a ordem para o jogador local ficar sempre na frente da câmera
  const meIdx = players.findIndex((p) => p.id === meId);
  const order = meIdx >= 0 ? players.slice(meIdx).concat(players.slice(0, meIdx)) : players;

  order.forEach((p, i) => {
    let s = seats.get(p.id);
    if (!s) {
      s = buildSeat(p, i, order.length);
      seats.set(p.id, s);
    }

    if (s.nick !== p.nick) {
      s.nick = p.nick;
      s.label.userData.redraw(p.nick);
    }
    if (s.coinsShown !== p.coins) {
      s.coinsShown = p.coins;
      s.coinLbl.userData.redraw(String(p.coins), "#ffd400");
    }
    updateChips(s, p.coins);
    updateCards(s, p, p.id === meId);

    const current = state.phase === "turn" && state.currentPlayerId === p.id;
    s.ring.material.opacity = current ? 0.85 : 0;

    // você olha pelos olhos do seu personagem: some com ele e com o próprio
    // rótulo, senão a cabeça tapa a mesa inteira
    const isMe = p.id === meId;
    s.body.visible = !isMe;
    s.hand.visible = !isMe;
    s.label.visible = !isMe;
    s.coinLbl.visible = !isMe;

    // eliminado afunda um pouco e escurece
    const dead = p.aliveCount <= 0;
    s.body.position.y = dead ? -0.25 : 0;
    s.body.traverse((o) => {
      if (o.isMesh && o.material && o.material.color)
        o.material.opacity = dead ? 0.45 : 1;
    });
  });

  // Câmera na altura dos olhos do jogador local, olhando a mesa.
  const me = seats.get(meId);
  if (me) {
    const p = me.group.position;
    camera.position.set(p.x * 1.34, 2.12, p.z * 1.34);
    camera.lookAt(0, 0.92, 0);
    updateMyHand(players.find((x) => x.id === meId));
  } else {
    // espectador: vista de cima, de fora da mesa
    camera.position.set(0, 4.6, 6.2);
    camera.lookAt(0, 0.9, 0);
    if (myHand) myHand.visible = false;
  }
  if (myHand) myHand.visible = !!me;

  if (deckMesh) deckMesh.visible = (state?.deckCount ?? 0) > 0;
}

export function emote(ev) {
  const s = seats.get(ev.playerId);
  if (!s) return;

  if (ev.kind === "bang") {
    // a mesa treme e as cartas de todo mundo pulam
    shakeUntil.t = performance.now() + 900;
    for (const [, o] of seats) {
      o.cards.forEach((c) => {
        c.userData.jump = performance.now() + 700;
      });
    }
  } else if (ev.kind === "finger" || ev.kind === "l13") {
    // levanta um braço; o outro segue segurando a carta
    s.body.userData.raise = performance.now() + 2000;
  } else if (ev.kind === "clap") {
    s.body.userData.clap = performance.now() + 1500;
  }
}

function animate() {
  if (disposed) return;
  raf = requestAnimationFrame(animate);

  const t = clock.getElapsedTime();
  const nowMs = performance.now();

  // lâmpada balançando devagar
  if (lampPivot) {
    lampPivot.rotation.z = Math.sin(t * 0.55) * 0.055;
    lampPivot.rotation.x = Math.cos(t * 0.41) * 0.035;
  }

  // mesa tremendo depois de uma batida
  if (table) {
    const left = shakeUntil.t - nowMs;
    if (left > 0) {
      const k = (left / 900) * 0.035;
      table.position.x = Math.sin(nowMs * 0.05) * k;
      table.position.z = Math.cos(nowMs * 0.043) * k;
    } else {
      table.position.x = table.position.z = 0;
    }
  }

  for (const [, s] of seats) {
    // respiração: o tronco sobe e desce de leve
    s.body.position.y += 0; // base definida no update (eliminado)
    s.body.rotation.z = Math.sin(t * 0.8 + s.group.position.x) * 0.012;

    // fumaça subindo
    const prop = s.body.userData.prop;
    const puffs = prop?.userData?.puffs;
    if (puffs) {
      for (const puff of puffs) {
        const ph = (t * 0.28 + puff.userData.phase) % 1;
        puff.position.y = 0.05 + ph * 0.55;
        puff.position.x = 0.02 + Math.sin(ph * 6 + puff.userData.phase * 9) * 0.05;
        puff.scale.setScalar(0.6 + ph * 1.9);
        puff.material.opacity = 0.2 * (1 - ph);
      }
      if (prop.userData.ember)
        prop.userData.ember.material.color.setHSL(
          0.05,
          1,
          0.45 + Math.sin(t * 2.2) * 0.12,
        );
    }

    // braço levantado (dedo / L) e palmas
    const arms = s.body.userData.arms;
    if (arms) {
      const raise = (s.body.userData.raise || 0) - nowMs;
      const clap = (s.body.userData.clap || 0) - nowMs;
      const a = arms.children[1];
      if (raise > 0) {
        const k = Math.min(1, (2000 - raise) / 600);
        a.rotation.x = -0.9 - k * 1.5;
        a.position.y = 1.12 + k * 0.42;
      } else if (clap > 0) {
        const s2 = Math.sin(nowMs * 0.02) * 0.18;
        arms.children[0].position.x = -0.3 + 0.16 + s2;
        arms.children[1].position.x = 0.3 - 0.16 - s2;
      } else {
        a.rotation.x = -0.9;
        a.position.y = 1.12;
        arms.children[0].position.x = -0.3;
        arms.children[1].position.x = 0.3;
      }
    }

    // cartas pulando quando alguém bate na mesa
    s.cards.forEach((c, i) => {
      const left = (c.userData.jump || 0) - nowMs;
      c.position.y = left > 0 ? Math.abs(Math.sin(left * 0.02)) * 0.12 * (left / 700) : 0;
    });
  }

  renderer.render(scene, camera);
}

export function dispose() {
  disposed = true;
  cancelAnimationFrame(raf);
  seats.clear();
  if (renderer) {
    renderer.dispose();
    if (renderer.domElement.parentNode)
      renderer.domElement.parentNode.removeChild(renderer.domElement);
  }
  renderer = scene = camera = null;
}
