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

## Onde está no ar

**https://coupquali.onrender.com** — Render, deploy automático a cada push na
`main`.

> Está escrito aqui porque **não existe nenhum arquivo de deploy no repo**: o
> Render é configurado pelo painel dele. Sem esta anotação, quem olha só o
> código conclui que o projeto não tem deploy — que foi exatamente o que
> aconteceu uma vez.

Depois do `git push` o build do Render leva alguns minutos. O plano free
ainda **hiberna** depois de ~15 min parado, e o primeiro acesso demora até uns
50 s para acordar. Nada disso é cache: os arquivos saem com
`Cache-Control: max-age=0` + ETag, então recarregar a página já pega o novo.
O que **não** pega sozinho é a aba que ficou aberta desde antes do deploy —
essa precisa de um F5.

### Os números da cena são do SERVIDOR

O que as bancadas ajustam vale para **todas as salas e todos os jogadores** —
o servidor guarda (`src/ajustes.js`) e espalha. O `localStorage` saiu: com
ele, cada navegador tinha a sua versão do jogo.

Ajustar uma barra vale na hora para todo mundo, mas fica só na memória do
servidor: morre num deploy e quando o Render hiberna.

**Para fixar de verdade existe o botão "Fixar permanente"**, nas duas bancadas.
O único lugar que sobrevive a um redeploy é o repositório — é dele que o deploy
nasce — então o botão grava `ajustes.json` lá. Dois caminhos:

- **com token:** commita direto pela API do GitHub. Precisa de duas variáveis
  de ambiente no painel do Render:

  | variável | valor |
  | --- | --- |
  | `GITHUB_TOKEN` | token com permissão de escrita em *Contents* |
  | `GITHUB_REPO` | `ocaique73/coupQuali` |
  | `GITHUB_BRANCH` | opcional, `main` por padrão |

  O token fica só dentro das chamadas do `src/ajustes.js`: não vai para log
  nem para o navegador.

- **sem token:** o botão baixa o `ajustes.json` para commitar na mão. Mesmo
  resultado, um passo a mais.

O `ajustes.json` **não** está no `.gitignore` de propósito — se for ignorado,
"fixar" para de funcionar. O *Copiar para o código* continua existindo para
quando um número merecer virar `PADRAO` no `public/ajustes3d.js`.

E **a bancada não tem dono**: quem abrir `/teste` muda a cena de todo mundo.

A lâmpada é o contrário: **por sala**. Balançar na sala principal não mexe na
`/22`.

Telas auxiliares, fora da partida:

| rota | para quê |
| --- | --- |
| `/teste` | bancada da mesa, luz, lâmpada e câmera |
| `/personagem` | modelar o boneco, em tela cheia |

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

## Sessão 2 (15/09/2026) — arte, ritmo, modal de resposta e o bug da fila

### Arte real das cartas

Os 5 personagens agora usam as ilustrações em `public/img/*.webp`
(`ambassador`, `assassin`, `captain`, `contessa`, `duke`). Vieram de PNGs de
~2,5 MB cada e foram redimensionadas para 460px de largura em WebP q82 —
**12 MB → 312 KB no total**. Aparecem nas mini-cartas da mesa, nas cartas
grandes dos modais, nas miniaturas do guia lateral e nas cartas que voam nas
animações.

Para trocar a arte de um personagem basta substituir o `.webp`: o nome do
arquivo vem de `ROLE_META[role].cls` em [public/ui.js](public/ui.js), e
`UI.roleArt()` já cai no emoji como fallback se a imagem não carregar.

> ⚠️ **O emoji 🪙 (U+1FA99) não existe na fonte desta máquina** — aparecia como
> quadradinho vazio. Foi trocado por uma moeda desenhada em CSS (`.micon`,
> `.fxCoin`, `.bankCoin`). Testei todos os outros emojis usados e renderizam
> bem; se for adicionar algum novo, desconfie de emoji lançado depois de 2019.

### Banco de moedas no centro

Faltava a origem visual das moedas: a animação tirava moeda do centro da mesa,
mas não havia nada lá. Agora existe uma pilha (`#bankPile`) ao lado do baralho,
e `bankRect()` no client.js é a âncora das animações de moeda.

### Animações 30% mais lentas

`SPEED = 1.3` no topo de [public/fx.js](public/fx.js) — **é o ponto único de
ajuste**. Multiplica as durações do Web Animations API, as da fila e, via
`animationDuration` inline no `ping()`, também as keyframes do CSS. Para mudar
o ritmo do jogo inteiro, mexa só nesse número.

### Respostas em modal

As caixas de Aceitar/Contestar/Bloquear saíram do topo da mesa e viraram o
modal `#responseModal`, que abre na hora em que outro jogador declara algo, com
a contagem regressiva no canto.

**O modal fecha assim que você responde** — daí em diante sua resposta aparece
na mesa, como pedido.

### Resposta ao lado do card, tempo embaixo

O assento foi reestruturado: `.seat` virou só o container de posicionamento e
`.seatCard` é a caixa visível. A resposta (ACEITA / CONTESTA / BLOQUEIA) fica
**fora** do card, ao lado dele; o cronômetro com barra de progresso fica **fora
e abaixo**.

Assentos da metade direita da mesa recebem a classe `.badgeLeft` e jogam o
badge para o lado de dentro — senão ele sairia da área da mesa.

### Sala × fila (o bug)

Antes `roomPlayers` era *todo mundo conectado* e `lobby` era *todo mundo
não-em-jogo*, então a mesma pessoa aparecia nas duas listas. Agora existe
`p.seated` no servidor e os conjuntos são **disjuntos**:

- **Sala** = `seatedPlayers()`, no máximo `MAX_SEATS` (6)
- **Fila** = `queuedPlayers()` — quem chegou com a sala cheia **ou** com a
  partida já em andamento
- O host puxa com `promote` e devolve para a fila com `demote` (só fora de
  partida)
- Quem está na fila não fica READY e não entra na partida

---

## Como a sessão 2 foi testada

Mesmo esquema: scripts temporários, fora do repositório.

1. **Sala × fila** — 7 jogadores: 6 sentam e 1 vai para a fila; os conjuntos
   não se cruzam; quem está na fila não consegue ficar READY; `demote` abre
   cadeira; `promote` traz de volta; quem entra com a partida rolando cai na
   fila; e o host não consegue puxar durante a partida. **19/19 passaram.**
2. **Cliente em DOM headless** — badge é filho direto do `.seat` (ou seja, fora
   do card), cronômetro renderiza depois do card, cartas usando `<img>` de
   `/img/*.webp`, guia com as 5 miniaturas, banco de moedas presente,
   contadores `2/6` e `1`, botão Puxar para o host, modal abrindo e **fechando
   após responder**, badge virando CONTESTA, mais o gating de sempre.
   **26/26 passaram, zero erro de runtime.**
3. **Screenshots reais** (Chrome headless, com o estado renderizado) da mesa e
   do modal — foi assim que apareceu o emoji 🪙 quebrado, que nenhum teste de
   lógica pegaria.

> O jogo ainda **não foi jogado de verdade num navegador com várias pessoas**.
> Layout e lógica estão conferidos; o que falta julgar é o *ritmo* das
> animações jogando de fato.

### Reproduzindo os screenshots

O Chrome headless trava se sobrar processo de uma execução anterior. O que
funcionou:

```bash
taskkill //F //IM chrome.exe
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --headless=new --no-sandbox --disable-gpu --no-first-run \
  --user-data-dir="<perfil novo a cada vez>" \
  --window-size=1680,1000 --virtual-time-budget=4000 \
  --screenshot=saida.png http://localhost:3000/__preview.html
```

A página `__preview.html` era gerada com jsdom (roda o client com um estado
falso e serializa o DOM sem os `<script>`) e apagada depois — não está no repo.

---

## Próximos passos sugeridos

1. **Abrir no navegador com 2–3 abas e jogar uma partida inteira.** Se o ritmo
   não agradar, ajuste `SPEED` em `public/fx.js` (hoje 1.3) — é o único lugar.
2. **Som.** Os eventos já estão todos estruturados — dá para pendurar áudio no
   `scheduleEvent()` sem tocar em mais nada. Provavelmente o maior ganho de
   "legal de jogar" pelo menor esforço.
3. ~~Arte das cartas~~ — feito na sessão 2 (`public/img/*.webp`).
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
| [public/img/](public/img/) | Arte dos 5 personagens (WebP) |
