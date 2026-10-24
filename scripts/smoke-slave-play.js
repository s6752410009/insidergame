require('./isolateTestData');
const {spawn}=require('node:child_process'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {randomUUID}=require('node:crypto'),{io}=require('socket.io-client'),{chromium}=require('playwright');
const assert=require('node:assert/strict');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const root=path.join(__dirname,'..'),port=Number(process.env.SLAVE_TEST_PORT)||8487,base='http://127.0.0.1:'+port;
const shots=fs.mkdtempSync(path.join(os.tmpdir(),'slave-shots-'));
let server,browser,host,other,logs='',S,checks=0;
function ok(v,msg){assert.ok(v,msg);checks++;}
async function wait(fn,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await sleep(25);}throw new Error('Timeout '+label+'\n'+logs.slice(-1500));}
function ack(s,event,data){return new Promise((resolve,reject)=>{s.timeout(8000).emit(event,data,(err,res)=>err?reject(err):resolve(res));});}
async function client(id,onState){const s=io(base,{transports:['websocket'],forceNew:true});await wait(()=>s.connected,'connect');s.emit('initPlayer',id);if(onState)s.on('slaveState',onState);await sleep(200);return s;}
async function run(){
 server=spawn(process.execPath,['app.js'],{cwd:root,env:{...process.env,PORT:String(port),MONGO_URL:'',ALLOW_LEGACY_SOCKET_IDENTITY:'1',SLAVE_BOT_MS:'35'},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',c=>logs+=c);server.stderr.on('data',c=>logs+=c);
 await wait(()=>logs.includes('Server started on port '+port),'startup');
 browser=await chromium.launch();
 const id=randomUUID();host=await client(id,s=>{S=s;ok(s.seats.every(p=>p.hand===undefined),'hidden hands');});
 const created=await ack(host,'createRoom',{playerId:id,name:'สลาฟทดสอบ',gameMode:'slave',maxPlayers:4});ok(created.success,JSON.stringify(created));const roomId=created.roomId;
 host.emit('setRoom',{roomId,playerId:id});await sleep(200);
 other=await client(randomUUID());const rejected=await ack(other,'slave_addBots',{roomId,count:3});ok(!rejected.success,'outsider cannot add bots');
 ok((await ack(host,'slave_addBots',{roomId,count:3})).added===3,'add three bots');
 ok(!(await ack(host,'slave_addBots',{roomId,count:1})).success,'four-seat cap');
 // Mobile lobby must recognize the mode, show bot controls and start correctly.
 const ctx=await browser.newContext({viewport:{width:390,height:844}}),page=await ctx.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/room/'+roomId+'?playerId='+id);await page.waitForSelector('#btnSlaveBots');await sleep(700);
 ok(await page.locator('#btnSlaveRules').isVisible(),'slave guide visible');
 await page.screenshot({path:path.join(shots,'lobby-mobile.png'),fullPage:true});
 await ctx.close();host.emit('setRoom',{roomId,playerId:id});await sleep(200);
 ok((await ack(host,'startGameFromLobby',{roomId})).success,'start');await wait(()=>S?.phase==='turn','dealt');
 ok(S.seats.length===4,'four seats');ok(S.self.hand.length===13,'13 cards');
 ok(!(await ack(host,'slave_play',{roomId:'wrong',step:S.step,cardIds:[0]})).success,'room mismatch');
 ok(!(await ack(host,'slave_play',{roomId,step:-1,cardIds:[0]})).success,'stale rejected');
 for(const width of [320,390,1280]){
  const uiId=randomUUID(),uiHost=await client(uiId);
  const uiRoom=(await ack(uiHost,'createRoom',{playerId:uiId,name:'โต๊ะเสียง '+width,gameMode:'slave',maxPlayers:4})).roomId;
  uiHost.emit('setRoom',{roomId:uiRoom,playerId:uiId});await sleep(100);
  ok((await ack(uiHost,'slave_addBots',{roomId:uiRoom,count:3})).added===3,'UI table bots');
  ok((await ack(uiHost,'startGameFromLobby',{roomId:uiRoom})).success,'UI table start');
  const c=await browser.newContext({viewport:{width,height:900},reducedMotion:width===320?'reduce':'no-preference'}),p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
  // Measure actual PCM delivered to the speakers. A changed button label is not an audio test.
  await p.addInitScript(()=>{
   const connect=AudioNode.prototype.connect;
   window.audioOutput={peak:0,contexts:[],events:[]};
   AudioNode.prototype.connect=function(destination,...args){
    if(destination instanceof AudioDestinationNode){
     const analyser=this.context.createAnalyser();analyser.fftSize=2048;
     connect.call(this,analyser);connect.call(analyser,destination);
     window.audioOutput.contexts.push(this.context);
     const data=new Float32Array(analyser.fftSize);
     setInterval(()=>{analyser.getFloatTimeDomainData(data);let peak=0;for(const v of data)peak=Math.max(peak,Math.abs(v));window.audioOutput.peak=Math.max(window.audioOutput.peak,peak);},10);
     return destination;
    }
    return connect.call(this,destination,...args);
   };
   document.addEventListener('DOMContentLoaded',()=>{
    const cue=SlaveAudio.prototype.cue;
    SlaveAudio.prototype.cue=function(name){if(this.ready)window.audioOutput.events.push(name);return cue.call(this,name);};
   });
  });
  await p.goto(base+'/game/'+uiRoom+'?playerId='+uiId);await p.waitForSelector('#slHand .sl-card');await sleep(300);
  ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow '+width);
  ok(await p.locator('.sl-seat').count()===4,'four seats around table');
  ok(await p.locator('.sl-backs').count()===3,'three concealed opponent hands');
  if(width===390){
   await p.evaluate(()=>Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,5000))]));
   for(const viewport of [{width:375,height:667},{width:667,height:375},{width:568,height:320},{width:821,height:700}]){
    await p.setViewportSize(viewport);
    const clipped=await p.evaluate(()=>['#slStatus','#slHand .sl-card','#slPlay','#slPass','#slHint','#slClear'].flatMap(selector=>[...document.querySelectorAll(selector)]).filter(el=>el.getClientRects().length).map(el=>({label:el.id||el.dataset.card,rect:el.getBoundingClientRect().toJSON()})).filter(({rect:r})=>r.left< -1||r.right>innerWidth+1||r.top< -1||r.bottom>innerHeight+1));
    ok(!clipped.length,'real-server turn fits '+viewport.width+'x'+viewport.height+': '+JSON.stringify(clipped));
    await p.screenshot({path:path.join(shots,'real-'+viewport.width+'x'+viewport.height+'.png'),fullPage:false});
   }
   await p.setViewportSize({width,height:900});
  }
  await p.locator('#slSound').click();await sleep(800);
  ok(await p.locator('#slSound').getAttribute('aria-pressed')==='true','first sound click enables audio');
  ok(await p.evaluate(()=>audioOutput.peak>.015),'nonzero speaker PCM after first gesture '+width);
  ok(await p.evaluate(()=>audioOutput.contexts.some(c=>c.state==='running')),'audio context running');
  await sleep(700);await p.evaluate(()=>{audioOutput.peak=0;});await sleep(550);
  ok(await p.evaluate(()=>audioOutput.peak>.003),'background music produces sustained PCM');
  await p.locator('#slMusic').click();await sleep(900);
  await p.evaluate(()=>{audioOutput.peak=0;});await sleep(350);
  ok(await p.evaluate(()=>audioOutput.peak<.001),'music switch really silences background audio');
  // Human turn must remain playable and keep keyboard focus when selecting cards.
  await wait(async()=>{
   if(await p.locator('#slHint').isEnabled())return true;
   if(await p.locator('#slPass').isEnabled())await p.locator('#slPass').click();
   return false;
  },'human legal turn');
  const turnCues=await p.evaluate(()=>audioOutput.events.filter(e=>e==='turn').length);
  ok(turnCues>0,'turn received before gesture is audible after unlock');
  await p.locator('#slHint').click();await sleep(150);
  ok(await p.locator('#slPlay').isEnabled(),'hint selects a legal move');
  ok(await p.evaluate(()=>document.activeElement.id==='slHint'),'focus survives selection');
  ok(await p.evaluate(()=>audioOutput.peak>.005),'card selection produces audio');
  ok(await p.evaluate(()=>audioOutput.events.filter(e=>e==='turn').length)===turnCues,'selection does not replay turn cue');
  await p.evaluate(()=>{audioOutput.peak=0;});
  const before=await p.locator('#slHand .sl-card').count();
  await p.locator('#slPlay').click();await wait(async()=>await p.locator('#slHand .sl-card').count()<before,'played cards leave hand');
  await sleep(500);ok(await p.evaluate(()=>audioOutput.peak>.005),'played cards produce audio');
  ok(await p.evaluate(()=>audioOutput.events.includes('play')),'server play event has a cue');
  await p.locator('#slSound').click();await sleep(800);await p.evaluate(()=>{audioOutput.peak=0;});await sleep(200);
  ok(await p.locator('#slSound').getAttribute('aria-pressed')==='false','sound off');
  ok(await p.evaluate(()=>audioOutput.peak<.001),'master mute really silences audio');
  await p.evaluate(()=>{audioOutput.peak=0;});await p.locator('#slSound').click();await sleep(500);
  ok(await p.evaluate(()=>audioOutput.peak>.01),'unmute has an audible preview');
  await p.evaluate(()=>Promise.all(audioOutput.contexts.map(c=>c.suspend())));await sleep(100);
  await p.evaluate(()=>{audioOutput.peak=0;});await p.locator('#slSound').click();await sleep(500);
  ok(await p.evaluate(()=>audioOutput.peak>.01),'interrupted context resumes with audible preview');
  await p.locator('#slSound').click();
  await p.reload();await p.waitForSelector('#slHand .sl-card');await sleep(800);
  ok(await p.locator('#slSound').innerText()==='เสียง ปิด','mute persists after reload');
  ok(await p.locator('#slMusic').getAttribute('aria-pressed')==='false','music preference persists');
  await p.screenshot({path:path.join(shots,'board-'+width+'.png'),fullPage:true});await c.close();uiHost.disconnect();
 }
 host.emit('setRoom',{roomId,playerId:id});host.emit('slave_requestState',{roomId});await sleep(150);
 const end=Date.now()+120000;let rounds=0;
 while(Date.now()<end){
  if(S.phase==='round-end'){
   rounds++;ok(S.standings.length===4,'complete rankings');
   if(rounds===2)break;
   ok((await ack(host,'slave_nextRound',{roomId})).success,'next round');
  }else if(S.phase==='exchange'&&S.self.exchangeCount){
   const res=await ack(host,'slave_exchange',{roomId,step:S.step,cardIds:S.self.hand.slice(0,S.self.exchangeCount).map(c=>c.id)});ok(res.success,JSON.stringify(res));
  }else if(S.canPlay){
   const move=S.legalMoves[0],res=await ack(host,move?'slave_play':'slave_pass',{roomId,step:S.step,cardIds:move});ok(res.success,JSON.stringify(res));
  }
  await sleep(15);
 }
 ok(rounds===2,'human and three bots finish two rounds');
 ok(errors.length===0,'browser errors: '+errors.join(';'));
 console.log('Slave integration: '+checks+' checks passed · lobby, bots, 2 full rounds, exchange, authorization, 320/390/1280px UI, actual WebAudio PCM, music/master mute, selection/play cues, focus, reduced motion, reconnect/reload · screenshots '+shots);
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{host?.disconnect();other?.disconnect();await browser?.close();server?.kill('SIGTERM');});
