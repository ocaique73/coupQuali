// Vitrine 3D do personagem, usada na prévia do editor de perfil.
//
// Reaproveita o MESMO buildCharacter da mesa — se a prévia mostrasse um
// personagem construído por outro caminho, ela mentiria sobre o resultado.

import * as THREE from "three";
import { buildCharacter } from "./scene3d.js";

let renderer, scene, camera, clock, host;
let body = null;
let raf = 0;
let parado = false;

export function init(el) {
  host = el;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(el.clientWidth || 220, el.clientHeight || 260);
  el.appendChild(renderer.domElement);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    38,
    (el.clientWidth || 220) / (el.clientHeight || 260),
    0.1,
    50,
  );
  camera.position.set(0, 1.62, 1.85);
  camera.lookAt(0, 1.45, 0);

  // luz de estúdio: o personagem aqui precisa estar BEM visível, ao contrário
  // da mesa, que é escura de propósito
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const key = new THREE.DirectionalLight(0xfff0d8, 2.6);
  key.position.set(1.4, 3, 2.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88aaff, 1.4);
  rim.position.set(-1.8, 1.6, -1.6);
  scene.add(rim);

  clock = new THREE.Clock();
  animate();
}

export function setLook(cfg) {
  if (!scene) return;
  if (body) scene.remove(body);
  body = buildCharacter({
    color: cfg.color ?? 0,
    look: cfg.look,
    avatar: cfg.avatar,
    seed: 0,
  });
  scene.add(body);
}

export function pause() {
  parado = true;
}
export function resume() {
  if (!parado) return;
  parado = false;
  animate();
}

function animate() {
  if (parado) return;
  raf = requestAnimationFrame(animate);
  if (body) body.rotation.y = Math.sin(clock.getElapsedTime() * 0.5) * 0.7;
  renderer.render(scene, camera);
}

export function dispose() {
  parado = true;
  cancelAnimationFrame(raf);
  if (renderer) {
    renderer.dispose();
    if (renderer.domElement.parentNode)
      renderer.domElement.parentNode.removeChild(renderer.domElement);
  }
  renderer = scene = camera = body = null;
}
