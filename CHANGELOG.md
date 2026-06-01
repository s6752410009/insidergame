# Changelog

## 5.1.0 — 2026-06-01

ยกเครื่องระบบการเล่นและ logic engine ใหม่ทุกเกม (Insider, Werewolf, Black Market, Spyfall) เน้นเสถียร เล่นจบไม่ค้าง รีจอยน์/รีโหลดกลางเกมกลับเข้าเฟสเดิมได้ถูกต้อง และ UI บอกชัดว่าตอนนี้ต้องทำอะไร

### Insider engine

- Resync ตอน reconnect/reload ให้ตรงเฟสจริง (ไม่ replay บทบาท/เปิดคำผิดเฟส) — แยกตาม `status` (`in_progress` / `vote2` / `end` / `word`)
- เพิ่ม `advanceInsiderToVote2` ใช้ร่วมกันทั้งปุ่มหยุดเวลาของแอดมินและกรณีหมดเวลาคุย เพื่อกันเกมค้างถ้าแอดมินหลุด
- เก็บ `countdownEndsAt` เพื่อคืนค่าเวลาที่เหลือตอน reconnect และเฉลยคำลับ (`word`) ในจอผลจบเกม
- ข้อความผลเกมเคารพเคส "ไม่มีจอมบงการ" (ghost round) และปรับคำให้ชัด (วง → ทุกคน)

### Werewolf engine

- กลางคืนหมดเวลา: เติมตาให้ครบทุกบท — `oracle` / `tracker` / `vigilante` / `hunter` ที่ AFK นับเป็น "ข้าม" (เดิมตกหล่นเสียตาเงียบ ๆ)
- จบเกมด้วยโหวตกลางวันไม่ขึ้นหัวข้อ "🌙 คืน N+1" อีกต่อไป เปลี่ยนเป็น "⚖️ ผลโหวตปิดเกม"
- แม่มดเปลี่ยน/ยกเลิกเป้าหมายในสกิลเดิมได้ (ปลดสถานะ `locked` ที่ขัดกับคำอธิบายและ server)
- แถบบทบาท (role strip) แสดงครบทุกบทที่ตั้งค่าได้ + เติมบทใหม่อัตโนมัติจาก catalog
- Oracle badge เปลี่ยนสีตามทีมของบทที่เห็น, เพิ่มฮินต์บท tracker/hunter/vigilante
- แชตหมาป่า replay ให้สมาชิกทีมหมาป่าได้ทุกเฟส (แก้ reconnect กลางวันแล้วแชตหาย)
- ปุ่ม night action ปลดล็อกทันทีหลัง ack สำเร็จ ไม่ค้างรอ state broadcast

### Black Market engine

- ลดความรกของบอร์ดสำหรับมือใหม่: ย้ายการ์ดลงมือขึ้นก่อนการ์ดไกด์, เริ่มที่ปุ่มหลักก่อน (ไม่กางแผนขั้นสูงอัตโนมัติ)
- เพิ่มปุ่มนำทาง "⬇️ ไปเลือกของเลย" เลื่อนไปเวทีหลักพร้อมไฮไลต์
- แสดงความคืบหน้าการล็อก (`buildLockProgress` → "ล็อกแล้ว X/Y คน") และอธิบายบทบาท (จุดเด่น + เป้าหมาย) ให้เข้าใจง่าย

### Spyfall engine

- เพิ่มตัวนับความคืบหน้าการโหวต (ลงคะแนนแล้ว X / Y คน)
- ไฮไลต์คนที่เราโหวตชัดเจน และตารางสรุปผลโหวตในจอจบเกม (ระบุสายลับ)

### เทส

- ปรับ `scripts/smoke-werewolf-balance.js` ให้ตรวจ invariant (จำนวนผู้เล่น/จำนวนหมาป่า/บทมาจาก pool) แทนการเทียบชุดบทบาทตายตัว ให้ตรงกับ base role plan ปัจจุบัน

## 4.1.0 — 2026-05-16

### บทบาทและสกิล

- เพิ่มและผูกระบบสกิลให้บทบาทหลายตัวใน **Werewolf engine**: Oracle (อ่านชื่อบทบาทพร้อมประวัติ), Tracker, Hunter, Cleric (พรคุ้มกัน), Vigilante และปรับคำอธิบายบทบาทเดิมให้สอดคล้องเกม
- ปรับ **แผนสุ่มบทบาธรรมดา (ROLE_PLANS)** สำหรับ 3–10 คน ให้มี Villager / Oracle / Tracker / Vigilante ตามจำนวนผู้เล่น
- ช่องตั้งค่าในล็อบบี้รองรับบทบาทใหม่ใน `CONFIGURABLE_ROLE_IDS`

### เกมหลักและเซิร์ฟเวอร์

- **เวลาเฟส**: แก้กรณี `phaseEndsAt` เลยเวลาแต่ไม่ resolve — ให้ `syncWerewolfPhaseTimer` เรียก `autoResolvePhase` ได้ทันที
- **รอบเช้า**: บันทึก `phaseTimerBufferMs` ช่วงประชุมเช้าแล้วผูกกับ `app.js` เพื่อให้รอบมี buffer หลังเล่าเรื่อง (รวมค่า `WEREWOLF_MORNING_RECAP_BUFFER_MS`)
- **ข้ามการโหวตกลางวัน**: ใช้เกณฑ์เสียงข้าม ≥ `floor(น้ำหนักรวม/2)+1` (เสียงข้างมากอย่างถูกต้อง)
- **nightActions / state เก่า**: `ensureActionMaps` เติม key ที่หายหลังอัปเกรดเกมใน memory
- **Socket**: `werewolf_clericBless` เรียก `submitClericBless` ใน engine
- เพิ่ม `console.debug` ช่วยไล่ timer / broadcast (ควรเห็นเฉพาะเมื่อเปิด debug log)

### บอร์ดและล็อบบี้

- หน้า **Werewolf board**: โหมดเลย์เอาต์แบบเดียวกันทั้งจอกว้าง (คอลัมน์กลางจำกัดความกว้าง, FAB แชต, overlay แชต) และปรับ shell fullscreen
- หน้ารายการห้อง / ล็อบบี้: ข้อความหรือ UI เล็กน้อยสอดคล้องบริบท Werewolf

### เทส

- อัปเดต `scripts/smoke-werewolf-flow.js` และ `scripts/smoke-werewolf-role-rules.js` ให้ครอบกติกาและเฟสใหม่
- Smoke flow: loop โหวตไล่หมาป่ารองรับห้องมีมากกว่า 1 หมาป่าแบบในแผนปัจจุบัน
- Smoke roles: key ผลทดสอบ Tracker vs Cleric (`trackerClericNoNightSkillMisread` / `trackerSeerShowsNightSkillUsed`)
