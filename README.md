# Geo-Sleuth Web (browser drop-and-locate)

**Live:** https://aprowaz1-crypto.github.io/geo-sleuth-web/

Браузерний помічник для геолокації фото: перетягни фото — отримай EXIF (GPS, час, камера), OCR-підказки (текст, номери, назви) та посилання на зворотний пошук зображень. Усе працює локально у браузері.

> Повний geo-sleuth (OSM-геометрія, скайлан, супутник, Street View, CLIP/DINOv2) — це Python-скіл, що встановлюється в OpenCode. Ця веб-версія робить швидкий перший крок: EXIF GPS → карта, OCR → підказки, reverse-search links.

## Можливості
- Перетягування фото або вибір файлу (JPEG/PNG/WEBP/HEIC).
- Витягування EXIF: GPS (lat/lon/alt), дата/час, камера, фокусна відстань, експозиція, ISO.
- Якщо є GPS — показ карти (OpenStreetMap) + посилання Google Maps.
- Якщо GPS немає — запуск OCR (Tesseract.js у браузері) для витягу тексту і підказок (номери телефонів, email, URL, числа, назви).
- Посилання на зворотний пошук: Google, Yandex, Baidu (图寻), TinEye, Bing.
- Усе локально; жодне фото не завантажується на сервер.

## Локальний запуск
```bash
python3 -m http.server 8080
# відкрийте http://localhost:8080
```

## Деплой
Статичний сайт — GitHub Pages / Netlify / Cloudflare Pages.

## Ліцензія
MIT. Побудовано на основі [Oldcircle/geo-sleuth](https://github.com/Oldcircle/geo-sleuth).