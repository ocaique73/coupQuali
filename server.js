// Ponto de entrada: sobe o HTTP + socket.io e liga os módulos de src/.
//
// Camadas (as dependências só apontam para baixo, nunca há ciclo):
//   constants / util / rules   nada dependem
//   rooms                      estado mutável das salas
//   state                      o que cada jogador enxerga
//   net                        broadcast
//   game                       regras do jogo
//   tick / handlers            relógio e eventos do navegador
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const net = require("./src/net");
const tick = require("./src/tick");
const handlers = require("./src/handlers");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// Qualquer codigo de sala serve a mesma pagina. Ate 16 caracteres porque
// /teste — a bancada de ajustes do 3D — nao cabia no limite antigo de 4.
app.get(/^\/([A-Za-z0-9]{1,16})?$/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

net.attach(io);
handlers.register(io);
tick.start();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on", PORT));
