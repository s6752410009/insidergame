#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function run() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insider-admin-inbox-'));
    const messagesFile = path.join(tempDir, 'adminMessages.json');
    process.env.ADMIN_MESSAGES_FILE = messagesFile;

    try {
        const inbox = require('../managers/adminMessageManager');
        const playerId = '11111111-1111-4111-8111-111111111111';
        await inbox.initAdminMessageManager();

        const sent = await inbox.appendMessage(playerId, 'Smoke Player', 'user', 'ช่วยตรวจห้องให้หน่อย');
        assert.strictEqual(sent.message.sender, 'user');
        assert.strictEqual(inbox.getUnreadAdminCount(), 1);
        assert.strictEqual(inbox.listThreads()[0].unreadForAdmin, 1);

        const adminOpened = await inbox.markRead(playerId, 'admin');
        assert.ok(adminOpened.messages[0].readAt, 'opening a thread must mark the player message as read');
        assert.strictEqual(inbox.getUnreadAdminCount(), 0);

        await inbox.appendMessage(playerId, 'Smoke Player', 'admin', 'รับเรื่องแล้วครับ');
        const beforePlayerOpened = inbox.getThread(playerId);
        assert.strictEqual(beforePlayerOpened.unreadForUser, 1);

        const playerOpened = await inbox.markRead(playerId, 'user');
        assert.strictEqual(playerOpened.unreadForUser, 0);
        assert.ok(playerOpened.messages[1].readAt, 'player opening the thread must mark the admin reply as read');

        const persisted = JSON.parse(fs.readFileSync(messagesFile, 'utf8'));
        assert.strictEqual(persisted[playerId].messages.length, 2);
        console.log('✅ Admin inbox smoke passed: offline persistence + read states + reply flow');
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

run().catch(error => {
    console.error('❌ Admin inbox smoke failed:', error);
    process.exitCode = 1;
});
