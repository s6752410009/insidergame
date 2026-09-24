// Engine-level regression checks for Black Market (no server needed)
// node scripts/test-blackmarket-engine.js
const engine = require('../games/blackMarketEngine');

let failures = 0;
function check(condition, message) {
    if (condition) {
        console.log('  ok  ' + message);
    } else {
        failures += 1;
        console.error('  FAIL ' + message);
    }
}

function makeRoom(count, { offline = [] } = {}) {
    const players = [];
    for (let index = 0; index < count; index += 1) {
        const playerId = `p${index}`;
        players.push({
            playerId,
            playerName: `Player${index}`,
            color: '#fff',
            avatar: '🙂',
            socketId: offline.includes(playerId) ? null : `sock_${index}`
        });
    }
    return {
        roomId: 'room-test',
        players,
        settings: { gameMode: 'blackmarket', roundTime: 210 },
        gameState: engine.createInitialState()
    };
}

function setRoles(room, roles) {
    room.gameState.players.forEach((player, index) => {
        const roleId = roles[index];
        if (!roleId) return;
        player.role = roleId;
        player.roleInfo = engine.ROLE_DEFINITIONS[roleId];
    });
}

function toAction(room) {
    room.gameState.phase = 'action';
    room.gameState.status = 'blackmarket_action';
    room.gameState.actionChoices = {};
}

function publicText(room) {
    const state = room.gameState;
    return JSON.stringify({ report: state.lastRoundReport, history: state.history, ledger: state.dealLedger });
}

console.log('bug 7: dealing only connected players, cap 7');
{
    const room = makeRoom(5, { offline: ['p4'] });
    engine.startGame(room);
    check(room.gameState.players.length === 4, 'offline player is not dealt in (4 of 5)');
    check(!room.gameState.players.some(p => p.playerId === 'p4'), 'p4 (offline) not in game');

    const big = makeRoom(9);
    engine.startGame(big);
    check(big.gameState.players.length === 7, 'table capped at 7 players');
    check(big.gameState.players.every(p => p.role && p.roleInfo), 'every dealt player has a defined role');
    check(new Set(big.gameState.players.map(p => p.role)).size === 7, '7 distinct roles');
}

console.log('bug 2: client state hides others cash/heat/items, market report neutral');
{
    const room = makeRoom(4);
    engine.startGame(room);
    setRoles(room, ['boss', 'broker', 'smuggler', 'mole']);
    const offer = room.gameState.marketOffers.find(id => engine.ITEM_DEFINITIONS[id].price <= 4);
    engine.submitMarketPurchase(room, 'p0', offer);
    ['p1', 'p2', 'p3'].forEach(id => engine.submitMarketPurchase(room, id, engine.PASS_CHOICE));
    check(room.gameState.phase === 'action', 'market resolved to action');
    const itemName = engine.ITEM_DEFINITIONS[offer].name;
    const view1 = engine.buildClientState(room, 'p1');
    const p0Seen = view1.players.find(p => p.playerId === 'p0');
    check(p0Seen.cash === null && p0Seen.heat === null && p0Seen.inventoryCount === null, 'p1 cannot see p0 cash/heat/inventory');
    check(typeof p0Seen.influence === 'number', 'influence stays public (scoreboard)');
    const selfSeen = view1.players.find(p => p.playerId === 'p1');
    check(typeof selfSeen.cash === 'number', 'self stats still visible');
    const publicReport = view1.lastRoundReport.map(e => e.text).join('\n');
    check(!publicReport.includes(itemName), `public market report does not name the item bought (${itemName})`);
    const view0 = engine.buildClientState(room, 'p0');
    check(view0.lastRoundReport.some(e => e.private && e.text.includes(itemName)), 'buyer gets a private note naming the item');
    check(!view1.lastRoundReport.some(e => e.private), 'others get no private entries of p0');

    // intel reveals hidden info to the actor
    toAction(room);
    engine.submitAction(room, 'p1', 'intel', 'p0');
    ['p0', 'p2', 'p3'].forEach(id => engine.submitAction(room, id, 'pass'));
    const note = getNote(room, 'p1');
    check(note && note.includes('💵'), 'intel note reveals target cash');
}

function getNote(room, playerId) {
    const player = room.gameState.players.find(p => p.playerId === playerId);
    return player.intelNotes[0]?.text || null;
}

console.log('bug 1: public report is role-neutral');
{
    // mole intel + doubleAgent betray + boss delivery
    const room = makeRoom(6);
    engine.startGame(room);
    setRoles(room, ['mole', 'doubleAgent', 'broker', 'boss', 'smuggler', 'fixer']);
    const players = room.gameState.players;
    players[3].inventory = ['crate'];
    players[4].inventory = ['crate', 'ledger'];
    toAction(room);
    engine.submitAction(room, 'p0', 'intel', 'p1');
    engine.submitAction(room, 'p1', 'betray', 'p2');
    engine.submitAction(room, 'p2', 'deal', 'p1');
    engine.submitAction(room, 'p3', 'deliver', null, 'crate');
    engine.submitAction(room, 'p4', 'deliver', null, 'crate');
    engine.submitAction(room, 'p5', 'laylow');
    const text = publicText(room);
    check(!text.includes('🕶️'), 'no mole icon in public feed');
    check(!text.includes('สองหน้า'), 'no double-agent bonus text in public feed');
    check(!text.includes('พ่วง'), 'no smuggler extra-cargo text in public feed');
    check(!/รับ 👑 3/.test(text), 'no boss-boosted influence in public feed');
    check(!/ล้าง 🔥 ได้ 2/.test(text), 'no fixer laylow amount in public feed');
    const feedIcons = engine.buildClientState(room, 'p2').history.map(e => e.iconId);
    const roleIds = Object.keys(engine.ROLE_DEFINITIONS);
    check(!feedIcons.some(id => roleIds.includes(id)), 'feed icons never map to role images');
    const bossView = engine.buildClientState(room, 'p3');
    check(bossView.lastRoundReport.some(e => e.private && e.text.includes('โบนัสเจ้าพ่อ')), 'boss sees own bonus privately');
    // role bonus points must not show up on the public scoreboard (score jumps would reveal the role)
    const bossTrue = players[3].influence;
    const smugglerTrue = players[4].influence;
    const otherView = engine.buildClientState(room, 'p2');
    const bossSeen = otherView.players.find(p => p.playerId === 'p3').influence;
    const smugglerSeen = otherView.players.find(p => p.playerId === 'p4').influence;
    const plainCrate = engine.ITEM_DEFINITIONS ? (engine.ITEM_DEFINITIONS.crate?.influence || 0) : null;
    check(bossSeen < bossTrue, `boss bonus hidden from others (seen ${bossSeen}, true ${bossTrue})`);
    if (plainCrate !== null) check(bossSeen === plainCrate, 'others see only the plain crate value for the boss');
    check(smugglerSeen < smugglerTrue, `smuggler extra cargo hidden from others (seen ${smugglerSeen}, true ${smugglerTrue})`);
    check(bossView.self.influence === bossTrue, 'boss sees own true influence');
    room.gameState.phase = 'finished';
    const endView = engine.buildClientState(room, 'p2');
    check(endView.players.find(p => p.playerId === 'p3').influence === bossTrue, 'true influence revealed at game end');
}
{
    // fixer escape + doubleAgent raid
    const room = makeRoom(4);
    engine.startGame(room);
    setRoles(room, ['hitman', 'fixer', 'doubleAgent', 'broker']);
    const players = room.gameState.players;
    players[0].inventory = ['gun'];
    players[0].cash = 5;
    players[3].cash = 5;
    toAction(room);
    engine.submitAction(room, 'p0', 'hit', 'p1');
    engine.submitAction(room, 'p1', 'pass');
    engine.submitAction(room, 'p2', 'raid', 'p3');
    engine.submitAction(room, 'p3', 'pass');
    const text = publicText(room);
    check(players[1].alive, 'fixer escaped the hit');
    check(!text.includes('สายเคลียร์') && !text.includes('คนเคลียร์ทาง'), 'fixer escape reason not public');
    check(!/ไป 3 ก้อน/.test(text) && !text.includes('💵 3'), 'double-agent raid amount not public');
    const fixerView = engine.buildClientState(room, 'p1');
    check(fixerView.lastRoundReport.some(e => e.private && e.text.includes('คนเคลียร์ทาง')), 'fixer learns privately why they survived');
}

console.log('bug 5: delivery of cargo stolen the same round is reported');
{
    const room = makeRoom(4);
    engine.startGame(room);
    setRoles(room, ['broker', 'mole', 'hitman', 'fixer']);
    const players = room.gameState.players;
    players[0].cash = 0;
    players[0].inventory = ['crate'];
    toAction(room);
    engine.submitAction(room, 'p0', 'deliver', null, 'crate');
    engine.submitAction(room, 'p1', 'raid', 'p0');
    engine.submitAction(room, 'p2', 'pass');
    engine.submitAction(room, 'p3', 'pass');
    check(players[1].inventory.includes('crate'), 'raider stole the crate');
    check(players[0].influence === 0, 'victim gained no influence');
    check(players[0].lastMove === 'ส่งของไม่สำเร็จ', 'victim lastMove records the failure');
    const victimView = engine.buildClientState(room, 'p0');
    check(victimView.lastRoundReport.some(e => e.private && e.text.includes('ไม่สำเร็จ')), 'victim gets a private failure note');
    check(room.gameState.lastRoundReport.some(e => e.text.includes('ส่งของไม่สำเร็จ')), 'neutral public failure line');
}

console.log('bug 8: full tie is a shared win');
{
    const room = makeRoom(4);
    engine.startGame(room);
    const players = room.gameState.players;
    players.forEach(p => { p.influence = 1; p.cash = 1; p.heat = 1; });
    players[0].influence = 5; players[0].cash = 3; players[0].heat = 0;
    players[1].influence = 5; players[1].cash = 3; players[1].heat = 0;
    room.gameState.roundNumber = room.gameState.maxRounds;
    toAction(room);
    players.forEach(p => engine.submitAction(room, p.playerId, 'pass'));
    const winner = room.gameState.winner;
    check(room.gameState.phase === 'finished', 'game finished');
    check(winner && winner.shared === true, 'winner marked shared');
    check(winner && winner.playerIds.length === 2 && winner.playerIds.includes('p0') && winner.playerIds.includes('p1'), 'both tied leaders are winners');

    const room2 = makeRoom(4);
    engine.startGame(room2);
    room2.gameState.players.forEach((p, i) => { p.influence = i; });
    room2.gameState.roundNumber = room2.gameState.maxRounds;
    toAction(room2);
    room2.gameState.players.forEach(p => engine.submitAction(room2, p.playerId, 'pass'));
    check(room2.gameState.winner.shared === false && room2.gameState.winner.playerIds.length === 1, 'clear winner is not shared');
}

console.log('bug 6: resolveIfAllCommitted after disconnect');
{
    const room = makeRoom(4);
    engine.startGame(room);
    toAction(room);
    ['p0', 'p1', 'p2'].forEach(id => engine.submitAction(room, id, 'pass'));
    check(room.gameState.phase === 'action', 'still waiting for p3');
    room.players[3].socketId = null;
    const result = engine.resolveIfAllCommitted(room);
    check(result.resolved && room.gameState.phase !== 'action', 'phase advances once the only uncommitted player disconnects');
}

if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log('\nall black market engine checks passed');
