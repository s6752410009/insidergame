# Insider Game - Multi-Room Refactoring Summary

## ✅ งานที่เสร็จสมบูรณ์

### 1. Player Identity System
- ✅ สร้าง `playerManager.js` - จัดการ playerId (UUID), playerName, color
- ✅ เก็บ playerId ใน localStorage (persistent)
- ✅ สุ่มชื่ออัตโนมัติ (guest + random number)
- ✅ เปลี่ยนชื่อและสีได้
- ✅ playerId ถูกเพิ่มใน URL query string ทุกหน้า

### 2. Room Management System
- ✅ สร้าง `roomManager.js` - จัดการหลายห้องพร้อมกัน
- ✅ แต่ละห้องมี gameState แยกกัน
- ✅ รองรับ socket.join(roomId) สำหรับ isolation
- ✅ Admin management (เตะ, โอนสิทธิ, แก้ไขห้อง)
- ✅ Room Lobby - รอผู้เล่นก่อนเริ่มเกม

### 3. Statistics System
- ✅ สร้าง `statsManager.js` - บันทึกสถิติผู้เล่น
- ✅ บันทึกเมื่อเกมจบ (vote2Ended)
- ✅ เก็บ: totalGames, wins, losses, roleStats, winByRole
- ✅ ใช้ playerId เป็น key (ไม่หายเมื่อ refresh)
- ✅ Game History - เก็บประวัติเกม 20 เกมล่าสุดต่อผู้เล่น

### 4. Views
- ✅ `lobby.ejs` - หน้าเมนูหลัก (เริ่มเกม, ตั้งค่า, โปรไฟล์)
- ✅ `roomList.ejs` - รายการห้อง (สร้าง, ค้นหา, refresh)
- ✅ `roomLobby.ejs` - ห้องรอก่อนเริ่มเกม
- ✅ `profile.ejs` - โปรไฟล์, สถิติ, ประวัติเกมล่าสุด
- ✅ `board.ejs` - หน้าเกม รองรับ multi-room + admin controls
- ✅ `admin.ejs` - Admin Dashboard จัดการทุกอย่าง

### 5. Socket Events
- ✅ Room Management: createRoom, joinRoom, leaveRoom, kickPlayer, transferAdmin, updateRoom
- ✅ Game Events: ทุก event ทำงานกับ room.gameState แทน global game
- ✅ Chat Notifications: ทุก action ส่งข้อความเข้าแชท
- ✅ Admin Events: จัดการผู้เล่น, ห้อง, สถิติ, logs

### 6. Admin Dashboard
- ✅ ดูผู้เล่นทั้งหมดในระบบ
- ✅ ดูห้องทั้งหมดและจัดการ (ล้างห้องว่าง, ล้างทั้งหมด)
- ✅ ดูรายการแบนและจัดการ
- ✅ **สถิติผู้เล่น:**
  - ✅ ดูสถิติทุกคน (เกม, ชนะ, แพ้, Win%, บทบาท)
  - ✅ รีเซ็ตสถิติรายคน
  - ✅ ลบสถิติรายคน
  - ✅ เลือกหลายรายการแล้วลบ (Bulk Delete)
  - ✅ ลบสถิติทั้งหมด (Clear All)
  - ✅ Export CSV
- ✅ **Server Logs:**
  - ✅ ดู logs แบบ real-time
  - ✅ กรองตามประเภท (join, leave, game, admin, system, error)
  - ✅ ล้าง logs
  - ✅ Export logs
- ✅ ตั้งค่าเกมเริ่มต้น
- ✅ จัดการระบบ (รีสตาร์ท, ล้างข้อมูล)

### 7. Mobile UX Improvements
- ✅ **Swipe Gestures:**
  - ✅ ปัดขวา → เปิด Chat
  - ✅ ปัดซ้าย → เปิด Vote Panel (ถ้ากำลัง vote)
- ✅ **Haptic Feedback:**
  - ✅ สั่นเมื่อกดปุ่ม
  - ✅ สั่นเมื่อได้รับข้อความใหม่
  - ✅ สั่นเมื่อเริ่มเกม/จบเกม
  - ✅ สั่นเมื่อเวลาใกล้หมด
- ✅ รองรับ Touch Events บน Mobile

### 8. Security & Bug Fixes
- ✅ Admin Socket Authentication - ตรวจสอบสิทธิ์ทุก admin event
- ✅ XSS Prevention - escape HTML ทุกที่
- ✅ Admin Transfer Bug Fix
- ✅ Room Disappear Bug Fix
- ✅ Text Color Fix สำหรับ dark theme

## 🎯 Game Logic Preservation

**สำคัญมาก:** Logic เกมเดิมยังคงทำงานเหมือนเดิมทุกอย่าง
- ✅ ฟังก์ชัน game logic ทั้งหมดถูก refactor ให้รับ gameState เป็น parameter
- ✅ Vote logic, role logic, countdown logic - ยังเหมือนเดิม
- ✅ ไม่มีการ rewrite logic ใหม่

## 📁 File Structure

```
├── app.js (refactored)
├── managers/
│   ├── playerManager.js - จัดการผู้เล่น
│   ├── roomManager.js - จัดการห้อง
│   ├── statsManager.js - จัดการสถิติ + ประวัติเกม
│   └── database.js - Database abstraction
├── views/
│   ├── lobby.ejs - หน้าเมนูหลัก
│   ├── roomList.ejs - รายการห้อง
│   ├── roomLobby.ejs - ห้องรอ
│   ├── profile.ejs - โปรไฟล์ + สถิติ + ประวัติเกม
│   ├── board.ejs - หน้าเกม
│   ├── admin.ejs - Admin Dashboard
│   ├── adminLogin.ejs - หน้า Login Admin
│   └── settings.ejs - ตั้งค่า
├── public/
│   └── js/
│       ├── playerIdentity.js - จัดการ playerId ฝั่ง client
│       └── timer.js - จัดการ countdown
└── data/
    ├── players.json - ข้อมูลผู้เล่น
    ├── playerStats.json - สถิติผู้เล่น
    └── bannedPlayers.json - รายการแบน
```

## 🔧 Technical Details

### Room Structure
```javascript
{
  roomId: string,
  name: string,
  players: [{ playerId, playerName, color, socketId, permission }],
  admin: playerId,
  settings: { maxPlayers, roundTime, traitorOptional, locked, password },
  gameState: {
    players: [{ playerId, name, role, vote1, vote2, nbVote2, isGhost, permission }],
    word: string,
    countdown: interval,
    resultVote1: object,
    resultVote2: object,
    status: string,
    lastAction: timestamp
  }
}
```

### Player Stats Structure
```javascript
{
  playerId: string,
  playerName: string,
  totalGames: number,
  wins: number,
  losses: number,
  roleStats: { gameMasterCount, traitorCount, citizenCount },
  winByRole: { winAsTraitor, winAsCitizen },
  gameHistory: [{ date, roomName, role, result, word }], // 20 เกมล่าสุด
  lastPlayedAt: timestamp
}
```

### Flow
1. Player เข้า Lobby → สร้าง/โหลด playerId จาก localStorage
2. กด "เริ่มเกม" → ไปหน้า Room List
3. สร้าง/เข้าร่วมห้อง → ไป Room Lobby รอผู้เล่น
4. เริ่มเกม → ใช้ room.gameState
5. เกมจบ → บันทึกสถิติ + ประวัติเกม → กลับไป Room Lobby

## ⚠️ Important Notes

1. **Player Identity**: playerId ถูกเก็บใน localStorage + URL query string
2. **Room Isolation**: แต่ละห้องแยก gameState ชัดเจน
3. **Admin Transfer**: เมื่อ admin ออก → โอนให้ผู้เล่นคนแรกอัตโนมัติ
4. **Statistics**: บันทึกเมื่อ vote2Ended, เก็บประวัติ 20 เกมล่าสุด
5. **Server Logs**: Admin สามารถดู logs ทุกห้องแบบ real-time
6. **Mobile Support**: รองรับ swipe gestures และ haptic feedback

## 🌐 Deployment

- **Platform**: Railway
- **Domain**: insider-th.me (Namecheap - GitHub Education)
- **Database**: MongoDB via `MONGO_URL` or JSON file fallback in `data/`

## 📱 Browser Support

- ✅ Chrome (Desktop & Mobile)
- ✅ Safari (Desktop & Mobile)
- ✅ Firefox
- ✅ Edge
- ✅ PWA Support (installable)

## 🚀 Recent Updates (December 2024)

### v1.1.0
- ✅ Mobile UX: Swipe gestures + Haptic feedback
- ✅ Game History: ประวัติเกม 20 เกมล่าสุดในหน้า Profile
- ✅ Admin Game Log: Server-side logging (ย้ายจากหน้าเกมไป Admin)
- ✅ Admin Stats Management: Bulk delete, Clear all, Individual delete
- ✅ Custom Domain: insider-th.me
