# Game assets — checklist & glossary

เอกสารกลางสำหรับรูปการ์ดเกม (Black Market, Werewolf, Spyfall) แทน emoji บนจอเล่น

---

## Checklist

### โครงสร้างร่วม

- [x] `public/js/gameIcon.js` — `renderGameIcon(meta, className)` ใช้ `image` ก่อน ไม่มีค่อย `icon` (emoji)
- [x] Static routes ใน `app.js`: `/assets` → `public/assets`, `/js` → `public/js`
- [x] รูปแบบไฟล์: SVG 120×120, พื้น `#1a2332`, สัญลักษณ์ทอง `#f5c86b`
- [x] `public/css/game-icons.css` ใน layout (+ board ยังมี size override เฉพาะจุด)

### Black Market (23 SVG)

- [x] `games/blackMarketEngine.js` — `image` บน role / item / action
- [x] `public/assets/games/blackmarket/*.svg`
- [x] `views/blackMarketBoard.ejs` — role, ตลาด, inventory, แอ็กชัน, feed ผ่าน `gameIcon` / `feedIconMeta`
- [x] History / deal / round report — ใช้ **emoji ขนาดเล็ก** (`inline: true`) ไม่ยืดการ์ด SVG เต็มแถว
- [x] การ์ดบทบาท / ตลาด / ของ — ยังใช้ SVG ใน panel หลัก (ขนาดจำกัดใน `.bm-role-icon`)

### Werewolf (15 SVG)

- [x] `games/werewolfEngine.js` — `image` + `icon` + `serializePublicRole`
- [x] `public/assets/games/werewolf/*.svg`
- [x] `views/werewolfBoard.ejs` — banner, strip, room summary, win grid

### Spyfall (20 SVG)

- [x] `games/spyfallEngine.js` — role + location `image`
- [x] `public/assets/games/spyfall/*.svg`
- [x] `views/spyfallBoard.ejs` — role panel, location pills, จบเกม
- [ ] สถานที่จาก admin (`extraLocations`) — ต้องใส่ `image` เองถ้าต้องการการ์ด

### คุณภาพ / อนาคต

- [x] รูป JPG จากเน็ต — `npm run assets:fetch` (Unsplash + Picsum fallback) → `public/assets/games/*/*.jpg`
- [ ] Insider board — ยังไม่ใน scope นี้
- [ ] Smoke test บน browser จริงหลัง deploy

---

## Glossary (ความคำกลาง)

| คำ | ความหมาย | ตัวอย่าง |
|----|----------|----------|
| **catalog** | นิยาม entity ใน engine (`ROLE_DEFINITIONS`, `ITEM_DEFINITIONS`, …) | `boss`, `gun`, `school` |
| **id** | คีย์หลักของ entity ใช้ตั้งชื่อไฟล์และ lookup | `doubleAgent`, `alphaWolf` |
| **image** | URL รูปการ์ดที่ client โหลด | `/assets/games/blackmarket/gun.svg` |
| **icon** | emoji fallback เมื่อไม่มี `image` หรือ feed เก่า | `🔫` |
| **meta** | object ที่ส่งเข้า `renderGameIcon`: `{ id, image, icon, alt }` | `{ image: '...', alt: 'ปืนเงียบ' }` |
| **renderGameIcon** | ฟังก์ชัน global ใน `gameIcon.js` คืน `<img>` หรือ `<span>` emoji | เรียกจาก board EJS |
| **serialize** | แปลง state ฝั่ง server → JSON ให้ client (`buildClientState`) | ต้องมี `image` ใน payload |
| **feed** | แถว log / history บนจอ (icon + ข้อความ) | Black Market `history`, Spyfall `pushHistory` |
| **asset base** | prefix path ต่อเกม | `/assets/games/werewolf` |
| **IMAGE helper** | ฟังก์ชันใน engine สร้าง path | `blackMarketImage(id)`, `werewolfRoleImage(id)`, `SPYFALL_IMAGE(id)` |

### โครงสร้างโฟลเดอร์

```
public/
  js/gameIcon.js
  assets/games/
    blackmarket/{id}.svg   # บท 7 + ของ 7 + แอ็กชัน 9
    werewolf/{id}.svg      # บท 15
    spyfall/{id}.svg       # spy, citizen + สถานที่ 18
```

### กฎตั้งชาไฟล์

- ชื่อไฟล์ = `id` ใน catalog (camelCase เหมือนเดิม)
- นามสกุล `.jpg` (ดึงด้วย `npm run assets:fetch` จาก `data/game-image-sources.json`)
- ห้ามเว้นวรรคหรืออักขระพิเศษในชื่อไฟล์

### การเพิ่ม entity ใหม่

1. เพิ่ม entry ใน `*_DEFINITIONS` พร้อม `image` + `icon`
2. วาง SVG ที่ `public/assets/games/{game}/{id}.svg`
3. ตรวจว่า `buildClientState` / `describe*` ส่ง `image` ออกไป
4. ใช้ `renderGameIcon` ใน board แทน `escapeHtml(role.icon)` ตรงๆ
5. อัปเดต checklist ในไฟล์นี้

### ลิขสิทธิ์รูป

- SVG ปัจจุบัน: vector สร้างใน repo ใช้ในโปรเจกต์ได้
- รูปจากเว็บ / AI ภายนอก: เก็บ license / prompt ไว้ใน commit หรือ `docs/` ก่อนแทนที่ไฟล์

---

## Sub-agent split (งานรอบนี้)

| Agent | Scope | ผลลัพธ์ |
|-------|--------|---------|
| Black Market | engine + 23 SVG + board | เสร็จ |
| Werewolf | engine + 15 SVG + board | เสร็จ |
| Spyfall | engine + 20 SVG + board | เสร็จ |
| Parent | docs, dedupe `app.js` static, CSS ร่วม (ถ้าทำ) | ไฟล์นี้ |

---

*อัปเดตล่าสุด: 2026-06-04*
