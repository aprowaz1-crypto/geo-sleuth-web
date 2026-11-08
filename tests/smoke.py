#!/usr/bin/env python3
"""Browser smoke test for Geo-Sleuth Web.

Run with:
  LD_LIBRARY_PATH=/tmp/opencode/chromium-libs/root/usr/lib/aarch64-linux-gnu \
  uv run --with playwright python tests/smoke.py

The LD_LIBRARY_PATH is only needed on hosts where Playwright's cached Chromium
is missing libnspr4/libnss3. Set GEO_TEST_OCR=1 to also exercise Tesseract.js.
"""

import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8765
BASE = f"http://127.0.0.1:{PORT}/"
FIXTURE = ROOT / "tests" / "fixtures" / "gps-photo.jpg"
SHOTS = Path("/tmp/opencode")

from playwright.sync_api import sync_playwright


def wait_for_server(timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(BASE, timeout=1).read(64)
            return
        except Exception:
            time.sleep(0.25)
    raise RuntimeError("local HTTP server did not start")


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    print(f"  ok: {message}")


LAUNCH_ARGS = [
    "--single-process",
    "--no-zygote",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--in-process-gpu",
]


def launch_context(playwright, attempts=6):
    """Launch Chromium with retries.

    This sandbox intermittently refuses Chromium's thread/process creation, so a
    persistent context (created in the same step as the browser) is the most
    reliable option here. The retries are harmless on normal machines.
    """
    last_error = None
    for attempt in range(1, attempts + 1):
        profile = tempfile.mkdtemp(prefix="geo-smoke-")
        try:
            context = playwright.chromium.launch_persistent_context(
                profile,
                headless=True,
                args=LAUNCH_ARGS,
                locale="uk-UA",
                viewport={"width": 1440, "height": 940},
                device_scale_factor=1,
            )
            return context, profile
        except Exception as exc:  # noqa: BLE001 - retry any launch failure
            last_error = exc
            shutil.rmtree(profile, ignore_errors=True)
            print(f"  launch attempt {attempt} failed; retrying")
            time.sleep(0.8)
    raise RuntimeError(f"Chromium did not start: {last_error}")


def main():
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=str(ROOT),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    context = None
    profile = None

    try:
        wait_for_server()
        with sync_playwright() as p:
            context, profile = launch_context(p)
            page = context.pages[0] if context.pages else context.new_page()
            page_errors = []
            page.on("pageerror", lambda exc: page_errors.append(str(exc)))

            print("loading app")
            page.goto(BASE, wait_until="load", timeout=90000)
            page.wait_for_timeout(800)

            check("Geo-Sleuth" in page.title(), "page title")
            check(page.get_attribute("html", "lang") == "uk", "Ukrainian locale detected")
            check("Перетвори" in page.inner_text("h1"), "Ukrainian hero rendered")
            check(page.is_visible("#dropZone"), "drop zone visible")

            print("switching language and theme")
            page.click("#langBtn")
            page.wait_for_timeout(350)
            check("Turn a photo" in page.inner_text("h1"), "EN toggle works")
            page.click("#langBtn")
            page.wait_for_timeout(350)
            check("Перетвори" in page.inner_text("h1"), "UA toggle works")

            theme_before = page.get_attribute("html", "data-theme")
            page.click("#themeBtn")
            page.wait_for_timeout(250)
            theme_after = page.get_attribute("html", "data-theme")
            check(theme_before != theme_after, f"theme toggles ({theme_before} -> {theme_after})")
            if theme_after == "light":
                check(
                    page.evaluate(
                        "() => getComputedStyle(document.querySelector('#themeIcon .ico-moon')).display"
                    ) == "block",
                    "theme icon shows moon in light theme",
                )
            page.click("#themeBtn")
            page.wait_for_timeout(250)

            print("uploading GPS fixture")
            page.set_input_files("#fileInput", str(FIXTURE))
            page.wait_for_selector("#verdict .verdict.good", timeout=60000)
            verdict = page.inner_text("#verdict")
            check("GPS" in verdict, "GPS verdict rendered")
            check("50.08333" in verdict, "latitude shown")

            exif_text = page.inner_text("#exifPanel")
            check("50.083333" in exif_text, "EXIF latitude row")
            check("Geo-Sleuth" in exif_text, "camera make row")
            check("2.8" in exif_text, "aperture row")
            check("+02:00" in exif_text, "EXIF timezone offset row")

            quick = page.inner_text("#quickChips")
            check("2024-06-20" in quick, "date chip")
            check("50.083333" in quick, "coordinate chip")

            page.wait_for_selector("#sunCard:not([hidden])", timeout=20000)
            check(page.locator("#sunCompass svg").count() == 1, "sun compass SVG")
            check(page.locator("#sunPath svg").count() == 1, "sun path SVG")
            check(page.locator("#sunTimes .sun-time").count() >= 6, "sun event list")
            sun_text = page.inner_text("#sunCard")
            check("Азимут" in sun_text, "sun details rendered")
            check("sunNoExactTime" not in sun_text, "no raw i18n keys in sun card")

            page.wait_for_selector("#mapCard:not([hidden])", timeout=20000)
            page.wait_for_timeout(2500)
            leaflet = page.locator("#map.leaflet-container").count()
            fallback = page.locator("#mapFallback iframe").count()
            check(leaflet == 1 or fallback == 1, "Leaflet map or iframe fallback rendered")
            if leaflet:
                check(page.locator("#map .leaflet-marker-icon").count() >= 1, "map marker rendered")
                page.locator("#mapCard").screenshot(path=str(SHOTS / "geo-web-map.png"))
            page.locator("#sunCard").screenshot(path=str(SHOTS / "geo-web-sun.png"))

            page.wait_for_timeout(4000)
            location_text = page.inner_text("#locationPanel") if page.is_visible("#locationCard") else ""
            check("Визначаю адресу" not in location_text, "address request finished")
            print("  info: location panel:", " ".join(location_text.split())[:180] or "(empty)")

            if page.is_visible("#weatherCard"):
                weather_text = page.inner_text("#weatherCard")
                check("{" not in weather_text, "weather card has no unparsed placeholders")

            # Map fullscreen toggle and Escape close.
            page.click("#mapFullscreen")
            page.wait_for_timeout(300)
            check(page.locator("#mapCard.fullscreen").count() == 1, "map fullscreen opens")
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            check(page.locator("#mapCard.fullscreen").count() == 0, "Escape closes fullscreen")

            if os.environ.get("GEO_TEST_OCR") == "1":
                print("running OCR (slow)")
                page.select_option("#ocrLang", "eng")
                page.click("#ocrRun")
                page.wait_for_function(
                    "() => { const el = document.querySelector('#ocrStatus'); return el && /Готово|Done|не вдався|failed/i.test(el.textContent); }",
                    timeout=180000,
                )
                ocr_status = page.inner_text("#ocrStatus")
                check("Готово" in ocr_status, "OCR completed")
                check(len(page.inner_text("#ocrOutput").strip()) > 0, "OCR produced text")
                print("  info: OCR text:", " ".join(page.inner_text("#ocrOutput").split())[:160])

            try:
                page.screenshot(path=str(SHOTS / "geo-web-desktop.png"), full_page=True, timeout=60000, animations="disabled")
            except Exception as exc:  # noqa: BLE001 - screenshot is evidence, not a product check
                print(f"  info: full-page screenshot skipped ({type(exc).__name__}); saving viewport")
                page.screenshot(path=str(SHOTS / "geo-web-desktop.png"), timeout=30000)
            check(not page_errors, f"no uncaught page errors ({page_errors})")

            print("mobile viewport")
            page.set_viewport_size({"width": 390, "height": 844})
            page.wait_for_timeout(1200)
            check(page.locator("#mapCard:not([hidden])").count() == 1, "mobile map card")
            check(
                page.locator("#map.leaflet-container").count() == 1
                or page.locator("#mapFallback iframe").count() == 1,
                "mobile map rendered",
            )
            overflow = page.evaluate(
                "[document.documentElement.scrollWidth, document.documentElement.clientWidth]"
            )
            check(overflow[0] <= overflow[1] + 1, f"no horizontal overflow ({overflow[0]} <= {overflow[1]})")
            try:
                page.screenshot(path=str(SHOTS / "geo-web-mobile.png"), full_page=True, timeout=60000, animations="disabled")
            except Exception as exc:  # noqa: BLE001
                print(f"  info: mobile full-page screenshot skipped ({type(exc).__name__}); saving viewport")
                page.screenshot(path=str(SHOTS / "geo-web-mobile.png"), timeout=30000)

            print("\nSMOKE TEST PASSED")
            print(f"screenshots: {SHOTS / 'geo-web-desktop.png'}, {SHOTS / 'geo-web-mobile.png'}")
    finally:
        if context is not None:
            try:
                context.close()
            except Exception:
                pass
        if profile:
            shutil.rmtree(profile, ignore_errors=True)
        server.terminate()
        try:
            server.wait(timeout=5)
        except Exception:
            server.kill()


if __name__ == "__main__":
    main()
