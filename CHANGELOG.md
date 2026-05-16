# Changelog

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
