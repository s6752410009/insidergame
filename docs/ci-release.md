# ตรวจ CI ก่อน deploy

GitHub Actions `.github/workflows/release-checks.yml` รันเมื่อ push main/codex branch, เปิด PR ไป main และกด Run workflow เอง ใช้ Node 24 และ Playwright Chromium บน Ubuntu โดยไม่มี production credentials และใช้ MongoDB แยกเฉพาะทดสอบ

`npm run test:release` รันทั้งหมด หรือระบุกลุ่ม `rules`, `integration`, `slave-browser`, `website-browser` ได้:

- rules: daily-summary parity/checkpoint recovery, deploy gate, สลาฟ 300 โต๊ะ/600 รอบ, ผลรวมสองรอบและการบันทึก, Black Market engine/strategy
- integration: สลาฟสี่คนจริงทั้ง production/staging, ประวัติ/อันดับ/restart/ghost admin, Black Market socket/bots/stats
- slave-browser: 14 ขนาดจอ, chat/admin tools, เล่นจริงกับบอทและเสียง WebAudio
- website-browser: หน้าแรก → สร้าง → ล็อบบี้ → กระดาน 17 เกมและ 4 เกมเดี่ยว, Black Market, SEO/ลิงก์

งาน daily-mongo รัน MongoDB 7.0.14 แยก ตรวจยอดตรงกับ raw archive การแก้ debug ย้อนหลังระหว่างมี log ใหม่ และ index ของการแบ่งหน้า

ทุกกลุ่มและ daily-mongo ต้องผ่านจึงได้ check `Release checks passed` ไม่มี path filter ที่ปล่อยข้ามการตรวจ เก็บ log/ภาพใน Actions artifacts 7 วัน ข้อมูลเกมเป็น temporary directory และ runner ล้าง DB/URL overrides เสมอ

## Coolify

ตั้ง production resource `om54lzgq0obvujd39rkenkmd` เป็น **Manual deployments only** (Advanced → Deployment → Auto deploy) เพื่อไม่ให้ push เริ่ม build ขณะ CI ยังรันอยู่ ใช้ branch main, Dockerfile ปกติ และเปิด Include Source Commit in Build

1. Push main แล้วรอ Release checks ผ่านครบ ดู Actions ของ commit นั้น
2. รัน `npm run deploy:check` เพื่อตรวจห้อง/ผู้เล่นออนไลน์แบบ read-only ก่อน deploy ถ้ามีเกมกำลังเล่น ให้รอหรือขอคำยืนยันการสะดุดจากผู้ใช้ตาม AGENTS.md
3. กด Deploy ใน Coolify การ build commit ใหม่จะเรียก `ci/verify-release.cjs` ก่อนติดตั้ง dependencies โดยตรวจ SHA เต็ม, check ของ GitHub Actions และที่มาจาก release workflow เท่านั้น ไม่ผ่าน/ยังรัน/อ่าน API ไม่ได้ = build หยุดก่อนแทน container เดิม
4. ตรวจ deployment SHA และ `/ping` หลัง deploy ภาพ Docker ที่ build ผ่านแล้วใช้ cache ของ SHA เดิมได้ การ rollback ต้องเลือกภาพที่เคยผ่านการตรวจ ไม่ใช่ build commit เก่าที่ไม่มี CI

การตรวจผ่าน public GitHub API ไม่ใช้ token ถ้า API จำกัดอัตราหรือใช้งานไม่ได้ การ build ใหม่จะหยุดให้ลองใหม่ ไม่มีการข้าม CI อัตโนมัติ การกด Deploy ไม่ได้เรียก CI ใหม่เอง: ให้กด Run workflow เมื่ออยากทดสอบ commit เดิมซ้ำ

ห้ามเปลี่ยน build pack, Dockerfile หรือปิด Include Source Commit เพื่อข้าม gate โดยไม่ได้ทบทวน release workflow ก่อน Staging ใช้ Dockerfile.staging และข้อมูลแยกตามเดิม

## ข้อยกเว้นชั่วคราวเมื่อ GitHub Actions ใช้งานไม่ได้

วันที่ 2026-11-06 GitHub ปฏิเสธทุก job เพราะบัญชีติดปัญหา billing ผู้ใช้ยืนยันให้ deploy UI/UX โดยใช้ผลทดสอบในเครื่องที่ผ่านครบทั้งสี่กลุ่ม

ตั้ง `LOCAL_VERIFIED_RELEASE_COMMIT` ใน Coolify เป็น SHA เต็ม 40 ตัวของ commit ที่อนุมัติ เปิด Available at Buildtime และปิด Available at Runtime ด่าน build อนุญาตเฉพาะเมื่อค่านี้ตรงกับ SOURCE_COMMIT ทุกตัว จึงไม่ใช่การปิด CI ถาวร และไม่อนุญาต commit ถัดไปโดยอัตโนมัติ Log build ระบุ `user-authorized-local-tests` แยกจาก `github-ci` ชัดเจน

ตรวจห้อง/ขอคำยืนยันหากเกมกำลังเล่นตามเดิม ลบตัวแปรข้อยกเว้นหลัง deploy สำเร็จ เมื่อ billing กลับมาใช้งานได้ให้รัน CI แล้วใช้ทางปกติ
