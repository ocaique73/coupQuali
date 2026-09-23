// Guarda a instância do socket.io e entrega o estado a cada jogador.
// Separado para que game/tick/handlers não precisem conhecer o servidor HTTP.
const { roomPublicState } = require("./state");

let io = null;
function attach(server) {
  io = server;
}

function broadcast(room) {
  // p.id é o pid estável; quem recebe o socket é p.socketId
  for (const p of room.players) {
    if (!p.connected || !p.socketId) continue;
    io.to(p.socketId).emit("state", roomPublicState(room, p.id));
  }
}

// Recado leve para o resto da sala, SEM passar pelo estado.
//
// Existe para o que muda a cada quadro do mouse: o empurrão na lâmpada e para
// onde cada um está olhando. Um broadcast de estado inteiro por quadro
// arrastaria a sala inteira, e nada disso é regra de jogo — se um pacote se
// perder, a cena do outro só fica um piscar de olhos atrasada.
function relay(room, exceptPid, evento, dados) {
  if (!io) return;
  for (const p of room.players) {
    if (!p.connected || !p.socketId || p.id === exceptPid) continue;
    io.to(p.socketId).emit(evento, dados);
  }
}

module.exports = { attach, broadcast, relay, getIO: () => io };
