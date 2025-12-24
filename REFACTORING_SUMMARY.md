# Insider Game - Multi-Room Refactoring Summary

## ✅ งานที่เสร็จสมบูรณ์

### 1. Player Identity System
- ✅ สร้าง `playerManager.js` - จัดการ playerId (UUID), playerName, color
- ✅ เก็บ playerId ใน cookie (1 year expiration)
- ✅ สุ่มชื่ออัตโนมัติ (guest + random number)
- ✅ เปลี่ยนชื่อและสีได้

### 2. Room Management System
- ✅ สร้าง `roomManager.js` - จัดการหลายห้องพร้อมกัน
- ✅ แต่ละห้องมี gameState แยกกัน
- ✅ รองรับ socket.join(roomId) สำหรับ isolation
- ✅ Admin management (เตะ, โอนสิทธิ, แก้ไขห้อง)

### 3. Statistics System
- ✅ สร้าง `statsManager.js` - บันทึกสถิติผู้เล่น
- ✅ บันทึกเมื่อเกมจบ (vote2Ended)
- ✅ เก็บ: totalGames, wins, losses, roleStats, winByRole
- ✅ ใช้ playerId เป็น key (ไม่หายเมื่อ refresh)

### 4. Views
- ✅ `lobby.ejs` - หน้าเมนูหลัก (เริ่มเกม, ตั้งค่า, โปรไฟล์)
- ✅ `roomList.ejs` - รายการห้อง (สร้าง, ค้นหา, refresh)
- ✅ `profile.ejs` - โปรไฟล์และสถิติ
- ✅ `board.ejs` - อัปเดตให้รองรับ multi-room + admin controls

### 5. Socket Events
- ✅ Room Management: createRoom, joinRoom, leaveRoom, kickPlayer, transferAdmin, updateRoom
- ✅ Game Events: ทุก event ทำงานกับ room.gameState แทน global game
- ✅ Chat Notifications: ทุก action ส่งข้อความเข้าแชท

## 🎯 Game Logic Preservation

**สำคัญมาก:** Logic เกมเดิมยังคงทำงานเหมือนเดิมทุกอย่าง
- ✅ ฟังก์ชัน game logic ทั้งหมดถูก refactor ให้รับ gameState เป็น parameter
- ✅ Vote logic, role logic, countdown logic - ยังเหมือนเดิม
- ✅ ไม่มีการ rewrite logic ใหม่

## 📁 File Structure

```
├── app.js (refactored)
├── managers/
│   ├── playerManager.js (NEW)
│   ├── roomManager.js (NEW)
│   └── statsManager.js (NEW)
├── views/
│   ├── lobby.ejs (NEW)
│   ├── roomList.ejs (NEW)
│   ├── profile.ejs (NEW)
│   └── board.ejs (UPDATED)
└── data/
    └── playerStats.json (auto-generated)
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

### Flow
1. Player เข้า Lobby → สร้าง/โหลด playerId จาก cookie
2. กด "เริ่มเกม" → ไปหน้า Room List
3. สร้าง/เข้าร่วมห้อง → socket.join(roomId)
4. เริ่มเกม → ใช้ room.gameState แทน global game
5. เกมจบ → บันทึกสถิติ → กลับไปห้องเดิม

## ⚠️ Important Notes

1. **Player Identity**: playerId ถูกเก็บใน cookie, ไม่หายเมื่อ refresh
2. **Room Isolation**: แต่ละห้องแยก gameState ชัดเจน
3. **Admin Transfer**: เมื่อ admin ออก → โอนให้ผู้เล่นคนแรกอัตโนมัติ
4. **Statistics**: บันทึกเมื่อ vote2Ended, ใช้ playerId เป็น key
5. **Backward Compatibility**: Legacy routes (/game, /adminPlayer) redirect ไป /lobby

## 🚀 Next Steps (Optional)

- [ ] เพิ่มระบบแบนผู้เล่น
- [ ] เพิ่ม persistent storage (database) สำหรับ rooms/stats
- [ ] เพิ่มระบบ reconnection ที่ดีขึ้น
- [ ] เพิ่ม unit tests
