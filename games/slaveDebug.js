// Invoke only after the socket handler checks staging, membership and host/admin authorization.
const engine = require('./slaveEngine');
const ACTIONS = ['inspect', 'auto', 'finish', 'exchange', 'next', 'restart'];
function auto(room) {
  const s = room.gameState;
  if (!['turn', 'exchange'].includes(s.phase)) throw new Error('ไม่มีตาที่ต้องเดินอัตโนมัติ');
  s.phaseEndsAt = Date.now() - 1;
  engine.autoResolvePhase(room);
}
function run(room, id, action, step) {
  if (!ACTIONS.includes(action)) throw new Error('ไม่รู้จักคำสั่งทดสอบ');
  if (action === 'inspect') { room.gameState.debugUsed = true; return; }
  if (step !== room.gameState.step) throw new Error('ตาเปลี่ยนแล้ว กรุณาลองใหม่');
  const s = room.gameState;
  if (action === 'auto') auto(room);
  if (action === 'exchange') {
    if (s.phase !== 'exchange') throw new Error('ตอนนี้ไม่ได้อยู่ช่วงแลกไพ่');
    while (s.phase === 'exchange') auto(room);
  }
  if (action === 'finish') {
    if (!['turn', 'exchange'].includes(s.phase)) throw new Error('รอบนี้จบแล้ว');
    for (let n = 0; n < 1000 && ['turn', 'exchange'].includes(s.phase); n++) auto(room);
    if (s.phase !== 'round-end') throw new Error('ไม่สามารถจบรอบอัตโนมัติได้');
  }
  if (action === 'next') engine.nextRound(room, room.admin);
  if (action === 'restart') {
    const previousStep = s.step;
    engine.startGame(room);
    room.gameState.step = previousStep + 1; // Reject commands from before this redeal.
  }
  room.gameState.debugUsed = true;
}
function snapshot(room) {
  return { phase: room.gameState.phase, step: room.gameState.step, hands: room.gameState.seats.map(p => ({ playerId: p.playerId, name: p.name, cards: p.hand.map(engine.describeCard) })) };
}
module.exports = { run, snapshot };
