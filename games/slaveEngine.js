const { randomInt } = require('node:crypto');
const MODE = 'slave';
const ranks = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const suits = ['♣','♦','♥','♠'];
const titles = ['คิง','ควีน','รองสลาฟ','สลาฟ'];
const isBotId = id => String(id).startsWith('bot_');
function describeCard(id) {
    if (!Number.isInteger(id) || id < 0 || id >= 52) return null;
    return { id, rank: ranks[Math.floor(id / 4)], suit: suits[id % 4], red: [1,2].includes(id % 4), label: ranks[Math.floor(id / 4)] + suits[id % 4] };
}
function createPlayerState(p) { return { playerId: p.playerId, name: p.playerName || p.name || 'ผู้เล่น', avatar: p.avatar || '👤', color: p.color }; }
function createInitialState() { return { mode: MODE, status: 'waiting', phase: 'lobby', players: [], seats: [], step: 0, round: 0, history: [] }; }
function resetRoomGame(room) { return { ...createInitialState(), players: room.players.map(createPlayerState) }; }
function state(room) { return room.gameState; }
function seat(room, id) { return state(room).seats.find(p => p.playerId === id); }
function requireMember(room, id) {
    const p = seat(room, id);
    if (!p || p.left || !room.players.some(e => e.playerId === id)) throw new Error('คุณไม่ได้อยู่ในโต๊ะนี้');
    return p;
}
function log(s, text) { s.history.push(text); s.history = s.history.slice(-20); }
function deadline(s) { s.step += 1; s.phaseEndsAt = Date.now() + (s.phase === 'exchange' ? 60000 : 30000); }
function combination(ids) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 4 || new Set(ids).size !== ids.length) return null;
    if (ids.some(id => !describeCard(id))) return null;
    const rank = Math.floor(ids[0] / 4);
    if (ids.some(id => Math.floor(id / 4) !== rank)) return null;
    return { count: ids.length, rank, high: Math.max(...ids), cards: ids.slice().sort((a,b) => a-b) };
}
function beats(next, top) {
    if (!next) return false;
    if (!top) return true;
    if (next.count === top.count) return next.high > top.high;
    return (next.count === 3 && top.count === 1) || (next.count === 4 && top.count === 2);
}
function active(s) { return s.seats.filter(p => !p.left && !s.finishOrder.includes(p.playerId)); }
function nextEligible(s, after) {
    const index = s.seats.findIndex(p => p.playerId === after);
    for (let n=1; n<=4; n++) {
        const p = s.seats[(index+n)%4];
        if (!p.left && !s.finishOrder.includes(p.playerId) && !s.passed.includes(p.playerId)) return p.playerId;
    }
    return null;
}
function closeRound(s) {
    const remaining = active(s);
    if (remaining.length > 1) return false;
    s.finishOrder.push(...remaining.map(p => p.playerId));
    s.finishOrder.push(...s.seats.filter(p => !s.finishOrder.includes(p.playerId)).map(p => p.playerId));
    s.standings = s.finishOrder.map((id,i) => ({ playerId:id, name:s.seats.find(p=>p.playerId===id).name, place:i+1, title:titles[i] }));
    s.seats.forEach(p => { p.title = titles[s.finishOrder.indexOf(p.playerId)]; });
    s.phase = 'round-end'; s.turnId = null; s.phaseEndsAt = null;
    log(s, 'จบรอบ · ' + s.standings.map(p=>p.name+' '+p.title).join(' · '));
    return true;
}
function advance(s, actorId) {
    if (closeRound(s)) return;
    const eligible = active(s).filter(p => !s.passed.includes(p.playerId) && p.playerId !== s.top?.playerId);
    if (!eligible.length) {
        const last = s.top?.playerId || actorId;
        s.top = null; s.passed = [];
        s.turnId = active(s).some(p=>p.playerId===last) ? last : nextEligible(s,last);
        log(s, 'ทุกคนผ่าน · เปิดกองใหม่');
    } else s.turnId = nextEligible(s, actorId);
    deadline(s);
}
function startRound(room, rng) {
    const s = state(room);
    const previous = s.standings;
    let deck = Array.from({length:52}, (_,i)=>i);
    for (let i=51;i>0;i--) {
        const j = rng ? Math.floor(rng()*(i+1)) : randomInt(i+1);
        [deck[i],deck[j]]=[deck[j],deck[i]];
    }
    s.seats.forEach((p,i) => { p.hand=deck.slice(i*13,i*13+13).sort((a,b)=>a-b); p.left=false; });
    Object.assign(s, { round:s.round+1, phase:'turn', status:'playing', top:null, passed:[], finishOrder:[], played:[], exchangeDone:[], exchanges:[], standings:null });
    if (previous) {
        s.exchanges = [[0,3,2],[1,2,1]].map(([hi,lo,count])=>({ from:previous[lo].playerId, to:previous[hi].playerId, count }));
        // Select returns from the original hands, then transfer simultaneously.
        s.phase='exchange'; s.openingId=previous[3].playerId; s.turnId=null;
        log(s,'รอบ '+s.round+' · คิงเลือกคืน 2 ใบ / ควีนเลือกคืน 1 ใบ');
    } else {
        s.turnId=s.seats.find(p=>p.hand.includes(0)).playerId;
        s.firstPlay=true;
        log(s,'รอบแรก · ผู้ถือ 3♣ เปิดกองโดยต้องมี 3♣');
    }
    deadline(s);
}
function startGame(room, rng) {
    const players=room.players.filter(p=>p.socketId || isBotId(p.playerId));
    if(players.length!==4) throw new Error('สลาฟต้องมี 4 คนพอดี เติมบอทให้ครบได้');
    room.gameState={...createInitialState(), players:players.map(createPlayerState), seats:players.map(p=>({...createPlayerState(p),hand:[]}))};
    startRound(room,rng);
}
function validateTurn(room,id,step) {
    const p=requireMember(room,id), s=state(room);
    if(s.phase!=='turn' || s.turnId!==id) throw new Error('ยังไม่ถึงตาคุณ');
    if(step!==s.step) throw new Error('ตาเปลี่ยนแล้ว กรุณาลองใหม่');
    return p;
}
function playCards(room,id,ids,step) {
    const p=validateTurn(room,id,step),s=state(room), c=combination(ids);
    if(!c || ids.some(card=>!p.hand.includes(card))) throw new Error('เลือกไพ่หน้าเดียวกัน 1–4 ใบจากมือคุณ');
    if(s.firstPlay && !ids.includes(0)) throw new Error('ตาแรกต้องมี 3♣');
    if(!beats(c,s.top)) throw new Error('ต้องลงไพ่ใหญ่กว่า หรือตองตัดเดี่ยว / โฟร์ตัดคู่');
    p.hand=p.hand.filter(card=>!ids.includes(card)); s.played.push(...ids); s.firstPlay=false;
    s.top={...c,playerId:id};
    log(s,p.name+' ลง '+ids.map(card=>describeCard(card).label).join(' '));
    if(!p.hand.length) { s.finishOrder.push(id); log(s,p.name+' หมดมืออันดับ '+s.finishOrder.length); }
    advance(s,id);
}
function passTurn(room,id,step) {
    const p=validateTurn(room,id,step),s=state(room);
    if(!s.top) throw new Error('เปิดกองใหม่ต้องลงไพ่');
    s.passed.push(id); log(s,p.name+' ผ่าน'); advance(s,id);
}
function exchangeCards(room,id,ids,step) {
    const p=requireMember(room,id),s=state(room);
    if(s.phase!=='exchange' || step!==s.step) throw new Error('สถานะแลกไพ่เปลี่ยนแล้ว');
    const ex=s.exchanges.find(e=>e.to===id);
    if(!ex || s.exchangeDone.includes(id)) throw new Error('คุณไม่ต้องเลือกไพ่แล้ว');
    if(!Array.isArray(ids)||ids.length!==ex.count||new Set(ids).size!==ids.length||ids.some(card=>!p.hand.includes(card))) throw new Error('เลือกไพ่คืน '+ex.count+' ใบจากมือเดิม');
    ex.returns=ids.slice(); s.exchangeDone.push(id);
    if(s.exchangeDone.length===2) {
        s.exchanges.forEach(e=>{
            const low=seat(room,e.from),high=seat(room,e.to), tribute=low.hand.slice(-e.count);
            low.hand=low.hand.filter(c=>!tribute.includes(c)).concat(e.returns).sort((a,b)=>a-b);
            high.hand=high.hand.filter(c=>!e.returns.includes(c)).concat(tribute).sort((a,b)=>a-b);
        });
        s.exchanges=[]; s.phase='turn'; s.turnId=s.openingId; s.firstPlay=false;
        log(s,'แลกไพ่ครบแล้ว · สลาฟเปิดกอง');
    }
    deadline(s);
}
function nextRound(room,id) {
    requireMember(room,id);
    if(room.admin!==id) throw new Error('หัวห้องเป็นคนเริ่มรอบใหม่');
    if(state(room).phase!=='round-end') throw new Error('รอบนี้ยังไม่จบ');
    if(state(room).seats.some(p=>p.left)) throw new Error('มีคนออกจากโต๊ะ กลับห้องรอเพื่อจัดผู้เล่นใหม่');
    startRound(room);
}
function legalMoves(room,id) {
    const s=state(room),p=seat(room,id);
    if(!p || s.phase!=='turn' || s.turnId!==id) return [];
    const moves=[];
    for(let rank=0;rank<13;rank++) {
        const group=p.hand.filter(c=>Math.floor(c/4)===rank);
        for(let mask=1;mask<(1<<group.length);mask++) {
            const ids=group.filter((_,i)=>mask&(1<<i));
            if((!s.firstPlay||ids.includes(0)) && beats(combination(ids),s.top)) moves.push(ids);
        }
    }
    return moves.sort((a,b)=> b.length-a.length || Math.max(...a)-Math.max(...b));
}
function autoAct(room,id) {
    const s=state(room);
    if(s.phase==='exchange') {
        const e=s.exchanges.find(e=>e.to===id&&!s.exchangeDone.includes(id));
        if(e) exchangeCards(room,id,seat(room,id).hand.slice(0,e.count),s.step);
    } else {
        const move=legalMoves(room,id)[0];
        if(move) playCards(room,id,move,s.step); else passTurn(room,id,s.step);
    }
}
function autoResolvePhase(room) {
    const s=state(room);
    if(s.status!=='playing' || !s.phaseEndsAt || Date.now()<s.phaseEndsAt) return false;
    const id=s.phase==='exchange' ? s.exchanges.find(e=>!s.exchangeDone.includes(e.to))?.to : s.turnId;
    if(id) autoAct(room,id);
    return !!id;
}
function botActor(room) {
    const s=state(room);
    if(s.phase==='exchange') return s.exchanges.find(e=>!s.exchangeDone.includes(e.to)&&isBotId(e.to))?.to;
    if(s.phase==='turn' && (isBotId(s.turnId)||seat(room,s.turnId)?.left)) return s.turnId;
    return null;
}
function playBotTurns(room) { const id=botActor(room); if(!id)return false; autoAct(room,id); return true; }
function handlePlayerLeft(room,id) {
    const p=seat(room,id); if(!p)return;
    p.left=true;
    const s=state(room);
    s.phase='finished'; s.status='slave_finished'; s.turnId=null; s.phaseEndsAt=null;
    log(s,p.name+' ออกจากห้อง · กลับห้องรอเพื่อจัดโต๊ะใหม่');
}
function buildClientState(room,id) {
    const s=state(room),p=seat(room,id),ex=s.exchanges?.find(e=>e.to===id);
    return {mode:MODE,roomId:room.roomId,status:s.status,phase:s.phase,round:s.round,step:s.step,turnId:s.turnId,phaseEndsAt:s.phaseEndsAt,
        isHost:room.admin===id,openingRequired:!!s.firstPlay,
        exchangeProgress:s.phase==='exchange'?{done:s.exchangeDone.length,total:2}:null,
        top:s.top?{playerId:s.top.playerId,cards:s.top.cards.map(describeCard)}:null,
        seats:s.seats.map(p=>({playerId:p.playerId,name:p.name,avatar:p.avatar,count:p.hand.length,isBot:isBotId(p.playerId),title:p.title||null,place:s.finishOrder?.indexOf(p.playerId)+1||null,passed:s.passed?.includes(p.playerId),online:!!room.players.find(e=>e.playerId===p.playerId)?.socketId})),
        self:p?{hand:p.hand.map(describeCard),exchangeCount:s.phase==='exchange'&&ex&&!s.exchangeDone.includes(id)?ex.count:0}:null,
        canPlay:s.phase==='turn'&&s.turnId===id,canPass:s.phase==='turn'&&s.turnId===id&&!!s.top,
        legalMoves:legalMoves(room,id),standings:s.standings||null,history:s.history};
}
module.exports={id:MODE,label:'สลาฟ',description:'ไพ่สลาฟ 4 คน · ลงไพ่ให้หมด ขึ้นเป็นคิง เติมบอทได้',minPlayers:4,maxPlayers:4,keepSeatOnLeave:true,
    createInitialState,createPlayerState,resetRoomGame,startGame,startRound,describeCard,combination,beats,playCards,passTurn,exchangeCards,nextRound,
    autoResolvePhase,playBotTurns,botNeedsTurn:room=>!!botActor(room),botDelay:()=>900,isBotId,handlePlayerLeft,buildClientState,legalMoves};
