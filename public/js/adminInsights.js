(() => {
    'use strict';
    const root = document.getElementById('adminInsights');
    if (!root) return;
    const $ = id => document.getElementById(id);
    const fields = { days:$('insightDays'), mode:$('insightMode'), playerId:$('insightPlayer'), kind:$('insightKind'), search:$('insightSearch') };
    const monthInput=$('insightMonth');
    const currentMonth=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'}).slice(0,7);
    monthInput.value=currentMonth;monthInput.max=currentMonth;
    const number = value => (Number(value) || 0).toLocaleString('th-TH');
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const date = value => { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleString('th-TH', { timeZone:'Asia/Bangkok', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : '—'; };
    const empty = message => '<p class="insights-empty">' + esc(message) + '</p>';
    const kinds = {start:'เริ่มเล่น',end:'เล่นจบ',join:'เข้าห้อง',leave:'ออกห้อง',admin:'แอดมิน',error:'ข้อผิดพลาด',detail:'ระหว่างเล่น',abort:'หยุดกลางเกม',system:'ระบบ',chat:'แชท'};
    const paths = {
        start:'<path d="m9 5 11 7-11 7z"/>', end:'<path d="m5 12 4 4L19 6"/><path d="M20 12v7H4V3h11"/>',
        users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>',
        join:'<path d="M13 4h7v16h-7M3 12h12m-4-4 4 4-4 4"/>', leave:'<path d="M10 4H3v16h7m1-8h10m-4-4 4 4-4 4"/>',
        error:'<path d="m12 3 10 18H2zM12 9v5m0 3v1"/>', test:'<path d="M9 3h6m-5 0v6L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3M8 14h8"/>',
        room:'<path d="m3 10 9-7 9 7v11H3zm6 11v-8h6v8"/>', more:'<path d="m9 5 7 7-7 7"/>',
        detail:'<circle cx="12" cy="12" r="8"/><path d="M12 8v5m0 3v1"/>', admin:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/>',
        user:'<circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>'
    };
    const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.detail) + '</svg>';
    const avatar = player => window.renderPlayerAvatar ? window.renderPlayerAvatar(player,{size:28,className:'insights-profile',title:player.playerName || ''}) : '<span class="insights-avatar" aria-hidden="true">👤</span>';
    let page = 1, response = null, controller = null, sequence = 0, timer;
    const params = new URLSearchParams(location.search);
    for (const [key, input] of Object.entries(fields)) {
        const urlKey = key === 'playerId' ? 'focusPlayer' : key;
        if (params.has(urlKey) && (input.tagName !== 'SELECT' || [...input.options].some(o => o.value === params.get(urlKey)))) input.value = params.get(urlKey);
    }
    // A mode in a copied URL is resolved against the server's actual mode list on first load.
    let requestedMode = params.get('mode') || 'all';
    if(['all','month'].includes(params.get('period'))) fields.days.value=params.get('period');
    if(/^20\d{2}-(0[1-9]|1[0-2])$/.test(params.get('month')||'')) monthInput.value=params.get('month');
    $('insightMonthWrap').hidden=fields.days.value!=='month';
    async function load(force=false) {
        clearTimeout(timer);
        controller?.abort(); controller = new AbortController();
        const seq = ++sequence;
        const query = new URLSearchParams({page:String(page)});
        for (const [key, input] of Object.entries(fields)) query.set(key, key === 'mode' && requestedMode !== 'all' ? requestedMode : input.value);
        if(['all','month'].includes(fields.days.value)){query.set('period',fields.days.value);if(fields.days.value==='month')query.set('month',monthInput.value);}
        if(force===true)query.set('fresh','1');
        root.setAttribute('aria-busy','true'); $('insightStatus').textContent = 'กำลังโหลดข้อมูล…'; $('insightError').hidden = true;
        try {
            const res = await fetch('/admin/api/insights?' + query, { credentials:'same-origin', cache:'no-store', signal:controller.signal });
            if (res.status === 401 || res.status === 403) throw new Error('เซสชันหมดอายุ กรุณากลับไปล็อกอินแอดมิน');
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'โหลดข้อมูลไม่สำเร็จ ลองรีเฟรชอีกครั้ง');
            if (seq !== sequence) return;
            response = data; page = data.activity.page; render(data);
            $('insightContent').hidden = false;
            $('insightStatus').textContent = 'อัปเดต ' + date(data.generatedAt);
            const url = new URLSearchParams();
            for (const [key, input] of Object.entries(fields)) if (input.value && input.value !== 'all' && !(key === 'days' && input.value === '7')) url.set(key === 'playerId' ? 'focusPlayer' : key,input.value);
            if(['all','month'].includes(fields.days.value)){url.delete('days');url.set('period',fields.days.value);if(fields.days.value==='month')url.set('month',monthInput.value);}
            history.replaceState(null,'',location.pathname + (url.size ? '?' + url : ''));
        } catch (error) {
            if (seq !== sequence || error.name === 'AbortError') return;
            $('insightContent').hidden = true; $('insightStatus').textContent = '';
            $('insightError').textContent = error instanceof TypeError ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองรีเฟรชอีกครั้ง' : error.message; $('insightError').hidden = false;
        } finally { if (seq === sequence) root.setAttribute('aria-busy','false'); }
    }
    function render(data) {
        const s = data.summary, live = data.live, coverage = data.coverage;
        const wantedMode = data.query.mode || 'all';
        fields.mode.innerHTML = '<option value="all">ทุกเกม</option>' + data.modes.map(m => '<option value="' + esc(m.mode) + '">' + esc(m.label) + '</option>').join('');
        fields.mode.value = wantedMode; requestedMode = 'all';
        if (![...fields.days.options].some(o => o.value === String(data.query.days))) { const option = new Option(number(data.query.days) + ' วัน',String(data.query.days)); fields.days.add(option); }
        fields.days.value = data.query.period || String(data.query.days);
        $('insightMonthWrap').hidden=fields.days.value!=='month';
        if(data.query.month)monthInput.value=data.query.month;
        $('insightChartTitle').textContent=data.query.period==='all'?'การเล่นแต่ละเดือน':data.query.period==='month'?new Date(data.query.month+'-01T00:00:00+07:00').toLocaleDateString('th-TH',{timeZone:'Asia/Bangkok',month:'long',year:'numeric'}):'การเล่นแต่ละวัน';
        $('insightLive').innerHTML = '<span>' + icon('users') + '<strong>' + number(live.humansInRooms) + '</strong> คน</span><span>' + icon('start') + '<strong>' + number(live.playingRooms) + '</strong> ห้องกำลังเล่น</span><span>' + icon('room') + '<strong>' + number(live.rooms) + '</strong> ห้อง</span>';
        const totals = [
            ['เริ่มเล่น',s.starts,'start','มีบอทเล่นด้วย ' + number(s.botStarts) + ' ครั้ง'],
            ['เล่นจบ',s.ends,'end','นับเมื่อจบเกมหรือจบรอบ ตามประเภทเกม · เล่นคนเดียว ' + number(s.soloEnds) + ' ครั้ง'],
            ['ผู้เล่น',s.uniqueHumans,'users','นับคนละ 1 ครั้งจากบัญชีที่มีประวัติ ไม่รวมบอท'],
            ['เข้าห้อง',s.joins,'join','ออกห้อง ' + number(s.leaves) + ' ครั้ง'],
            ['ข้อผิดพลาด',s.errors,'error','ข้อผิดพลาดที่ระบบบันทึกไว้'],
            ['เกมทดสอบ',s.testStarts,'test','ไม่นับรวมในเกมยอดนิยม']
        ];
        $('insightTotals').innerHTML = totals.map(([name,value,symbol,note]) => '<div title="' + esc(note) + '"><dt>' + icon(symbol) + esc(name) + '</dt><dd>' + number(value) + '</dd></div>').join('');
        const maxGame = Math.max(1,...data.games.map(g => g.starts));
        $('insightGames').innerHTML = data.games.length ? data.games.map((g,i) => '<button class="insights-game" type="button" data-mode="' + esc(g.mode) + '"' + (i >= 5 ? ' hidden' : '') + ' aria-label="ดูเกม ' + esc(g.label) + '" title="' + number(g.uniqueHumans) + ' คน · เล่นจบ ' + number(g.ends) + ' ครั้ง"><span class="insights-game-number">' + number(i+1) + '</span><span><span class="insights-game-name">' + esc(g.label) + '</span><span class="insights-track" aria-hidden="true"><span style="width:' + (100*g.starts/maxGame).toFixed(2) + '%"></span></span></span><span class="insights-game-count">' + number(g.starts) + '<small>เริ่มเล่น</small></span></button>').join('') + (data.games.length > 5 ? '<button type="button" class="insights-button" data-show-games>ดูเพิ่ม</button>' : '') : empty('ยังไม่มีการเล่น');
        const maxDaily = Math.max(1,...data.daily.flatMap(d => [d.starts,d.ends]));
        $('insightDailyAxis').innerHTML = '<span>' + number(maxDaily) + '</span><span>' + number(Math.round(maxDaily/2)) + '</span><span>0</span>';
        $('insightDaily').innerHTML = data.daily.map(d => {
            const label = d.label || new Date(d.date + 'T00:00:00+07:00').toLocaleDateString('th-TH',{timeZone:'Asia/Bangkok',day:'numeric',month:'short'});
            const description = label + ' · เริ่มเล่น ' + number(d.starts) + ' · เล่นจบ ' + number(d.ends);
            return '<div class="insights-daily-row" role="img" tabindex="0" aria-label="' + esc(description) + '" title="' + esc(description) + '"><span class="insights-day-values">' + number(d.starts) + ' / ' + number(d.ends) + '</span><span class="insights-day-plot" aria-hidden="true"><span style="height:' + (100*d.starts/maxDaily).toFixed(2) + '%"></span><span style="height:' + (100*d.ends/maxDaily).toFixed(2) + '%"></span></span><span class="insights-day-date">' + esc(label) + '</span></div>';
        }).join('');
        $('insightDaily').classList.toggle('insights-daily--line',data.daily.length>10);
        if(data.daily.length>10){
            const x=i=>12+i*616/Math.max(1,data.daily.length-1), y=n=>174-160*n/maxDaily;
            const path=key=>data.daily.map((d,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(d[key]).toFixed(1)).join(' ');
            $('insightDaily').innerHTML='<svg class="insights-trend" viewBox="0 0 640 188" preserveAspectRatio="none" role="img" aria-label="กราฟเริ่มเล่นและเล่นจบ"><path d="'+path('starts')+'" stroke="#f3cb70"/><path d="'+path('ends')+'" stroke="#92baf8"/>'+data.daily.map((d,i)=>'<g><title>'+esc((d.label||d.date)+' · เริ่มเล่น '+d.starts+' · เล่นจบ '+d.ends)+'</title><circle cx="'+x(i)+'" cy="'+y(d.starts)+'" r="3" fill="#f3cb70"/><circle cx="'+x(i)+'" cy="'+y(d.ends)+'" r="3" fill="#92baf8"/></g>').join('')+'</svg><div class="insights-trend-labels">'+data.daily.filter((d,i)=>i%Math.ceil(data.daily.length/5)===0||i===data.daily.length-1).map(d=>'<span>'+esc(d.label||String(Number(d.date.slice(-2))))+'</span>').join('')+'</div>'+data.daily.map(d=>'<span class="insights-daily-row insights-sr-only">'+esc(d.label||d.date)+' เริ่ม '+d.starts+' จบ '+d.ends+'</span>').join('');
        }
        const maxHour = Math.max(1,...data.hourly.map(h => h.uniqueHumans));
        const peak = data.hourly.reduce((best,h) => h.uniqueHumans > best.uniqueHumans ? h : best,{hour:0,uniqueHumans:0});
        $('insightPeak').textContent = peak.uniqueHumans ? 'สูงสุด ' + String(peak.hour).padStart(2,'0') + ':00 น.' : '—';
        $('insightHours').innerHTML = data.hourly.map(h => '<div class="insights-hour" role="img" tabindex="0" aria-label="' + h.hour + ':00 น. ' + number(h.uniqueHumans) + ' คน" title="' + h.hour + ':00 น. ' + number(h.uniqueHumans) + ' คน"><span class="insights-hour-bar" style="height:' + (100*h.uniqueHumans/maxHour).toFixed(2) + '%"></span>' + (h.hour%3===0 ? '<span class="insights-hour-label">' + String(h.hour).padStart(2,'0') + '</span>' : '') + '</div>').join('');
        $('insightPeople').innerHTML = data.people.length ? data.people.map((p,i) => '<button type="button" class="insights-person" data-player="' + esc(p.playerId) + '"' + (i >= 6 ? ' hidden' : '') + ' title="' + esc(p.playerId) + '">' + avatar(p) + '<span class="insights-person-name">' + esc(p.playerName || p.playerId) + '</span><small>' + number(p.events) + '</small></button>').join('') + (data.people.length > 6 ? '<button type="button" class="insights-button" data-show-people>ดูเพิ่ม</button>' : '') : empty('ยังไม่มีประวัติผู้เล่น');
        const a = data.activity;
        $('insightActivityMeta').textContent = number(a.total) + ' รายการ';
        $('insightActivity').innerHTML = a.rows.length ? a.rows.map((e,index) => {
            const person = e.players.find(p => !p.playerId.startsWith('bot_')) || e.players[0];
            const player = person ? avatar(person) + '<button class="insights-player-link" type="button" data-player="' + esc(person.playerId) + '" title="' + esc(person.playerId) + '">' + esc(person.playerName || person.playerId) + '</button>' + (e.players.length > 1 ? '<small>+' + number(e.players.length-1) + '</small>' : '') : e.recordedNames?.length ? '<span class="insights-recorded-name" title="ชื่อจากประวัติเดิม">' + esc(e.recordedNames.join(', ')) + '</span>' : '<span class="insights-muted">' + (['system','admin','error'].includes(e.kind) ? 'ระบบ' : '—') + '</span>';
            return '<li class="insights-event"><div class="insights-event-line"><time datetime="' + esc(e.timestamp) + '">' + esc(date(e.timestamp)) + '</time><div class="insights-event-user">' + player + '</div><span class="insights-event-mode" title="' + esc(e.roomName || e.roomId || '') + '">' + esc(e.modeLabel || '—') + '</span><span class="insights-event-kind insights-event-kind--' + esc(e.kind) + '">' + icon(e.kind) + esc(kinds[e.kind] || e.kind) + '</span><button type="button" class="insights-button insights-icon-button insights-expand" data-detail="' + index + '" aria-expanded="false" aria-controls="insightDetail' + index + '" aria-label="ดูรายละเอียดกิจกรรม">' + icon('more') + '</button></div><div id="insightDetail' + index + '" class="insights-detail-body" hidden><div class="insights-event-message">' + esc(e.message) + '</div><div>' + esc(e.roomName || e.roomId || '') + (e.bot ? ' · มีบอท' : '') + (e.debug ? ' · ทดสอบ' : '') + '</div><div class="insights-detail-players">' + e.players.map(p => '<button class="insights-player-link" type="button" data-player="' + esc(p.playerId) + '" title="' + esc(p.playerId) + '">' + esc(p.playerName || p.playerId) + '</button>').join('') + '</div></div></li>';
        }).join('') : empty('ไม่พบกิจกรรม');
        $('insightPage').textContent = number(a.page) + ' / ' + number(a.pages); $('insightPrev').disabled = a.page <= 1; $('insightNext').disabled = a.page >= a.pages; $('insightExport').disabled = !a.rows.length;
        $('insightClear').hidden = !fields.playerId.value && !fields.search.value && fields.kind.value === 'all';
        const sourceNote = coverage.persistent ? (coverage.recordedSince ? 'มีประวัติตั้งแต่ ' + date(coverage.recordedSince) + ' · ข้อมูลก่อนหน้านั้นไม่มีบันทึก' : 'ยังไม่มีประวัติ') : 'ประวัติย้อนหลังสูงสุด ' + number(coverage.retentionDays) + ' วัน';
        $('insightCoverage').textContent = sourceNote;
        $('insightScopeNote').textContent = data.query.period==='all'?'ทั้งหมด':data.query.period==='month'?new Date(data.query.month+'-01T00:00:00+07:00').toLocaleDateString('th-TH',{timeZone:'Asia/Bangkok',month:'short',year:'numeric'}):'ย้อนหลัง '+number(data.query.days)+' วัน';
        $('insightScopeNote').title = sourceNote;
        $('insightStatus').dataset.coverage = coverage.persistent?'archive':String(coverage.retentionDays);
    }
    function resetAndLoad() { page=1; load(); }
    $('insightFilters').addEventListener('submit', e => {e.preventDefault();resetAndLoad();});
    $('insightActivityFilters').addEventListener('submit', e => {e.preventDefault();resetAndLoad();});
    fields.days.addEventListener('change',()=>{$('insightMonthWrap').hidden=fields.days.value!=='month';resetAndLoad();});
    monthInput.addEventListener('change',()=>{if(monthInput.checkValidity()&&monthInput.value)resetAndLoad();}); fields.mode.addEventListener('change', () => {requestedMode='all';resetAndLoad();}); fields.kind.addEventListener('change', resetAndLoad);
    for (const input of [fields.playerId,fields.search]) input.addEventListener('input', () => { clearTimeout(timer); timer=setTimeout(resetAndLoad,300); });
    $('insightRefresh').addEventListener('click',()=>load(true));
    $('insightPrev').addEventListener('click', () => {page--;load();}); $('insightNext').addEventListener('click', () => {page++;load();});
    $('insightClear').addEventListener('click', () => {fields.playerId.value='';fields.search.value='';fields.kind.value='all';resetAndLoad();});
    root.addEventListener('click', e => {
        const more = e.target.closest('[data-show-games],[data-show-people]');
        if (more) { more.parentElement.querySelectorAll('[hidden]').forEach(item => { item.hidden=false; }); more.hidden=true; return; }
        const detail = e.target.closest('[data-detail]');
        if (detail) { const expanded=detail.getAttribute('aria-expanded') === 'true'; detail.setAttribute('aria-expanded',String(!expanded)); $(detail.getAttribute('aria-controls')).hidden=expanded; return; }
        const player=e.target.closest('[data-player]'), game=e.target.closest('[data-mode]');
        if (player) {fields.playerId.value=player.dataset.player;fields.search.value='';fields.kind.value='all';resetAndLoad();$('insightActivitySection').scrollIntoView({block:'start'});}
        else if (game) {fields.mode.value=game.dataset.mode;requestedMode='all';resetAndLoad();}
    });
    $('insightExport').addEventListener('click', () => {
        if (!response?.activity.rows.length) return;
        const cell = value => '"' + String(value ?? '').replace(/^[\s]*[=+@-]/, "'$&").replace(/"/g,'""') + '"';
        const rows=[['เวลาไทย','กิจกรรม','เกม','ห้อง','รหัสผู้เล่น','ข้อความ'],...response.activity.rows.map(e => [date(e.timestamp),kinds[e.kind] || e.kind,e.modeLabel,e.roomId,e.players.map(p => p.playerId).join(' | '),e.message])];
        const blob=new Blob(['\uFEFF'+rows.map(row => row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
        const url=URL.createObjectURL(blob), link=document.createElement('a');link.href=url;link.download='insider-activity-page-'+response.activity.page+'.csv';link.click();setTimeout(() => URL.revokeObjectURL(url),1000);
    });
    window.InsiderInsights = { refresh:load };
    load();
})();
