# เช็กลิสต์ SEO สำหรับเจ้าของเว็บ (insider-th.me)

ย้ายโฮสต์จาก Render มา Coolify แล้ว แต่โดเมนยังเป็น `insider-th.me` เหมือนเดิม
ประวัติใน Google จึงอยู่ครบ ไม่ต้องย้ายอะไรใน Search Console ทำตามข้อด้านล่างหลัง deploy ครั้งนี้

## 1. ยืนยันเจ้าของเว็บใน Google Search Console

- [ ] เข้า https://search.google.com/search-console แล้วล็อกอินด้วยบัญชีที่ใช้ดูแลเว็บ
- [ ] เพิ่ม property แบบ **Domain** ใส่ `insider-th.me` (ไม่ต้องใส่ https://)
- [ ] เลือกยืนยันด้วย **DNS record** ระเบียน `google-site-verification=...` (TXT) มีใน DNS อยู่แล้ว กด **Verify** ได้เลย
  - ถ้ายืนยันไม่ผ่าน ให้เทียบค่าที่ Google ให้มากับระเบียน TXT ใน DNS ว่าตรงกัน แล้วรอ 5–30 นาทีค่อยลองใหม่
- [ ] ถ้าเคยมี property แบบ URL prefix (`https://insider-th.me/`) อยู่แล้ว ใช้ต่อได้เลย ไม่ต้องลบ

## 2. ส่ง sitemap

- [ ] เปิด https://insider-th.me/sitemap.xml ในเบราว์เซอร์ ต้องเห็นรายการ URL ประมาณ 28 อัน (หน้าแรก, /rooms, /how-to-play, /solo, /games/* ทุกเกม, /solo/* ทุกเกม)
- [ ] ใน Search Console เมนู **Sitemaps** ใส่ `sitemap.xml` แล้วกด **Submit**
- [ ] รอ 1–3 วัน สถานะควรเป็น **Success** และจำนวน "Discovered URLs" ตรงกับในไฟล์
- เพิ่มเกมใหม่แล้ว sitemap จะอัปเดตเอง ไม่ต้องส่งใหม่

## 3. ขอให้ Google index หน้าเกมหลักก่อน

ใช้ช่อง **URL Inspection** ด้านบนของ Search Console วาง URL ทีละอัน แล้วกด **Request indexing**
(Google ให้ขอได้ราววันละ 10 URL เริ่มจากเกมที่คนค้นเยอะ)

- [ ] https://insider-th.me/
- [ ] https://insider-th.me/games/werewolf
- [ ] https://insider-th.me/games/setthi
- [ ] https://insider-th.me/games/pokdeng
- [ ] https://insider-th.me/games/coup
- [ ] https://insider-th.me/games/codenames
- [ ] https://insider-th.me/games/avalon
- [ ] https://insider-th.me/games/spyfall
- [ ] https://insider-th.me/games/undercover
- [ ] https://insider-th.me/games/insider
- [ ] วันถัดไป: หน้าเกมที่เหลือ และ https://insider-th.me/how-to-play

## 4. ทดสอบ Rich Results (structured data)

- [ ] เปิด https://search.google.com/test/rich-results
- [ ] ทดสอบ https://insider-th.me/games/werewolf ต้องเจอ **Breadcrumbs** และ **FAQ** โดยไม่มี error สีแดง
  (VideoGame ไม่มีผลพิเศษใน Google แต่ schema ต้องอ่านได้ ดูได้ที่ https://validator.schema.org)
- [ ] ทดสอบหน้าแรก https://insider-th.me/ ต้องอ่านเจอ WebSite และ ItemList
- [ ] ถ้ามี warning สีเหลือง เช่น "missing field" ปล่อยไว้ได้ ไม่กระทบการ index

## 5. เช็กภาพตอนแชร์ลิงก์

- [ ] วางลิงก์หน้าเกม เช่น `https://insider-th.me/games/coup` ในแชต LINE หรือ Facebook ต้องขึ้นภาพปกของเกมนั้น ขนาด 1200×630
- [ ] ถ้า Facebook ยังขึ้นภาพเก่า ให้ใช้ https://developers.facebook.com/tools/debug/ แล้วกด **Scrape Again**

## 6. ติดตามผล (หลัง 2–4 สัปดาห์)

- [ ] Search Console › **Pages**: หน้า /games/* ควรอยู่ใน "Indexed"
  - ถ้าเป็น "Crawled – currently not indexed" ให้รอต่อ หรือเพิ่มลิงก์มาที่หน้านั้นจากโซเชียล/กลุ่มเกม
- [ ] Search Console › **Performance**: ดูคำค้นที่คนเข้ามา เช่น "เกมเศรษฐีออนไลน์", "werewolf ออนไลน์ ภาษาไทย", "ป๊อกเด้งออนไลน์", "coup เกมออนไลน์"
- [ ] คำไหนติดอันดับ 8–20 แล้ว ลองปรับ title/description ของเกมนั้นใน `games/seoContent.js` แล้วขยับวันที่ `updated`

## ไฟล์ที่เกี่ยวข้อง (สำหรับนักพัฒนา)

| เรื่อง | ไฟล์ |
|---|---|
| ข้อความ SEO ของแต่ละเกม (title, description, วิธีเล่น, FAQ) | `games/seoContent.js` |
| หน้า /games/:gameId และ JSON-LD | `games/seoPages.js`, `views/gamePage.ejs`, `public/css/gamePage.css` |
| sitemap.xml (สร้างสด) | `games/sitemap.js` |
| ภาพแชร์ 1200×630 | `scripts/build-og-images.js` → `public/og/*.jpg` (รันใหม่ทุกครั้งที่เพิ่มเกมหรือเปลี่ยนภาพปก) |
| title/description ของหน้าแรก, /rooms, /how-to-play | `buildSeoMetadata()` ใน `app.js` |
| robots.txt, llms.txt | `public/robots.txt`, `public/llms.txt` |
| เทส | `npm run smoke:seo` |
