const assert = require('node:assert/strict');
const engine = require('../games/blackMarketEngine');
const bots = require('../games/blackMarketBots');
function rng(seed) { return () => { seed = Math.imul(1664525, seed) + 1013904223 | 0; return (seed >>> 0) / 4294967296; }; }
function view(overrides = {}) {
    return { phase: 'action', roundNumber: 2, maxRounds: 5, playerRole: { id: 'boss' },
        self: { playerId: 'bot_a', influence: 2, cash: 5, heat: 0, inventory: [] },
        players: [{ playerId: 'bot_a', alive: true, influence: 2 }, { playerId: 'bot_b', alive: true, influence: 4 }],
        actionHelp: { cargoItems: [], canHit: false }, marketOffers: [], ...overrides };
}
const cargo = [{ id: 'cashbag', type: 'cargo', influence: 1 }, { id: 'ledger', type: 'cargo', influence: 2 }];
assert.equal(bots.chooseAction(view({ actionHelp: { cargoItems: cargo } }), () => 0).itemId, 'ledger', 'deliver the more valuable cargo');
assert.equal(bots.chooseAction(view({ self: { playerId: 'bot_a', influence: 2, heat: 5 }, actionHelp: { cargoItems: cargo } }), () => 0).actionType, 'laylow', 'avoid repeated heat penalties');
assert.deepEqual(bots.chooseAction(view({ roundNumber: 5, actionHelp: { canHit: true, cargoItems: cargo } }), () => 0), { actionType: 'hit', targetPlayerId: 'bot_b' }, 'stop the visible leader on the final round');
assert.equal(bots.chooseAction(view({ roundNumber: 5, self: { playerId: 'bot_a', influence: 6, heat: 0 } }), () => 0).actionType, 'guard', 'protect a final-round lead');
const offers = [
    { id: 'gun', type: 'weapon', affordable: true, priceForPlayer: 3 },
    { id: 'ledger', type: 'cargo', influence: 2, affordable: true, priceForPlayer: 2 },
    { id: 'cashbag', type: 'cargo', influence: 1, affordable: true, priceForPlayer: 1 }
];
assert.equal(bots.choosePurchase(view({ marketOffers: offers }), () => 0), 'ledger', 'buy points rather than a random item');
assert.equal(bots.choosePurchase(view({ marketOffers: offers.map(item => ({ ...item, affordable: false })) }), () => 0), '__pass__', 'cannot buy unaffordable offers');
assert.equal(bots.choosePurchase(view({ roundNumber: 5, self: { playerId: 'bot_a', influence: 2, cash: 2, heat: 0, inventory: cargo }, marketOffers: offers }), () => 0), '__pass__', 'do not buy cargo there is no turn left to deliver');
const partner = bots.chooseAction(view(), () => 0);
const reverse = bots.chooseAction(view({ self: { playerId: 'bot_b', influence: 4, cash: 0, heat: 0, inventory: [] }, players: view().players }), () => 0);
assert.equal(partner.actionType, 'deal'); assert.equal(reverse.actionType, 'deal');
assert.equal(partner.targetPlayerId, 'bot_b'); assert.equal(reverse.targetPlayerId, 'bot_a');
let decisions = 0, blindChecks = 0;
const counts = {};
for (let seed = 1; seed <= 600; seed++) {
    const n = 4 + seed % 4;
    const players = Array.from({ length: n }, (_, i) => ({ playerId: `bot_${i}`, playerName: 'Test ' + i, socketId: `bot_${i}` }));
    const room = { roomId: 'strategy', players, settings: { gameMode: 'blackmarket' }, gameState: engine.createInitialState() };
    engine.startGame(room);
    const random = rng(seed);
    let phases = 0;
    while (room.gameState.phase !== 'finished') {
        assert(++phases <= 10, 'all bot games must finish in five rounds');
        const phase = room.gameState.phase;
        for (const player of room.gameState.players.filter(player => player.alive !== false)) {
            const state = engine.buildClientState(room, player.playerId);
            const choose = phase === 'market' ? bots.choosePurchase : bots.chooseAction;
            const choice = choose(state, random);
            // Hidden cards, role, money and heat of living opponents must not affect decisions.
            const masked = JSON.parse(JSON.stringify(room));
            for (const other of masked.gameState.players) {
                if (other.playerId === player.playerId || other.alive === false) continue;
                other.role = 'hitman'; other.roleInfo = engine.ROLE_DEFINITIONS.hitman;
                other.cash = 99; other.heat = 9; other.inventory = ['gun', 'armor'];
            }
            assert.deepEqual(choose(state, rng(seed)), choose(engine.buildClientState(masked, player.playerId), rng(seed)));
            blindChecks++;
            if (phase === 'market') engine.submitMarketPurchase(room, player.playerId, choice);
            else {
                counts[choice.actionType] = (counts[choice.actionType] || 0) + 1;
                engine.submitAction(room, player.playerId, choice.actionType, choice.targetPlayerId, choice.itemId);
            }
            decisions++;
        }
        for (const player of room.gameState.players) {
            assert(player.cash >= 0 && player.influence >= 0 && player.heat >= 0, 'nonnegative resources');
        }
    }
    assert(room.gameState.winner, 'finished game has a winner');
}
console.log(JSON.stringify({ passed: true, games: 600, decisions, blindChecks, actions: counts }));
