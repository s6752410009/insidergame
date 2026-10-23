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
const invalid=room();invalid.players.pop();assert.throws(()=>E.startGame(invalid));
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
