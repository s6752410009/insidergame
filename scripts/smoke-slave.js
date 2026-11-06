require('./isolateTestData');
const assert=require('node:assert/strict');
const E=require('../games/slaveEngine');
let checks=0;
function ok(v,msg){assert.ok(v,msg);checks++;}
const room=()=>({roomId:'slave-test',admin:'bot_0',settings:{gameMode:'slave'},players:Array.from({length:4},(_,i)=>({playerId:'bot_'+i,playerName:'Seat '+i,socketId:'bot_socket_'+i}))});
function inventory(r){const s=r.gameState;return [...s.played,...s.seats.flatMap(p=>p.hand)];}
function invariant(r){const cards=inventory(r);ok(cards.length===52,'52 cards retained');ok(new Set(cards).size===52,'unique cards');}
ok(E.beats(E.combination([0,1,2]),E.combination([51])),'triple cuts highest single');
ok(E.beats(E.combination([0,1,2,3]),E.combination([50,51])),'four cuts highest pair');
ok(!E.beats(E.combination([48]),E.combination([0,1,2])),'single cannot beat triple');
ok(!E.combination([0,0]),'duplicate cards rejected');
ok(!E.combination([0,4]),'mixed ranks rejected');
ok(E.beats(E.combination([5,7]),E.combination([4,6])),'pair suit tiebreak');
/* Insert after existing basic engine assertions in scripts/smoke-slave.js. */
const G=require('../public/js/slaveGuide');
function guideFixture(hand, top=null, opening=false) {
 const r=room();E.startGame(r);
 const s=r.gameState;
 s.phase='turn';s.turnId='bot_0';s.firstPlay=opening;
 s.seats[0].hand=hand.slice();
 s.top=top?{...E.combination(top),playerId:'bot_1'}:null;
 return E.buildClientState(r,'bot_0');
}
function guideChoice(state, ids) { return G.analyze(state,new Set(ids)); }
function sameIds(actual, expected, label) {
 ok(JSON.stringify(actual.slice().sort((a,b)=>a-b))===JSON.stringify(expected.slice().sort((a,b)=>a-b)),label);
}
const openingGuide=guideFixture([0,1,2,3,4,5],null,true);
sameIds(guideChoice(openingGuide,[]).candidates,[0],'guide first opening starts at required 3 clubs');
const openingSingle=guideChoice(openingGuide,[0]);
ok(openingSingle.legal,'3 clubs alone is a legal opening');
sameIds(openingSingle.candidates,[0,1,2,3],'after required card, guide offers same-rank opening expansions');
const openingPartial=guideChoice(openingGuide,[1]);
ok(!openingPartial.legal,'3 diamonds without required 3 clubs is not ready');
sameIds(openingPartial.candidates,[0,1,2,3],'opening selection can be repaired by adding 3 clubs');
ok(!guideChoice(openingGuide,[4]).candidates.length,'unrelated opening rank has no compatible move');

const freshGuide=guideFixture([4,5,6,7,8,9]);
sameIds(guideChoice(freshGuide,[]).candidates,[4,5,6,7,8,9],'fresh pile makes every hand card available');
const singleGuide=guideChoice(freshGuide,[4]);
ok(singleGuide.legal,'fresh pile selection can be played as a single');
sameIds(singleGuide.candidates,[4,5,6,7],'fresh single offers same-rank expansions only');
const mixedGuide=guideChoice(freshGuide,[4,8]);
ok(!mixedGuide.legal&&mixedGuide.invalid&&!mixedGuide.candidates.length,'mixed-rank selection is invalid without invented suggestions');
const missingGuide=guideChoice(freshGuide,[51]);
ok(!missingGuide.legal&&missingGuide.invalid&&!missingGuide.candidates.length,'stale card selection is invalid');

const cutSingleGuide=guideFixture([4,5,6,7,48,51],[49]);
sameIds(guideChoice(cutSingleGuide,[]).candidates,[4,5,6,7,51],'single answer includes suit winner and lower triple cuts, excludes losing single');
const partialTriple=guideChoice(cutSingleGuide,[4,5]);
ok(!partialTriple.legal&&!partialTriple.invalid,'partial legal triple is incomplete, not invalid');
sameIds(partialTriple.candidates,[4,5,6,7],'partial triple offers compatible third cards only');
const fullTriple=guideChoice(cutSingleGuide,[4,5,6]);
ok(fullTriple.legal,'low triple is a valid cut against highest-rank single');
sameIds(fullTriple.candidates,[4,5,6],'complete triple cannot expand into illegal quad against a single');

const cutPairGuide=guideFixture([4,5,6,7,50,51],[48,49]);
const partialQuad=guideChoice(cutPairGuide,[4,5]);
ok(!partialQuad.legal&&!partialQuad.invalid,'losing pair may be completed into cutting quad');
sameIds(partialQuad.candidates,[4,5,6,7],'partial quad guides remaining same-rank cards');
ok(guideChoice(cutPairGuide,[4,5,6,7]).legal,'lowest quad cuts highest-rank pair');
ok(guideChoice(cutPairGuide,[50,51]).legal,'same-rank higher-suit pair remains valid');

const noMoveGuide=guideFixture([4,5,48,51],[8,9,10]);
const noMove=guideChoice(noMoveGuide,[]);
ok(!noMove.legal&&!noMove.candidates.length,'no legal move offers no highlighted cards');
ok(noMove.message.includes('ผ่าน'),'no legal move explains passing');

const invalid=room();invalid.players.pop();assert.throws(()=>E.startGame(invalid));
function botFixture(hand,top=null,opening=false) {
 const r=room();E.startGame(r);
 Object.assign(r.gameState,{phase:'turn',turnId:'bot_0',firstPlay:opening,
  top:top?{...E.combination(top),playerId:'bot_1'}:null});
 r.gameState.seats[0].hand=hand.slice();
 return r;
}
sameIds(E.chooseBotMove(botFixture([4,44,45,46]),'bot_0'),[4],'bot leads low single before a high triple');
sameIds(E.chooseBotMove(botFixture([4,5,44,45,46,47]),'bot_0'),[4,5],'bot keeps low pair together instead of leading high quad');
sameIds(E.chooseBotMove(botFixture([8,9,10,48],[4]),'bot_0'),[8],'bot uses low winning single before spending triple cut or 2');
sameIds(E.chooseBotMove(botFixture([8,9,10,11,12,13,48,49],[4,5]),'bot_0'),[8,9],'bot uses lowest winning pair before cutting with quad');
sameIds(E.chooseBotMove(botFixture([4,5,6,8,9,10],[51]),'bot_0'),[4,5,6],'bot uses cheapest triple when a cut is necessary');
sameIds(E.chooseBotMove(botFixture([4,5,6,7,8,9,10,11],[50,51]),'bot_0'),[4,5,6,7],'bot uses cheapest quad when a pair cut is necessary');
sameIds(E.chooseBotMove(botFixture([48,49,50],[4]),'bot_0'),[48,49,50],'bot spends high finishing set to go out immediately');
sameIds(E.chooseBotMove(botFixture([0,1,2,48,49,50,51],null,true),'bot_0'),[0,1,2],'bot opening includes 3 clubs and keeps the opening triple together');
sameIds(E.chooseBotMove(botFixture([45,47,48],[44]),'bot_0'),[45],'bot uses cheapest winning suit, not a 2');
ok(E.chooseBotMove(botFixture([4,5],[51]),'bot_0')===null,'bot passes when no legal response exists');
const privateBot=botFixture([4,5,44,45,46]);
const legalBefore=E.legalMoves(privateBot,'bot_0');
const choiceBefore=E.chooseBotMove(privateBot,'bot_0');
ok(JSON.stringify(E.legalMoves(privateBot,'bot_0'))===JSON.stringify(legalBefore),'bot strategy does not reorder client legal moves');
privateBot.gameState.seats.slice(1).forEach(p=>{p.hand=[48,49,50,51];});
sameIds(E.chooseBotMove(privateBot,'bot_0'),choiceBefore,'bot choice does not depend on private opponent cards');
const runtimeBot=botFixture([4,44,45,46]);
ok(E.playBotTurns(runtimeBot),'runtime plays a bot move');
sameIds(runtimeBot.gameState.played.slice(-1),[4],'runtime uses the low-first bot policy');
const sample=room();E.startGame(sample,()=>.5);const id=sample.gameState.turnId,p=sample.gameState.seats.find(p=>p.playerId===id);
const before=JSON.stringify(sample.gameState);
assert.throws(()=>E.playCards(sample,id,[0],-1));ok(before===JSON.stringify(sample.gameState),'stale command leaves state unchanged');
assert.throws(()=>E.passTurn(sample,id,sample.gameState.step));
assert.throws(()=>E.playCards(sample,id,[p.hand.find(c=>c!==0)],sample.gameState.step));
const viewer=E.buildClientState(sample,id),stranger=E.buildClientState(sample,'stranger');
ok(viewer.self.hand.length===13,'own cards visible');ok(stranger.self===null,'outsider has no hand');
ok(viewer.seats.every(p=>!('hand' in p)),'other hands absent');
E.playCards(sample,id,[0],sample.gameState.step);
const passer=sample.gameState.turnId;E.passTurn(sample,passer,sample.gameState.step);
ok(sample.gameState.passed.includes(passer),'pass recorded');
for(let game=0;game<300;game++){
 const r=room();E.startGame(r);invariant(r);
 for(let round=0;round<3;round++){
  let safety=0;
  while(r.gameState.phase!=='round-end'){
   ok(E.playBotTurns(r),'bot makes progress');invariant(r);
   ok(++safety<600,'round bounded');
   if(safety===10){const saved=JSON.parse(JSON.stringify(r));r.gameState=saved.gameState;}
  }
  const s=r.gameState;
  ok(new Set(s.finishOrder).size===4,'four unique rankings');
  ok(s.standings[0].title==='คิง'&&s.standings[3].title==='สลาฟ','titles');
  if(round<2){
   const old=s.standings.map(p=>p.playerId);
   E.nextRound(r,r.admin);ok(r.gameState.phase==='exchange','next round exchange');
   const original=new Map(r.gameState.seats.map(p=>[p.playerId,p.hand.slice()]));
   while(r.gameState.phase==='exchange'){ok(E.playBotTurns(r),'bot exchange');invariant(r);}
   ok(r.gameState.turnId===old[3],'slave leads next round');
   for(const [hi,lo,count] of [[0,3,2],[1,2,1]]){
    const h=r.gameState.seats.find(p=>p.playerId===old[hi]);
    ok(original.get(old[lo]).slice(-count).every(c=>h.hand.includes(c)),'highest tribute delivered');
   }
   ok(r.gameState.seats.every(p=>p.hand.length===13),'13 cards after exchange');
  }
 }
}
const timeout=room();E.startGame(timeout);timeout.gameState.phaseEndsAt=Date.now()-1;ok(E.autoResolvePhase(timeout),'timeout progresses');
E.handlePlayerLeft(timeout,timeout.players[0].playerId);ok(timeout.gameState.status==='slave_finished','leave ends safely');
console.log('Slave: '+checks+' assertions passed · 300 tables / 900 rounds · bots, exchange, privacy, stale commands, persistence, timeout, leave');
