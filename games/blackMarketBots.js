/** Bot decisions consume the same private/public view as a human, never the room state. */
function pickBest(items, score, rng) {
    let best = null;
    let value = -Infinity;
    for (const item of items) {
        const next = score(item) + rng() * 0.15;
        if (next > value) { best = item; value = next; }
    }
    return best;
}
function aliveOthers(view) {
    return (view.players || []).filter(player => player.alive !== false && player.playerId !== view.self.playerId);
}
function choosePurchase(view, rng = Math.random) {
    const self = view.self || {};
    const role = view.playerRole?.id;
    const inventory = self.inventory || [];
    const has = id => inventory.some(item => item.id === id);
    const turns = Math.max(1, (view.maxRounds || 5) - view.roundNumber + 1);
    const cargo = inventory.filter(item => item.type === 'cargo').length;
    const capacity = turns * (role === 'smuggler' ? 2 : 1);
    const others = aliveOthers(view);
    const leading = others.every(player => self.influence > player.influence);
    const hitCost = role === 'hitman' ? 2 : 3;
    function value(item) {
        const price = Number(item.priceForPlayer ?? item.price) || 0;
        if (item.type === 'cargo') {
            if (cargo >= capacity) return -1;
            return 5 + (Number(item.influence) || 0) * 3 + (role === 'boss' ? 2 : 0) - price;
        }
        if (has(item.id)) return -1;
        if (item.id === 'passport') return self.heat >= 3 ? 5 + self.heat - price : -1;
        if (item.id === 'armor') return leading && self.influence > 0 ? 6 - price : -1;
        if (item.id === 'gun' && self.cash - price >= hitCost && self.heat <= 2) {
            return !leading || role === 'hitman' ? 5 - price : -1;
        }
        return -1;
    }
    const offers = (view.marketOffers || []).filter(item => item.affordable && value(item) > 0);
    return pickBest(offers, value, rng)?.id || view.passChoice || '__pass__';
}
function chooseAction(view, rng = Math.random) {
    const self = view.self || {};
    const targets = aliveOthers(view);
    const help = view.actionHelp || {};
    const role = view.playerRole?.id;
    const finalRound = view.roundNumber >= (view.maxRounds || 5);
    const leader = pickBest(targets, player => Number(player.influence) || 0, rng);
    const leading = targets.every(player => self.influence > player.influence);
    const hit = () => ({ actionType: 'hit', targetPlayerId: leader.playerId });
    // Heat 5 costs both money and influence every round; don't keep accumulating penalties.
    if (self.heat >= 5) return { actionType: 'laylow' };
    // Last chance to stop a visible leader; buying/delivering another point cannot always catch them.
    if (finalRound && leader && help.canHit && self.heat <= 2 && leader.influence > self.influence) return hit();
    const cargo = pickBest(help.cargoItems || [], item => Number(item.influence) || 0, rng);
    if (cargo) return { actionType: 'deliver', itemId: cargo.id };
    if (self.heat >= 4) return { actionType: 'laylow' };
    if (!leader || (finalRound && leading)) return { actionType: 'guard' };
    if (help.canHit && self.heat <= 2 && (role === 'hitman' || targets.length === 1 || leader.influence >= self.influence + 2)) return hit();
    // Pair seats using public IDs only: two empty-handed bots can actually complete a mutual deal.
    // This is a proposed partner, not knowledge of anyone else's locked action.
    const seats = [self, ...targets].sort((a, b) => a.playerId.localeCompare(b.playerId));
    const index = seats.findIndex(player => player.playerId === self.playerId);
    const partner = seats[index % 2 ? index - 1 : index + 1];
    if (partner && rng() < 0.7) return { actionType: 'deal', targetPlayerId: partner.playerId };
    if (self.heat > 0 && (leading || rng() < 0.4)) return { actionType: 'laylow' };
    return { actionType: 'raid', targetPlayerId: leader.playerId };
}
module.exports = { choosePurchase, chooseAction };
