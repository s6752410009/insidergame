# ย้าย insider-th.me จาก Render → Coolify

Coolify: http://212.85.24.89:8000 · repo: `s6752410009/insidergame` (branch `main`) · DNS: Namecheap

> ⚠️ รันได้ **1 container เท่านั้น** — ห้องเกมอยู่ในหน่วยความจำ ห้ามตั้ง replicas > 1 / ห้ามเปิด Render กับ Coolify ให้คนเล่นพร้อมกันนานๆ (สองเครื่องเขียน Mongo ก้อนเดียวกัน)

## 1. สร้างแอปใน Coolify
1. **Projects → + New → Production → + New Resource → Private Repository (with GitHub App)**
   - ยังไม่เคยต่อ GitHub: ทำ **Sources → + Add → GitHub App** ก่อน แล้วให้สิทธิ์เฉพาะ repo `insidergame`
2. เลือก repo `s6752410009/insidergame` · branch `main`
3. **Build Pack: `Dockerfile`** (repo มี `Dockerfile` แล้ว)
4. **Ports Exposes: `3000`**
5. **General → Replicas: 1** (ค่าเริ่ม)

## 2. ค่าที่ต้องใส่ (Environment Variables)
คัดลอกค่าจาก Render → service → Environment มาใส่ใน Coolify → แอป → **Environment Variables**

| ชื่อ | ค่า |
|---|---|
| `MONGO_URL` | เหมือนบน Render |
| `SESSION_SECRET` | เหมือนบน Render (ถ้าเปลี่ยน ทุกคนต้องเข้าระบบใหม่) |
| `GOOGLE_CLIENT_ID` | เหมือนบน Render |
| `PUBLIC_BASE_URL` | `https://insider-th.me` |
| `NODE_ENV` | `production` |

ค่าอื่นที่ Render มี (ถ้ามี) คัดลอกมาด้วยทั้งหมด · `PORT` และ `GAME_DATA_DIR=/data` ตั้งใน Dockerfile แล้ว ไม่ต้องใส่

เปิด **"Include Source Commit in Build"** (ถ้ามีตัวเลือกนี้) — เลข build บนเว็บจะตรงกับ commit

## 3. ที่เก็บไฟล์ถาวร (Persistent Storage)
แอป → **Storages → + Add → Volume** · Destination path: **`/data`**
(ตั้งค่าเกมจากหลังบ้าน, log สำรอง ฯลฯ อยู่ตรงนี้ — ไม่หายตอน deploy)

## 4. MongoDB
ถ้าใช้ **MongoDB Atlas**: Atlas → Network Access → **Add IP Address `212.85.24.89`**
(ถ้า Atlas ตั้ง 0.0.0.0/0 ไว้แล้ว ข้ามได้)

## 5. ทดสอบก่อนย้ายโดเมน
1. แอป → **Domains**: ใส่โดเมนทดสอบที่ Coolify สร้างให้ (เช่น `https://xxxx.212.85.24.89.sslip.io`) — ต้องเป็น **https** (คุกกี้ล็อกอินใช้ secure)
2. **Deploy** → ดู Logs ต้องเห็น `Server started on port 3000` และ healthcheck เขียว
3. เปิดโดเมนทดสอบ: เข้าเว็บ สร้างห้อง เพิ่มบอท เล่น 1 เกม เปิด /admin
   (Google Login ใช้ไม่ได้บนโดเมนทดสอบ — ปกติ)

## 6. ย้ายโดเมน (cutover) — ทำตอนคนเล่นน้อย
1. Coolify → แอป → Domains: `https://insider-th.me,https://www.insider-th.me`
2. Namecheap → Domain List → insider-th.me → **Advanced DNS**
   - ลบ record เดิมที่ชี้ไป Render (`216.24.57.1` / `*.onrender.com`)
   - เพิ่ม **A Record** host `@` → `212.85.24.89` (TTL Automatic/5 min)
   - เพิ่ม **A Record** host `www` → `212.85.24.89`
3. รอ DNS (ส่วนใหญ่ 5–30 นาที) → Coolify ออกใบรับรอง HTTPS ให้เอง (Let's Encrypt) → Redeploy ถ้าใบรับรองยังไม่ขึ้น
4. เช็ก: https://insider-th.me/ping ตอบ 200 และ `curl -sI https://insider-th.me | grep -i server` ไม่ใช่ Render แล้ว
5. **ปิด Render**: Render → service → Settings → **Suspend** (และปิด Auto-Deploy) — ไม่ลบทิ้งจนกว่าจะมั่นใจ 1–2 วัน

## 7. หลังย้าย
- push ขึ้น `main` แล้ว Coolify deploy เอง (GitHub App webhook) — เหมือน Render เดิม
- ความปลอดภัย: หน้า Coolify ตอนนี้เป็น http ธรรมดาบน IP — แนะนำตั้งโดเมนให้แผง (เช่น `coolify.insider-th.me`) + HTTPS ใน Coolify Settings และปิดพอร์ต 8000 จากภายนอกด้วย firewall ของ VPS
- สำรองข้อมูล: ข้อมูลหลักอยู่ใน Mongo (Atlas มี backup ของมันเอง) · volume `/data` สำรองได้จาก Coolify Storages
