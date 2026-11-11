# New Year Card Bot (uz / en / ru)

Telegram bot: foydalanuvchi til va dizaynni tanlaydi, ismini yozadi va ismi yozilgan
Yangi yil sertifikati yoki tabrik kartochkasini oladi.

## Imkoniyatlar

**Foydalanuvchi uchun**
- 3 til: Oʻzbekcha, English, Русский (yangi til qoʻshish — pastda)
- 4 dizayn, har biri har bir tilda
- Kartochka tagida tugmalar: **📎 asl sifatda (PNG) yuklab olish**, **📤 doʻstlarga ulashish**,
  **🔤 Kirill ↔ Lotin** (oʻzbek tilida ism boshqa yozuvda qayta chiziladi)
- Kartochka tagida bot nomi yozuvi (`@botnomi`, admin oʻzgartira oladi)

**Admin uchun** (`/admin`)
- 📊 Statistika: foydalanuvchilar, kartochkalar (bugun/7 kun/jami), dizayn va til boʻyicha, xatolar
- 👥 Foydalanuvchilar: qidirish (`/user`), bloklash/ochish (`/block`, `/unblock`)
- 📣 Hammaga xabar yuborish (koʻrib chiqish + tasdiqlash, jarayon, toʻxtatish; botni bloklaganlar avtomatik belgilanadi)
- 🎨 Dizaynlarni yoqish/oʻchirish
- ⚙️ Sozlamalar: kunlik limit, kartochkalar orasidagi interval, majburiy kanal, tagidagi yozuv, texnik ishlar rejimi
- 🐞 Oxirgi xatolar; bot yiqilsa yoki xato boʻlsa adminga Telegramda xabar keladi

**Himoya**: spamdan himoya (interval + kunlik limit), majburiy kanalga obuna, texnik ishlar rejimi,
bot faqat shaxsiy chatda ishlaydi.

## Ishga tushirish

    npm install
    cp .env.example .env        (Windows: copy .env.example .env)
    # .env ichiga BOT_TOKEN va ADMIN_IDS ni yozing
    npm test                    # ixtiyoriy: birlik testlari
    npm run test-render         # ixtiyoriy: ./test-output ga namunalar
    npm start

`ADMIN_IDS` — sizning Telegram ID raqamingiz (@userinfobot ga yozsangiz aytadi).
Bir nechta admin: `ADMIN_IDS=111111,222222`.

## Doimiy ishlatish (server)

**pm2** (Docker kerak emas):

    npm i -g pm2
    pm2 start ecosystem.config.js
    pm2 save && pm2 startup

**Docker**:

    docker compose up -d --build

`data/` (foydalanuvchilar, statistika) va `logs/` papkalari serverda saqlanadi — oʻchirib yubormang.

**Webhook** (ixtiyoriy): `.env` ga `WEBHOOK_URL=https://sizning-domen.uz` va `PORT=3000` yozing
(HTTPS manzil kerak). Boʻsh qoldirsangiz bot polling bilan ishlaydi — kichik bot uchun shu yetarli.
Bir token bilan bir vaqtda faqat BITTA nusxa ishlashi kerak.

## Admin buyruqlari

    /admin                       panel
    /stats                       statistika
    /user 123456789 | @username  foydalanuvchi kartasi
    /block ID | /unblock ID      bloklash / ochish
    /broadcast                   hammaga xabar yuborish
    /setlimit 20                 kunlik limit (0 = cheksiz)
    /setinterval 5               kartochkalar orasidagi soniya (0 = oʻchirish)
    /setchannel @kanal | off     majburiy obuna (bot kanalda ADMIN boʻlishi shart)
    /setfooter matn | off | auto kartochka tagidagi yozuv
    /maintenance on | off        texnik ishlar rejimi

## Fayllar

    index.js              bot mantigʻi
    admin.js              admin panel
    db.js                 foydalanuvchilar, statistika, sozlamalar (data/db.json)
    render.js             ismni kartochkaga chizish
    translit.js           Lotin <-> Kirill
    i18n.js               locales/*.json ni avtomatik yuklaydi
    logger.js, util.js    yordamchi
    locales/uz|en|ru.json bot matnlari + kartochka matnlari
    assets/               shablon rasmlar (template<N>_<til>.jpg) va ism shriftlari
    tools/make_templates.py   shablonlarni locales/*.json dan yaratadi
    tests/unit.js         birlik testlari (npm test)
    data/db.json          avtomatik yaratiladi
    logs/bot.log          avtomatik yaratiladi

Eski `data/users.json` (faqat til) birinchi ishga tushishda `db.json` ga avtomatik koʻchiriladi.

## Yangi til qoʻshish (masalan, qozoqcha)

1. `locales/ru.json` ni `locales/kk.json` ga nusxalang va hamma matnni tarjima qiling.
   `meta` ichida: `code`, `order`, `name`, `flag`, `chooseLang`, `commands`, `description`, `shortDescription`.
   `{name}`, `{label}`, `{min}`, `{max}`, `{sec}`, `{limit}`, `{link}` va `<b>` teglarini oʻzgartirmang.
2. Shablon rasmlarini yarating:

       pip install pillow numpy
       python tools/make_templates.py

   Diqqat: bu skript BARCHA tillar uchun rasmlarni qayta yaratadi. Mavjud tilning rasmlarini
   saqlab qolmoqchi boʻlsangiz, ularni avval nusxalab qoʻying.
3. Botni qayta ishga tushiring — til menyuda oʻzi paydo boʻladi.

## Kartochka matni va ism joylashuvi

- Kartochkadagi matn: `locales/<til>.json` → `"card"` boʻlimi, soʻng `python tools/make_templates.py`.
- Ism oʻrni/oʻlchami/rangi va tagidagi yozuv: `render.js` → `TEMPLATES`
  (`x`, `y`, `fontSize`, `maxWidth`, `color`, `footer`; hammasi rasm oʻlchamiga nisbatan).
- Tugma matnlari va izohlar: `locales/<til>.json` → `"bot"` va `"templates"`.

## Cheklovlar

- Maʼlumotlar JSON faylda saqlanadi — oʻnlab ming foydalanuvchigacha yaxshi ishlaydi. Undan koʻp boʻlsa
  `db.js` ni SQLite yoki Supabase ga koʻchirish kerak (boshqa fayllar faqat `db.js` funksiyalaridan foydalanadi).
- Majburiy obuna faqat ochiq kanallar (`@nom`) uchun.
- Bot guruhlarda ishlamaydi (faqat shaxsiy chat); guruhda `/start` yozilsa, shaxsiy chatga yoʻnaltiradi.
