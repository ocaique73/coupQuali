// helpers UI (sem socket)

window.UI = {
  timeLeft(ts) {
    const ms = Math.max(0, ts - Date.now());
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  },

  roleClass(role) {
    if (!role) return "back";
    const r = role.toLowerCase();
    if (r === "duke") return "duke";
    if (r === "assassin") return "assassin";
    if (r === "captain") return "captain";
    if (r === "ambassador") return "ambassador";
    if (r === "contessa") return "contessa";
    return "back";
  },

  // posições em círculo (2..6 perfeito)
  seatPositions(n) {
    const positions = [];
    const centerX = 50;
    const centerY = 52;
    const radiusX = 38;
    const radiusY = 33;

    for (let i = 0; i < n; i++) {
      const angle = (-90 + (360 / n) * i) * (Math.PI / 180);
      const x = centerX + Math.cos(angle) * radiusX;
      const y = centerY + Math.sin(angle) * radiusY;
      positions.push({ x, y });
    }
    return positions;
  },
};
