/**
 * Stage 1 — เก็บรูป Google (googlePicture) + useGooglePhoto
 *
 * ใช้ ID token ที่เซ็นด้วยกุญแจเทส (googleAuthTestKit) ผ่าน verifyGoogleIdToken ตัวจริง
 * แล้วเช็คว่า:
 *   - รูปมาจาก claim `picture` ที่ตรวจแล้วเท่านั้น, allow-list *.googleusercontent.com, บังคับ =s96-c
 *   - เก็บแยกจาก object ผู้เล่น (ไม่หลุดไปหน้าเว็บ) จนกว่าเจ้าของจะเปิด useGooglePhoto
 *   - ล็อกอินซ้ำ = รูปใหม่, ยกเลิกผูก = ลบรูป + ปิดใช้รูป, บอทไม่มีรูป
 *   - บันทึก/โหลดไฟล์แล้วค่าครบ และไม่เก็บ avatarImage (ค่าคำนวณ) ลงไฟล์
 *
 * รัน: node scripts/test-google-avatar.js
 */
require('./isolateTestData');
const { createKit, installJwksStub } = require('./googleAuthTestKit');
const kit = createKit();
process.env.GOOGLE_CLIENT_ID = kit.clientId;
installJwksStub(kit.jwks);

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

let passed = 0;
function check(condition, message) {
    if (!condition) throw new Error('FAIL: ' + message);
    passed += 1;
    console.log('  ok -', message);
}

async function rejects(promise, pattern, message) {
    try {
        await promise;
    } catch (error) {
        check(!pattern || pattern.test(error.message), `${message} (${error.message})`);
        return;
    }
    throw new Error('FAIL: expected rejection — ' + message);
}

(async () => {
    const googleAuth = require('../managers/googleAuth');
    const playerManager = require('../managers/playerManager');
    const { PLAYERS_FILE } = require('../managers/dataPaths');
    const PlayerAvatar = require('../public/js/playerAvatar');

    console.log('URL allow-list');
    const norm = PlayerAvatar.normalizeAvatarImageUrl;
    check(norm('https://lh3.googleusercontent.com/a/ACg8oc-x_Y=s400') === 'https://lh3.googleusercontent.com/a/ACg8oc-x_Y=s96-c', 'size suffix normalized to =s96-c');
    check(norm('https://lh3.googleusercontent.com/a/ABC') === 'https://lh3.googleusercontent.com/a/ABC=s96-c', 'missing suffix gets =s96-c');
    check(norm('http://lh3.googleusercontent.com/a/ABC') === null, 'http rejected');
    check(norm('https://evil.example/a/ABC') === null, 'other host rejected');
    check(norm('https://googleusercontent.com.evil.example/a') === null, 'look-alike host rejected');
    check(norm('https://lh3.googleusercontent.com:444/a/ABC') === null, 'custom port rejected');
    check(norm('https://lh3.googleusercontent.com/a/A"><script>') === null, 'quote/markup in path rejected');
    check(norm('javascript:alert(1)') === null, 'javascript: rejected');
    check(norm(42) === null && norm('') === null && norm(null) === null, 'non-strings rejected');

    console.log('verified ID token → picture');
    const sub = 'google-sub-' + randomUUID();
    const token = kit.signIdToken({ sub, email: 'tester@example.com', picture: 'https://lh3.googleusercontent.com/a/PIC_ONE=s400-c' });
    const verified = await googleAuth.verifyGoogleIdToken(token);
    check(verified.sub === sub && verified.email === 'tester@example.com', 'token verifies with stubbed JWKS');
    check(verified.picture === 'https://lh3.googleusercontent.com/a/PIC_ONE=s96-c', 'picture taken from verified claim and normalized');
    const badPic = await googleAuth.verifyGoogleIdToken(kit.signIdToken({ sub, picture: 'https://evil.example/x.png' }));
    check(badPic.picture === null, 'non-google picture claim dropped');
    const tampered = token.split('.');
    const forged = JSON.parse(Buffer.from(tampered[1], 'base64url').toString());
    forged.picture = 'https://lh3.googleusercontent.com/a/FORGED';
    tampered[1] = Buffer.from(JSON.stringify(forged)).toString('base64url');
    await rejects(googleAuth.verifyGoogleIdToken(tampered.join('.')), /ไม่ถูกต้อง/, 'tampered picture claim fails signature check');

    console.log('link / opt-in / refresh / unlink');
    const playerId = randomUUID();
    await playerManager.createOrGetPlayer(playerId);
    const fresh = playerManager.getPlayer(playerId);
    check(fresh.useGooglePhoto === false, 'new players default useGooglePhoto=false');

    await rejects(playerManager.setUseGooglePhoto(playerId, true), /ผูกบัญชี Google/, 'cannot enable before linking');

    await playerManager.linkGoogleAccount(playerId, verified.sub, verified.email, verified.picture);
    let player = playerManager.getPlayer(playerId);
    check(playerManager.getGooglePicture(playerId) === verified.picture, 'picture stored on link');
    check(!('googlePicture' in player) && !('avatarImage' in player), 'picture not on public player object while opted out');

    await playerManager.setUseGooglePhoto(playerId, true);
    player = playerManager.getPlayer(playerId);
    check(player.useGooglePhoto === true && player.avatarImage === verified.picture, 'opt-in exposes avatarImage');

    const stored = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'))[playerId];
    check(stored.googlePicture === verified.picture && stored.useGooglePhoto === true, 'file stores googlePicture + useGooglePhoto');
    check(!('avatarImage' in stored), 'derived avatarImage not persisted');

    const changed = await playerManager.refreshGoogleProfile(playerId, { email: 'tester@example.com', picture: 'https://lh5.googleusercontent.com/a/PIC_TWO=s50' });
    player = playerManager.getPlayer(playerId);
    check(changed === true && player.avatarImage === 'https://lh5.googleusercontent.com/a/PIC_TWO=s96-c', 're-sign-in refreshes picture');
    const unchanged = await playerManager.refreshGoogleProfile(playerId, { picture: 'https://lh5.googleusercontent.com/a/PIC_TWO=s96-c' });
    check(unchanged === false, 'same picture reports no change');

    await playerManager.refreshGoogleProfile(playerId, { picture: 'https://evil.example/a.png' });
    check(!playerManager.getPlayer(playerId).avatarImage && playerManager.getGooglePicture(playerId) === null, 'invalid refreshed picture clears image');
    await playerManager.refreshGoogleProfile(playerId, { picture: verified.picture });
    check(playerManager.getPlayer(playerId).avatarImage === verified.picture, 'valid picture comes back on next sign-in');

    await playerManager.setUseGooglePhoto(playerId, false);
    check(!('avatarImage' in playerManager.getPlayer(playerId)), 'opt-out removes avatarImage');
    await playerManager.setUseGooglePhoto(playerId, true);

    console.log('reload from file');
    delete require.cache[require.resolve('../managers/playerManager')];
    const reloaded = require('../managers/playerManager');
    const again = reloaded.getPlayer(playerId);
    check(again.useGooglePhoto === true && again.avatarImage === verified.picture, 'reload recomputes avatarImage');
    check(reloaded.getGooglePicture(playerId) === verified.picture, 'reload keeps googlePicture private');

    await reloaded.unlinkGoogleAccount(playerId);
    const unlinked = reloaded.getPlayer(playerId);
    check(reloaded.getGooglePicture(playerId) === null && unlinked.useGooglePhoto === false && !('avatarImage' in unlinked), 'unlink clears picture and opt-in');
    const afterUnlink = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'))[playerId];
    check(!afterUnlink.googlePicture && !afterUnlink.googleSub, 'unlink removes picture from file');

    console.log('missing picture + bots');
    const noPicId = randomUUID();
    await reloaded.createOrGetPlayer(noPicId);
    await reloaded.linkGoogleAccount(noPicId, 'sub-' + randomUUID(), 'np@example.com', null);
    await rejects(reloaded.setUseGooglePhoto(noPicId, true), /อีกครั้ง/, 'linked without picture cannot opt in (hint to sign in again)');
    await rejects(reloaded.setUseGooglePhoto('bot_' + randomUUID().slice(0, 8), true), /not found/i, 'bots cannot opt in');
    const botHtml = PlayerAvatar.render({ playerId: 'bot_x', avatar: '🤖', avatarImage: verified.picture });
    check(!botHtml.includes('<img'), 'renderer never shows an image for bots');

    console.log('renderer');
    const html = PlayerAvatar.render({ avatar: '🐱', avatarFrame: 'gold', avatarImage: verified.picture }, { size: 32 });
    check(html.includes('referrerpolicy="no-referrer"') && html.includes('loading="lazy"') && html.includes('width="32" height="32"'), 'img has no-referrer, lazy, fixed size');
    check(html.includes('pa-frame') && html.includes('pa-emoji') && html.includes('onerror='), 'frame + emoji fallback kept');
    const evil = PlayerAvatar.render({ avatar: '<b>', avatarImage: 'https://evil.example/x.png' });
    check(!evil.includes('<img') && evil.includes('&lt;b&gt;'), 'disallowed URL ignored and emoji escaped');

    console.log('public payloads (room + game state)');
    check(JSON.stringify(PlayerAvatar.avatarImageField({ playerId: 'x', avatarImage: verified.picture })) === JSON.stringify({ avatarImage: verified.picture }), 'avatarImageField passes allowed image');
    check(Object.keys(PlayerAvatar.avatarImageField({ playerId: 'bot_1', avatarImage: verified.picture })).length === 0, 'avatarImageField drops bots');
    check(Object.keys(PlayerAvatar.avatarImageField({ playerId: 'x' })).length === 0, 'avatarImageField omits key when no image');
    const roomManager = require('../managers/roomManager');
    const pm = require('../managers/playerManager'); // roomManager ใช้ตัวนี้ (cache ล่าสุด)
    const hostId = randomUUID();
    const photoId = randomUUID();
    await pm.createOrGetPlayer(hostId);
    await pm.createOrGetPlayer(photoId);
    await pm.linkGoogleAccount(photoId, 'sub-room-' + randomUUID(), 'room@example.com', verified.picture);
    await pm.setUseGooglePhoto(photoId, true);
    const room = roomManager.createRoom({ name: 'avatar test', gameMode: 'werewolf', maxPlayers: 8 }, hostId);
    roomManager.joinRoom(room.roomId, hostId, 'sock-host');
    roomManager.joinRoom(room.roomId, photoId, 'sock-photo');
    const live = roomManager.getRoom(room.roomId);
    const roomPhoto = live.players.find(p => p.playerId === photoId);
    const roomHost = live.players.find(p => p.playerId === hostId);
    const gamePhoto = live.gameState.players.find(p => p.playerId === photoId);
    check(roomPhoto.avatarImage === verified.picture, 'room player carries avatarImage when opted in');
    check(gamePhoto && gamePhoto.avatarImage === verified.picture, 'game-state player carries avatarImage');
    check(!('avatarImage' in roomHost), 'players without photo have no avatarImage key');
    await pm.setUseGooglePhoto(photoId, false);
    roomManager.syncPlayerProfile(photoId, { avatarImage: pm.getPlayer(photoId).avatarImage || null });
    check(!('avatarImage' in roomPhoto) && !('avatarImage' in gamePhoto), 'opt-out sync removes avatarImage from room + game state');

    console.log(`\nPASS test-google-avatar: ${passed} checks`);
    process.exit(0);
})().catch(error => {
    console.error(error);
    process.exit(1);
});
