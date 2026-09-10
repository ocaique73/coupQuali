# Onde paramos — Coup Online

> Anotações de handoff. Leia isto antes de continuar (inclusive o Claude, ao puxar o repo).

## Como rodar

```bash
npm install       # se ainda não tiver node_modules
npm start         # sobe em http://localhost:3000
PORT=3123 npm start   # porta alternativa
```

Abra duas abas em `http://localhost:3000/SALA` (o código da sala vem da URL, 1–4
caracteres). Cada aba entra com um nick, ambas ficam READY, e o **host** (👑, o
primeiro a entrar) clica em *Iniciar*. Mínimo 2 jogadores, máximo 6.

---

## O que foi feito nesta sessão

Objetivo: **animações no jogo inteiro** e **botões de ação que só ficam ativos
quando a jogada é realmente possível**.

### 1. Servidor passou a emitir eventos ([server.js](server.js))

Antes o cliente só recebia `actionLog` (texto). Agora existe um canal de
**eventos estruturados**, que é o que permite animar:

```js
pushEvent(room, "coins", { playerId, delta: 3, reason: "tax" });
```

Cada evento tem `seq` (sequencial e crescente) e vai no estado em
`state.events` (últimos 40). O cliente guarda o último `seq` que já animou, e
anima só o que é novo — reconectar não replica o histórico inteiro.

Tipos emitidos hoje: `game_start`, `turn`, `coins`, `steal`, `action_declared`,
`block`, `challenge_result`, `reveal_replace`, `card_lost`, `eliminated`,
`coup`, `deck_draw`, `deck_return`, `winner`.

Também novos no estado: `deckCount` (cartas restantes no baralho) e `winner`.

**Detalhe importante do vencedor:** `endToLobby()` limpa `room.winner`, e o
`checkWin()` define o vencedor **depois** de chamar `endToLobby()`. Isso é de
propósito — a sala precisa voltar ao lobby, mas o overlay de vitória tem que
sobreviver a esse reset, senão ninguém chega a ver quem ganhou. Se mexer nessa
ordem, o overlay some.

### 2. Cliente reescrito para render incremental ([public/client.js](public/client.js))

Esse era o bloqueio de fato para qualquer animação: o `renderTable()` antigo
fazia `tableSeats.innerHTML = ""` e reconstruía os assentos **a cada 250 ms**,
destruindo qualquer animação em andamento.

Agora existe um `Map` `seatEls` (playerId → refs do DOM). Os assentos são
criados uma vez e depois só têm textos/classes atualizados. As mini-cartas usam
uma `dataset.sig` para só reescrever o HTML quando o conteúdo muda de verdade.

**Regra para mexer aqui:** nunca volte a usar `innerHTML = ...` em coisa que é
re-renderizada no loop de 250 ms. Se precisar de um elemento novo, crie no
`buildSeat()`.

### 3. Motor de animação ([public/fx.js](public/fx.js) — arquivo novo)

Não conhece regra de jogo nenhuma, só desenha. API:

- `FX.flyCard({from, to, role, faceDown})` — carta voando entre dois pontos
- `FX.flyCoins({from, to, count})` — moedas voando
- `FX.floatText({at, text, cls})` — `+3` / `-7` subindo
- `FX.revealCard({at, role})` — carta virando para cima
- `FX.banner({title, sub, cls})` — faixa no centro da mesa
- `FX.ping(el, "classe")` — aplica classe de animação e remove depois
- `FX.confetti(host)` — confete do vencedor

Usa Web Animations API (`el.animate`), com fallback silencioso se não existir e
respeito a `prefers-reduced-motion`.

**Fila:** `FX.enqueue(fn, duração)` toca as animações em ordem. Se muitos
eventos chegarem juntos, a fila **acelera sozinha** (fator `speed` de 1 → 0.6 →
0.35) para não ficar para trás do jogo. O `client.js` traduz evento → animação
na função `scheduleEvent()`.

Animações entregues: distribuição inicial das cartas, troca de turno, ganho e
gasto de moedas, roubo entre jogadores, compra e devolução ao baralho, carta
virando para cima, contestação (blefe pego vs. provado), bloqueio, eliminação,
golpe, e a vitória com troféu + confete.

### 4. Botões que só aparecem/ativam quando dá para usar

Era o segundo pedido. A função `actionAvailability(a)` em `client.js` devolve
`{ok, why}` — e o *porquê* aparece no próprio botão travado (🔒 "Precisa de 7
moedas (você tem 4)", 🔒 "É a vez de Fulano", 🔒 "Com 10+ moedas o Golpe é
obrigatório"). Optei por **travar com o motivo** em vez de esconder: some com a
confusão sem esconder as regras de quem está aprendendo.

Nas caixas de resposta é o contrário: botões que **estruturalmente não são seus**
(ex.: bloquear um assassinato que não é contra você) ficam **escondidos**, e uma
linha de dica explica quem pode: *"Só Fulano pode bloquear (com Condessa). Você
só pode aceitar ou contestar o Assassino."*

### 5. Outras melhorias de usabilidade

- **Alvo por clique na mesa**: o `<select>` de alvo foi removido. Clicou em
  "Assassinar", os assentos válidos piscam em vermelho com "🎯 Escolher" e você
  clica em quem quiser. `Esc` cancela.
- **Baralho visível no centro** com contador de cartas — serve de âncora para as
  animações de compra/devolução.
- **Guia de cartas** no painel direito (o que cada personagem faz e bloqueia).
- Barra de tempo por jogador, timer que fica vermelho nos últimos 10s.
- Descarte com ícone e cor por personagem.
- Nomes em português nas fases e nas cartas.
- Layout responsivo (1 coluna abaixo de 1200px).

---

## Como isso foi testado

Não há suíte de testes no repo. A validação foi feita com scripts temporários
(fora do repositório) usando `socket.io-client` e `jsdom`:

1. **Partida completa 2 jogadores** — confirmou que disparam `game_start`,
   `turn`, `coins`, `action_declared`, `card_lost`, `eliminated`, `winner`,
   `coup`; que `deckCount` varia; e que `winner` sobrevive ao volta-pro-lobby.
2. **4 jogadores com roteiro** — confirmou `block`, `deck_draw`, `deck_return`,
   `challenge_result` e `reveal_replace`.
3. **Cliente em DOM headless** — zero erros de runtime, e o gating conferido:
   com 11 moedas só *Golpe* fica ativo; com 5 moedas *Golpe* trava e
   *Assassinar* libera; fora do seu turno nada fica ativo; o overlay do
   vencedor abre e o ✕ fecha.

> **Nada disso foi testado num navegador real ainda.** A lógica e o gating estão
> verificados, mas o *visual* das animações (timing, se fica bonito, se enjoa)
> só dá para julgar jogando. É o primeiro passo sugerido abaixo.

---

## Próximos passos sugeridos

1. **Abrir no navegador com 2–3 abas e jogar uma partida inteira.** Ajustar
   durações no `scheduleEvent()` (`client.js`) se algo ficar lento ou atropelado.
2. **Som.** Os eventos já estão todos estruturados — dá para pendurar áudio no
   `scheduleEvent()` sem tocar em mais nada. Provavelmente o maior ganho de
   "legal de jogar" pelo menor esforço.
3. **Arte das cartas.** Hoje é emoji + cor. Trocar por ilustração deixaria muito
   mais bonito; o ponto de mudança é `renderMiniCard`/`updateMiniCard` e
   `UI.ROLE_META`.
4. **Mostrar quem ainda não respondeu** durante a fase de reação (hoje mostra
   quem já respondeu).
5. **`.gitignore` para `node_modules`.** ⚠️ Hoje `node_modules` está
   **versionado** (960 arquivos no índice) e não existe `.gitignore`. Isso
   suja qualquer diff e incha o repo. Vale limpar — mas é uma mudança grande e
   separada, então **não fiz nesta sessão** para não misturar com as animações.
   Quando for fazer: criar `.gitignore`, `git rm -r --cached node_modules`,
   commitar sozinho, e rodar `npm install` nas outras máquinas.
6. **Placar entre partidas** (quantas vitórias por jogador na sala).

---

## Mapa rápido dos arquivos

| Arquivo | Papel |
|---|---|
| [server.js](server.js) | Regras, máquina de estados, timers, emissão de eventos |
| [public/client.js](public/client.js) | Estado → DOM, evento → animação, gating dos botões |
| [public/fx.js](public/fx.js) | Motor de animação puro (sem regras) |
| [public/ui.js](public/ui.js) | Metadados dos personagens, formatação, posições dos assentos |
| [public/styles.css](public/styles.css) | Visual + todos os `@keyframes` |
| [public/index.html](public/index.html) | Estrutura, modais, overlay do vencedor |
