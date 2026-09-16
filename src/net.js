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

module.exports = { attach, broadcast, getIO: () => io };
