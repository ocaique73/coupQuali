// Regras estáticas das cartas: o que cada ação alega e quem bloqueia o quê.

function actionRequiresClaim(type) {
  return ["tax", "assassinate", "steal", "exchange"].includes(type);
}
function claimRoleForAction(type) {
  switch (type) {
    case "tax":
      return "Duke";
    case "assassinate":
      return "Assassin";
    case "steal":
      return "Captain";
    case "exchange":
      return "Ambassador";
    default:
      return null;
  }
}
function actionBlockInfo(type) {
  if (type === "foreign_aid")
    return { blockable: true, blockers: "any", roles: ["Duke"] };
  if (type === "assassinate")
    return { blockable: true, blockers: "target", roles: ["Contessa"] };
  if (type === "steal")
    return {
      blockable: true,
      blockers: "target",
      roles: ["Captain", "Ambassador"],
    };
  return { blockable: false, blockers: "none", roles: [] };
}

module.exports = { actionRequiresClaim, claimRoleForAction, actionBlockInfo };
