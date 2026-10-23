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
 for(const width of [390,1280]){
  const c=await browser.newContext({viewport:{width,height:900}}),p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base+'/game/'+roomId+'?playerId='+id);await p.waitForSelector('#slHand .sl-card');await sleep(300);
  ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow '+width);
  await p.locator('#slSound').click();ok((await p.locator('#slSound').innerText()).includes('ปิด'),'sound off');
  await p.reload();await p.waitForSelector('#slHand .sl-card');ok((await p.locator('#slSound').innerText()).includes('ปิด'),'mute persists after reload');
  await p.screenshot({path:path.join(shots,'board-'+width+'.png'),fullPage:true});await c.close();
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
 console.log('Slave integration: '+checks+' checks passed · lobby, bots, 2 full rounds, exchange, authorization, responsive UI, reconnect/reload · screenshots '+shots);
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{host?.disconnect();other?.disconnect();await browser?.close();server?.kill('SIGTERM');});
