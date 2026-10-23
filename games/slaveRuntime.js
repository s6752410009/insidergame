const engine = require('./slaveEngine');
module.exports = getDeps => {
    const timers=new Map(), botAddInFlight=new Set();
    function clearTimers(id) { const t=timers.get(id); if(t){clearTimeout(t.bot);clearTimeout(t.phase);} timers.delete(id); }
    function schedule(room) {
        const s=room.gameState;
        if(timers.get(room.roomId)?.step === s.step)return;
        clearTimers(room.roomId);
        if(s.status!=='playing')return;
        const live=()=>getDeps().roomManager.getRoom(room.roomId);
        const t={step:s.step};
        if(engine.botNeedsTurn(room))t.bot=setTimeout(()=>{
            const r=live();if(!r||r.settings.gameMode!=='slave')return;
            try{if(engine.playBotTurns(r))emitRoomState(r);}catch(e){getDeps().reportGameError(r,'[slave] bot',e);}
        },Number(process.env.SLAVE_BOT_MS)||900);
        if(s.phaseEndsAt)t.phase=setTimeout(()=>{
            const r=live();if(!r||r.settings.gameMode!=='slave')return;
            try{engine.autoResolvePhase(r);emitRoomState(r);}catch(e){getDeps().reportGameError(r,'[slave] timeout',e);}
        },Math.max(20,s.phaseEndsAt-Date.now()+10));
        timers.set(room.roomId,t);
    }
    function emitState(room,targetSocketId=null,playerId=null) {
        const {io}=getDeps();
        if(targetSocketId&&playerId)io.to(targetSocketId).emit('slaveState',engine.buildClientState(room,playerId));
        else room.players.filter(p=>p.socketId&&!engine.isBotId(p.playerId)).forEach(p=>io.to(p.socketId).emit('slaveState',engine.buildClientState(room,p.playerId)));
        schedule(room);
    }
    function emitRoomState(room) {
        emitState(room);
        const {io,roomManager,buildRoomUpdatePayload}=getDeps();
        roomManager.schedulePersistRooms();
        io.to(room.roomId).emit('roomUpdate',buildRoomUpdatePayload(room));
    }
    function recover(room){if(room.gameState.status==='playing'){if(engine.autoResolvePhase(room))emitRoomState(room);else schedule(room);}}
    return {engine,botAddInFlight,clearTimers,emitState,emitRoomState,recover,scheduleBots:schedule,
        startGame:room=>{clearTimers(room.roomId);engine.startGame(room);},
        buildPayload:engine.buildClientState,
        handleLeft:(room,id)=>engine.handlePlayerLeft(room,id),
        forceResolve:room=>{room.gameState.phaseEndsAt=Date.now()-1;engine.autoResolvePhase(room);emitRoomState(room);}};
};
