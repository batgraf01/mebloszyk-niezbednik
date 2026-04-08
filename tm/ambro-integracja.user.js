// ==UserScript==
// @name         Ambro-integracja
// @namespace    mebloszyk-ambro
// @version      0.3.15
// @description  SellRocket -> Ambro: przycisk "Ambro" + przeniesienie danych; Ambro: autowypełnienie odbiorcy + ustawienia (Polska, ubezp. 7000, uwagi) + modal do dodawania wielu produktów do paczek.
// @match        https://enterprise.sellrocket.pl/*
// @match        https://*.enterprise.sellrocket.pl/*
// @match        https://suuhouse.enterprise.sellrocket.pl/*
// @match        *://ambro.opennet.pl/NewOrder.aspx*
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @downloadURL  https://skrypty.mebloszyk.pl/ambro/ambro-integracja.user.js
// @updateURL    https://skrypty.mebloszyk.pl/ambro/ambro-integracja.user.js
// ==/UserScript==

(function () {
  "use strict";

  const AMBRO_URL = "https://ambro.opennet.pl/NewOrder.aspx?t=28";
  const KEY = "ambroPayload_v1";
  const CUSTOM_PRODUCTS_KEY = "ambroCustomProducts_v1";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function normalizeSpaces(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  function fireAll(el) {
    if (!el) return;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function setNativeValue(el, value) {
    if (!el) return false;
    const prototype = Object.getPrototypeOf(el);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && descriptor.set) descriptor.set.call(el, value ?? "");
    else el.value = value ?? "";
    fireAll(el);
    return true;
  }

  function setVal(el, v) {
    if (!el) return false;
    try {
      el.focus();
    } catch {}
    setNativeValue(el, v ?? "");
    return true;
  }

  function normPhone(p) {
    if (!p) return "";
    let digits = String(p).replace(/[^\d]/g, "");
    if (digits.startsWith("48") && digits.length >= 11) digits = digits.slice(2);
    if (digits.length > 9) digits = digits.slice(-9);
    return digits;
  }

  function toast(msg) {
    const t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText = `
      position: fixed; z-index: 2147483647;
      right: 16px; top: 86px;
      background:#7a1f2b; color:#fff; padding:10px 12px; border-radius:10px;
      box-shadow:0 10px 24px rgba(0,0,0,.25);
      font:13px system-ui, Segoe UI, Roboto, Arial;
    `;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  function clickEl(el) {
    if (!el) return false;
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    try {
      el.click();
    } catch {}
    return true;
  }

  // Identyfikatory modułu paczek muszą być zdefiniowane zanim wystartują timery/observer.
  const SCRIPT_ID = "tm-ambro-products";
  const BTN_ID = "tm-ambro-open-modal";
  const MODAL_ID = "tm-ambro-modal";
  const OVERLAY_ID = "tm-ambro-overlay";
  const STATUS_ID = "tm-ambro-status";
  const OBSERVER_ID = "tm-ambro-observer-flag";

  const isSellRocket = /sellrocket\.pl$/i.test(location.host) || /enterprise\.sellrocket\.pl$/i.test(location.host);
  const isAmbro = location.host === "ambro.opennet.pl" && /\/NewOrder\.aspx/i.test(location.pathname);
  let shouldInitAmbroPackages = false;
  const page = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

  // =========================
  // 1) SELLROCKET -> przycisk
  // =========================
  if (isSellRocket) {
    injectAmbroButtonSR();
    return;
  }

  // =========================
  // 2) AMBRO -> autofill + paczki
  // =========================
  if (isAmbro) {
    runAmbroAutofill().catch(() => {});
    shouldInitAmbroPackages = true;
  }

  function injectAmbroButtonSR() {
    const ensure = () => {
      if (document.getElementById("sr-ambro-btn")) return;

      const wrap = document.getElementById("sr2zb-wrap");
      let target = wrap;
      if (!target) {
        const orderIdEl = document.querySelector("[data-testid='order_detail_ID']");
        target = orderIdEl?.closest(".MuiBox-root") || orderIdEl?.parentElement || null;
      }
      if (!target) return;

      const copyBtn = Array.from(target.querySelectorAll("button")).find((b) => /kopiuj/i.test((b.textContent || "").trim()));

      const btn = document.createElement("button");
      btn.id = "sr-ambro-btn";
      btn.textContent = "Ambro";
      btn.type = "button";
      btn.style.cssText = `
        background: linear-gradient(#b3261e, #8e1b16);
        color: #fff;
        border: 1px solid #6f1612;
        border-radius: 6px;
        padding: 6px 14px;
        cursor: pointer;
        font-size: 12px;
        box-shadow: rgba(0, 0, 0, 0.1) 0px 2px 4px;
        transition: 0.2s;
        margin-left: 10px;
      `;
      btn.onmouseenter = () => {
        btn.style.filter = "brightness(1.08)";
      };
      btn.onmouseleave = () => {
        btn.style.filter = "none";
      };

      btn.onclick = () => {
        const payload = readSellRocketOrderData();
        if (!payload) {
          toast("Nie znalazłem danych dostawy w SR.");
          return;
        }
        GM_setValue(KEY, payload);
        toast("Wysyłam do Ambro...");
        window.open(AMBRO_URL, "_blank", "noopener,noreferrer");
      };

      if (copyBtn && copyBtn.parentElement) copyBtn.insertAdjacentElement("afterend", btn);
      else target.appendChild(btn);
    };

    ensure();
    new MutationObserver(ensure).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(ensure, 1200);
  }

  function readSellRocketOrderData() {
    let orderNo = "";
    const head = Array.from(document.querySelectorAll("h1,h2,header,div")).find((x) => /Zamówienie\s+\d+/.test(x.textContent || ""));
    if (head) {
      const m = (head.textContent || "").match(/Zamówienie\s+(\d+)/);
      if (m) orderNo = m[1];
    }
    if (!orderNo) {
      const u = location.pathname.match(/unified-orders\/(\d+)/);
      if (u) orderNo = u[1];
    }

    let email = "",
      phone = "";
    const infoBox = Array.from(document.querySelectorAll("div,section")).find((d) => /Informacje o zamówieniu/i.test(d.textContent || ""));
    if (infoBox) {
      const t = infoBox.innerText.replace(/\u00A0/g, " ");
      const em = t.match(/E-?mail:\s*([^\s]+@[^\s]+)\b/i);
      if (em) email = em[1].trim();
      const ph = t.match(/Telefon:\s*([+() \-\d]+)/i);
      if (ph) phone = normPhone(ph[1]);
    }

    let firstName = "",
      lastName = "",
      street = "",
      house = "",
      apt = "",
      post = "",
      city = "";
    const shipBox = Array.from(document.querySelectorAll("div,section")).find((d) => /Dane dostawy/i.test(d.textContent || ""));
    if (shipBox) {
      const tx = shipBox.innerText.replace(/\u00A0/g, " ").trim();
      const mIm = tx.match(/Imię:\s*(.+)/i);
      if (mIm) firstName = mIm[1].trim();
      const mNaz = tx.match(/Nazwisko:\s*(.+)/i);
      if (mNaz) lastName = mNaz[1].trim();
      const mAdr = tx.match(/Adres:\s*(.+)/i);
      const fullAddr = mAdr ? mAdr[1].trim() : "";

      const mStreet = fullAddr.match(/^(.+?)\s+(\d+[A-Za-z]?)(?:\s*\/\s*([\w-]+))?$/);
      if (mStreet) {
        street = mStreet[1].trim();
        house = mStreet[2].trim();
        apt = (mStreet[3] || "").trim();
      } else {
        street = fullAddr;
      }

      const mCity = tx.match(/Kod pocztowy i miasto:\s*([0-9]{2}-[0-9]{3})\s+(.+)/i);
      if (mCity) {
        post = mCity[1].trim();
        city = mCity[2].trim();
      }
    }

    const ok = firstName || lastName || street || post || city || phone || email;
    if (!ok) return null;

    return {
      ts: Date.now(),
      orderNo,
      firstName,
      lastName,
      fullName: normalizeSpaces(`${firstName} ${lastName}`),
      addressLine: normalizeSpaces(`${street}${street ? " " : ""}${house}${apt ? "/" + apt : ""}`),
      post,
      city,
      phone: normPhone(phone),
      email,
    };
  }

  async function runAmbroAutofill() {
    await sleep(500);
    const payload = GM_getValue(KEY, null);
    if (!payload) return;

    const elName = document.getElementById("ctl00_ContentPlaceHolder1_ctl00_Company2_Panel1_txbName_I");
    const elPost = document.getElementById("ctl00_ContentPlaceHolder1_ctl00_Company2_Panel1_txbPostCode_I");
    const elCity = document.getElementById("ctl00_ContentPlaceHolder1_ctl00_Company2_Panel1_txbCity_I");
    const elAddr = document.getElementById("ctl00_ContentPlaceHolder1_ctl00_Company2_Panel1_pnlAddressPL_txbAddress_I");
    const elFull = document.getElementById("ctl00_ContentPlaceHolder1_ctl00_Company2_Panel1_txbSurname_I");
    const elPhone = document.getElementById("ctl00_ContentPlaceHolder1_ctl00_Company2_Panel1_txbPhone_I");
    const elEmail = document.getElementById("ctl00_ContentPlaceHolder1_ctl00_Company2_Panel1_txbEmail_I");

    setVal(elName, payload.fullName);
    setVal(elPost, payload.post);
    setVal(elCity, payload.city);
    setVal(elAddr, payload.addressLine);
    setVal(elFull, payload.fullName);
    setVal(elPhone, payload.phone);
    setVal(elEmail, payload.email);

    await sleep(250);
    await ensureExtras();

    GM_deleteValue(KEY);
    toast("Wklejone do Ambro + kraj + ubezpieczenie + uwagi ✓");
  }

  function findCountryDropdownButton() {
    return (
      document.getElementById("ctl00_ContentPlaceHolder1_ctl00_Company2_Panel1_cmbxCountry_B-1") ||
      document.querySelector("#ctl00_ContentPlaceHolder1_ctl00_Company2_Panel1_cmbxCountry .dxeButtonEditButton") ||
      document.querySelector("[id*=\"cmbxCountry_B-1\"]")
    );
  }

  function findCountryListItemPoland() {
    const items = Array.from(document.querySelectorAll("td, li, span, div"));
    return items.find((el) => /^\s*polska\s*$/i.test((el.textContent || "").trim()));
  }

  async function setCountryPoland() {
    const input = document.getElementById("ctl00_ContentPlaceHolder1_ctl00_Company2_Panel1_cmbxCountry_I");
    if (!input) return false;

    setVal(input, "Polska");
    await sleep(150);

    const btn = findCountryDropdownButton();
    if (btn) {
      clickEl(btn);
      await sleep(250);

      const plItem = findCountryListItemPoland();
      if (plItem) {
        clickEl(plItem);
        await sleep(150);
      } else {
        setVal(input, "Polska");
      }
    }

    fireAll(input);
    return /^polska$/i.test((input.value || "").trim());
  }

  async function setInsurance7000() {
    const elInsurance = document.getElementById("ctl00_ContentPlaceHolder1_ctl00_AdditionalServices1_cpCodUbe_txbUBE_I");
    if (!elInsurance) return false;
    const parseMoney = (raw) => {
      const txt = String(raw || "").trim();
      if (!txt) return 0;
      // Np. "7 000,00" -> 7000.00
      const normalized = txt.replace(/\s+/g, "").replace(",", ".");
      const num = Number.parseFloat(normalized);
      return Number.isFinite(num) ? num : 0;
    };

    // Jeśli Ambro już sformatowało i pole trzyma 7000, nie nadpisuj ponownie.
    const current = parseMoney(elInsurance.value);
    if (Math.abs(current - 7000) < 0.01) return true;

    setVal(elInsurance, "7000");
    await sleep(120);
    const after = parseMoney(elInsurance.value);
    return Math.abs(after - 7000) < 0.01;
  }

  async function setCommentText() {
    const elComment = document.getElementById("ctl00_ContentPlaceHolder1_ctl00_Comment1_mmComment_I");
    if (!elComment) return false;
    setVal(elComment, "produkt architektury ogrodowej");
    await sleep(100);
    return (elComment.value || "").trim() === "produkt architektury ogrodowej";
  }

  async function ensureExtras() {
    let countryOk = false;
    let insuranceOk = false;
    let commentOk = false;

    for (let i = 0; i < 8; i++) {
      if (!countryOk) countryOk = await setCountryPoland();
      if (!insuranceOk) insuranceOk = await setInsurance7000();
      if (!commentOk) commentOk = await setCommentText();
      if (countryOk && insuranceOk && commentOk) return true;
      await sleep(350);
    }
    return countryOk && insuranceOk && commentOk;
  }

  // =========================
  // 3) AMBRO -> produkty do paczek
  // =========================

  const PRODUCTS = {
    "SKY Skyline 3×2,5 (4 kartony)": [
      { dims: [2.81, 0.27, 0.27], weight: 29 },
      { dims: [2.97, 0.29, 0.15], weight: 36 },
      { dims: [2.37, 0.34, 0.27], weight: 37 },
      { dims: [2.37, 0.27, 0.19], weight: 16 },
    ],
    "Pergola Sola 3×4 (4 kartony)": [
      { dims: [2.95, 0.2, 0.14], weight: 54 },
      { dims: [2.95, 0.2, 0.15], weight: 54 },
      { dims: [2.68, 0.25, 0.2], weight: 41 },
      { dims: [3.9, 0.3, 0.15], weight: 59 },
    ],
    "SKY Skyline 3×3 przyścienna (4 kartony)": [
      { dims: [2.82, 0.24, 0.125], weight: 14 },
      { dims: [2.97, 0.29, 0.15], weight: 34 },
      { dims: [2.88, 0.24, 0.34], weight: 36 },
      { dims: [2.88, 0.24, 0.19], weight: 22 },
    ],
    "SKY Skyline 3×4 (4 kartony)": [
      { dims: [2.82, 0.27, 0.24], weight: 29 },
      { dims: [3.96, 0.26, 0.15], weight: 40 },
      { dims: [2.89, 0.34, 0.24], weight: 37 },
      { dims: [2.89, 0.33, 0.27], weight: 39 },
    ],
    "SKY Skyline 4×4 (4 kartony)": [
      { dims: [2.81, 0.27, 0.24], weight: 28 },
      { dims: [3.96, 0.29, 0.15], weight: 49 },
      { dims: [3.87, 0.34, 0.34], weight: 72 },
      { dims: [3.87, 0.31, 0.34], weight: 69 },
    ],
    "SKY Skyline 3×6 LED (5 kartonów)": [
      { dims: [2.81, 0.38, 0.24], weight: 42 },
      { dims: [2.82, 0.43, 0.15], weight: 54 },
      { dims: [2.88, 0.24, 0.34], weight: 50 },
      { dims: [2.88, 0.24, 0.34], weight: 50 },
      { dims: [2.88, 0.24, 0.34], weight: 50 },
    ],
    "MRD Mirador 3×2 (2 kartony)": [
      { dims: [3.0, 0.35, 0.22], weight: 50 },
      { dims: [2.86, 0.37, 0.23], weight: 68 },
    ],
    "MRD Mirador 3×2,4 (2 kartony)": [
      { dims: [2.86, 0.22, 0.35], weight: 83 },
      { dims: [2.85, 0.33, 0.37], weight: 68 },
    ],
    "MRD Mirador 3×3 (2 kartony)": [
      { dims: [2.83, 0.31, 0.38], weight: 89 },
      { dims: [2.86, 0.22, 0.25], weight: 70 },
    ],
    "MRD Mirador 3×4 (4 kartony)": [
      { dims: [2.96, 0.4, 0.2], weight: 42 },
      { dims: [2.86, 0.4, 0.2], weight: 50 },
      { dims: [2.26, 0.2, 0.2], weight: 40 },
      { dims: [3.86, 0.2, 0.2], weight: 50 },
    ],
    "MRD Mirador 3×6 (5 kartonów)": [
      { dims: [2.55, 0.37, 0.24], weight: 48 },
      { dims: [3.36, 0.41, 0.17], weight: 68 },
      { dims: [2.98, 0.4, 0.19], weight: 64 },
      { dims: [2.98, 0.4, 0.19], weight: 64 },
      { dims: [2.98, 0.4, 0.19], weight: 60 },
    ],
    "RSK Roleta Skyline 3 m (1 karton)": [{ dims: [0.12, 0.23, 2.75], weight: 24 }],
    "RSK Roleta Skyline 4 m (1 karton)": [{ dims: [0.12, 0.23, 3.75], weight: 28 }],
    "RMD Roleta Mirador 3 m (1 karton)": [{ dims: [0.12, 0.23, 2.75], weight: 24 }],
    "RMD Roleta Mirador 4 m (1 karton)": [{ dims: [0.12, 0.23, 3.75], weight: 35 }],
    "ZSK Żaluzje Skyline 90 (1 karton)": [{ dims: [0.15, 0.39, 1.28], weight: 22 }],
    "ZSK Żaluzje Skyline 128 (1 karton)": [{ dims: [0.18, 0.35, 1.28], weight: 26 }],
    "ZMD Żaluzja Mirador (1 karton)": [{ dims: [2.28, 0.26, 0.08], weight: 42 }],
    "VID Vidar mały (2 kartony)": [
      { dims: [0.13, 0.64, 1.88], weight: 32 },
      { dims: [0.18, 0.64, 1.45], weight: 27 },
    ],
    "VID Vidar duży (3 kartony)": [
      { dims: [0.11, 0.64, 2.41], weight: 30 },
      { dims: [0.17, 0.64, 1.88], weight: 34 },
      { dims: [0.2, 0.64, 1.16], weight: 29 },
    ],
    "KTR Keter Darwin 195 (1 karton)": [
      { dims: [1.95, 0.7, 0.3], weight: 60 },
    ],
    "MGN Magni mały (2 kartony)": [
      { dims: [0.13, 0.41, 1.51], weight: 21 },
      { dims: [0.16, 0.62, 1.73], weight: 56 },
    ],
    "MGN Magni średni (3 kartony)": [
      { dims: [1.83, 0.62, 0.12], weight: 48 },
      { dims: [1.55, 0.6, 0.09], weight: 24 },
      { dims: [1.52, 0.4, 0.14], weight: 20 },
    ],
    "MGN Magni duży (3 kartony)": [
      { dims: [1.83, 0.62, 0.13], weight: 53 },
      { dims: [1.55, 0.61, 0.1], weight: 24 },
      { dims: [1.68, 0.44, 0.13], weight: 22 },
    ],
    "THR Thor mały (2 kartony)": [
      { dims: [0.13, 0.41, 1.51], weight: 21 },
      { dims: [0.16, 0.62, 1.73], weight: 56 },
    ],
    "THR Thor średni (3 kartony)": [
      { dims: [0.12, 0.62, 1.73], weight: 44 },
      { dims: [0.09, 0.61, 1.55], weight: 23 },
      { dims: [0.13, 0.41, 1.7], weight: 23 },
    ],
    "THR Thor duży (3 kartony)": [
      { dims: [0.13, 0.62, 1.73], weight: 49 },
      { dims: [0.1, 0.61, 1.55], weight: 26 },
      { dims: [0.12, 0.44, 1.7], weight: 26 },
    ],
    "LWK Ławka Keter (1 karton)": [{ dims: [1.3, 0.07, 0.19], weight: 15 }],
    "MBL Volterra (1 karton)": [{ dims: [0.96, 0.63, 0.32], weight: 31 }],
    "MBL Cortona (1 karton)": [{ dims: [1.53, 0.82, 0.43], weight: 59 }],
    "MLG Meble Lounge (2 kartony)": [
      { dims: [1.63, 0.77, 0.43], weight: 40 },
      { dims: [0.82, 0.77, 0.39], weight: 21 },
    ],
    "CFR CarPort FR 3×6 (1 kpl.)": [{ dims: [3.3, 0.77, 0.23], weight: 98 }],
    "CFR CarPort FR 3×5 (1 kpl.)": [{ dims: [3.13, 0.76, 0.21], weight: 89 }],
    "CNJ CarPort NJ 3×6 (1 kpl.)": [{ dims: [3.24, 0.77, 0.2], weight: 98 }],
    "CNJ CarPort NJ 3×5 (1 kpl.)": [{ dims: [3.14, 0.76, 0.2], weight: 91 }],
  };

  function normalizeCustomCartons(cartonsRaw) {
    if (!Array.isArray(cartonsRaw)) return [];
    return cartonsRaw
      .map((c) => {
        const d1 = Number(String(c?.dims?.[0] ?? "").replace(",", "."));
        const d2 = Number(String(c?.dims?.[1] ?? "").replace(",", "."));
        const d3 = Number(String(c?.dims?.[2] ?? "").replace(",", "."));
        const w = Number(String(c?.weight ?? "").replace(",", "."));
        if (!Number.isFinite(d1) || !Number.isFinite(d2) || !Number.isFinite(d3) || !Number.isFinite(w)) return null;
        if (d1 <= 0 || d2 <= 0 || d3 <= 0 || w <= 0) return null;
        return { dims: [d1, d2, d3], weight: w };
      })
      .filter(Boolean);
  }

  function loadCustomProducts() {
    const raw = GM_getValue(CUSTOM_PRODUCTS_KEY, []);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((p) => {
        const name = normalizeSpaces(p?.name || "");
        const group = normalizeSpaces(p?.group || "");
        const cartons = normalizeCustomCartons(p?.cartons || []);
        if (!name || !cartons.length) return null;
        return { name, group, cartons };
      })
      .filter(Boolean);
  }

  function saveCustomProducts(list) {
    GM_setValue(CUSTOM_PRODUCTS_KEY, Array.isArray(list) ? list : []);
  }

  let isRunning = false;
  let domObserver = null;
  const PACZKI_POLL_MS = 90;
  // Nadpisania paczek dla bieżącego wyboru w modalu (nie zapisujemy na stałe).
  // Klucz: productName, wartość: cartons[]
  const selectionOverrides = Object.create(null);

  function formatCm(valueInMeters) {
    return String(Math.round(Number(valueInMeters) * 100));
  }

  function formatWeight(value) {
    return String(Number(value)).replace(".", ",");
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeIdToken(str) {
    return String(str || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  }

  function cleanProductTitle(name) {
    return String(name)
      .replace(/^[A-ZĄĆĘŁŃÓŚŹŻ]{3}\s+/u, "")
      .replace(/\s*\(\d+\s+karton(?:y|ów)?\)\s*$/iu, "")
      .replace(/\s*\(1\s+kpl\.\)\s*$/iu, "")
      .trim();
  }

  const PRODUCT_GROUP_ORDER = [
    "Skyline - pergole",
    "Skyline - rolety i żaluzje",
    "Mirador - pergole",
    "Mirador - rolety i żaluzje",
    "Sola - pergole",
    "Thor",
    "Magni",
    "Vidar",
    "Keter",
    "Wiaty Njord i Frej (carporty)",
    "Meble",
    "Reszta",
  ];

  function getProductGroup(name) {
    const n = String(name || "").toLowerCase();
    const isRoletaOrZaluzja = n.includes("roleta") || n.includes("żaluz") || n.includes("zaluz");
    const isMeble = n.includes("ławka") || n.includes("lawka") || n.includes("volterra") || n.includes("cortona") || n.includes("lounge");

    if (n.includes("sola")) return "Sola - pergole";
    if (n.includes("skyline")) {
      return isRoletaOrZaluzja ? "Skyline - rolety i żaluzje" : "Skyline - pergole";
    }
    if (n.includes("mirador")) {
      return isRoletaOrZaluzja ? "Mirador - rolety i żaluzje" : "Mirador - pergole";
    }
    if (n.includes("thor")) return "Thor";
    if (n.includes("magni")) return "Magni";
    if (n.includes("vidar")) return "Vidar";
    if (n.includes("keter") || n.includes("darwin")) return "Keter";
    if (n.includes("carport") || n.includes("njord") || n.includes("frej")) return "Wiaty Njord i Frej (carporty)";
    if (isMeble) return "Meble";
    return "Reszta";
  }

  function getCatalogEntries() {
    const baseEntries = Object.entries(PRODUCTS).map(([name, cartons]) => ({
      name,
      cartons,
      group: getProductGroup(name),
    }));
    const customEntries = loadCustomProducts().map((p) => ({
      name: p.name,
      cartons: p.cartons,
      group: p.group || getProductGroup(p.name),
    }));
    return [...baseEntries, ...customEntries];
  }

  function getProductsMap() {
    const out = {};
    getCatalogEntries().forEach((entry) => {
      out[entry.name] = entry.cartons;
    });
    return out;
  }

  function getCartonsForSelection(productMap, productName) {
    const override = selectionOverrides[productName];
    if (Array.isArray(override) && override.length) return override;
    return productMap[productName];
  }

  function getProductThemeClass(name) {
    const n = String(name).toLowerCase();
    if (n.includes("skyline")) return "tm-theme-skyline";
    if (n.includes("mirador")) return "tm-theme-mirador";
    if (n.includes("sola")) return "tm-theme-sola";
    return "";
  }

  function isAmbroPackagesPage() {
    // W praktyce Ambro potrafi ładować kontrolki asynchronicznie.
    // Wykrywamy stronę paczek po samym przycisku "Dodaj paczkę".
    return !!getAddButtonElement();
  }

  function getAddButtonElement() {
    return (
      document.getElementById("ctl00_ContentPlaceHolder1_ctl00_Paczki1_cpPaczki_gvPaczki_Title_btnDodajPaczke") ||
      document.querySelector("[id$='btnDodajPaczke']") ||
      document.querySelector("[id*='btnDodajPaczke']") ||
      null
    );
  }

  function getToolbarArea() {
    const addBtn = getAddButtonElement();
    if (!addBtn) return null;
    return addBtn.closest("table")?.parentElement || addBtn.parentElement;
  }

  function setStatus(text, isError = false) {
    const el = document.getElementById(STATUS_ID);
    if (!el) return;
    el.textContent = text;
    el.style.color = isError ? "#b42318" : "#344054";
  }

  function clearFields() {
    try {
      page.IloscPaczek.SetText("");
      page.WagaPaczki.SetText("");
      page.DlugoscPaczki.SetText("");
      page.SzerokoscPaczki.SetText("");
      page.WysokoscPaczki.SetText("");
      page.ZawartoscPaczki.SetText("");
      if (page.WagaGabarytowa && page.WagaGabarytowa.SetText) {
        page.WagaGabarytowa.SetText("0");
      }
    } catch (e) {
      console.error(e);
    }
  }

  function fillPackageFields(pkg) {
    page.IloscPaczek.SetText("1");
    page.WagaPaczki.SetText(formatWeight(pkg.weight));
    page.DlugoscPaczki.SetText(formatCm(pkg.dims[0]));
    page.SzerokoscPaczki.SetText(formatCm(pkg.dims[1]));
    page.WysokoscPaczki.SetText(formatCm(pkg.dims[2]));
    page.ZawartoscPaczki.SetText(pkg.content);

    if (typeof page.LiczWageGabarytowa === "function") {
      page.LiczWageGabarytowa();
    }
  }

  function isInPaczkiCallback() {
    return (
      (page.cpPaczki && typeof page.cpPaczki.InCallback === "function" && page.cpPaczki.InCallback()) ||
      (page.gvPaczki && typeof page.gvPaczki.InCallback === "function" && page.gvPaczki.InCallback())
    );
  }

  async function waitForCallbackCycle(timeoutMs = 12000) {
    // Czekamy aż callback się zacznie (krótko), potem aż się skończy.
    const start = Date.now();
    let sawCallback = false;

    while (Date.now() - start < timeoutMs) {
      const inCb = isInPaczkiCallback();
      if (!sawCallback) {
        if (inCb) {
          sawCallback = true;
        } else if (Date.now() - start > 1200) {
          // Jeśli callback nie wystartował, nie blokuj bez końca.
          return true;
        }
      } else if (!inCb) {
        return true;
      }
      await sleep(PACZKI_POLL_MS);
    }
    return false;
  }

  async function clickAddAndWait() {
    const addBtn = getAddButtonElement();
    if (!addBtn) throw new Error("Nie znaleziono przycisku Dodaj.");

    addBtn.click();
    const ok = await waitForCallbackCycle();
    if (!ok) throw new Error("Timeout podczas dodawania paczki.");
  }

  function getShortContent(productName, cartonIndex, cartonsCount) {
    const name = productName.toLowerCase();

    if (name.includes("roleta skyline 3")) return "roleta 3m";
    if (name.includes("roleta skyline 4")) return "roleta 4m";
    if (name.includes("roleta mirador 3")) return "roleta 3m";
    if (name.includes("roleta mirador 4")) return "roleta 4m";

    if (
      name.includes("skyline") ||
      name.includes("mirador") ||
      name.includes("magni") ||
      name.includes("thor") ||
      name.includes("vidar") ||
      name.includes("carport")
    ) {
      return cartonsCount > 1 ? `pergola ${cartonIndex + 1}/${cartonsCount}` : "pergola";
    }

    if (name.includes("żaluz")) return "żaluzja";
    if (name.includes("lawka") || name.includes("ławka")) return "ławka";
    if (name.includes("cortona")) return "cortona";
    if (name.includes("volterra")) return "volterra";
    if (name.includes("lounge")) return "meble lounge";

    return cartonsCount > 1 ? `produkt ${cartonIndex + 1}/${cartonsCount}` : "produkt";
  }

  function buildQueueFromSelection(selection) {
    const queue = [];
    const productMap = getProductsMap();

    Object.entries(selection).forEach(([productName, quantity]) => {
      const qty = Number(quantity);
      if (!qty || qty <= 0) return;

      const cartons = getCartonsForSelection(productMap, productName);
      if (!Array.isArray(cartons) || cartons.length === 0) return;

      for (let productIndex = 1; productIndex <= qty; productIndex++) {
        cartons.forEach((carton, cartonIndex) => {
          queue.push({
            dims: carton.dims,
            weight: carton.weight,
            content: getShortContent(productName, cartonIndex, cartons.length),
          });
        });
      }
    });

    return queue;
  }

  function collectSelectionFromModal() {
    const inputs = document.querySelectorAll(".tm-ambro-product-qty");
    const selection = {};

    inputs.forEach((input) => {
      const qty = Number(input.value || 0);
      if (qty > 0) selection[input.dataset.product] = qty;
    });

    return selection;
  }

  function resetModalInputs() {
    document.querySelectorAll(".tm-ambro-product-qty").forEach((input) => {
      input.value = "0";
    });
    // Reset nadpisań tylko dla bieżącego wyboru.
    Object.keys(selectionOverrides).forEach((k) => delete selectionOverrides[k]);
    updateSummary();
  }

  function addStyles() {
    if (document.getElementById(`${SCRIPT_ID}-styles`)) return;

    const style = document.createElement("style");
    style.id = `${SCRIPT_ID}-styles`;
    style.textContent = `
      #${BTN_ID} {
        margin-left: 12px;
        padding: 8px 14px;
        border: 1px solid #0869EB;
        background: #0869EB;
        color: #fff;
        border-radius: 8px;
        cursor: pointer;
        font-size: 13px;
        line-height: 1.2;
      }
      #${BTN_ID}:hover { opacity: 0.92; }

      #${STATUS_ID} { margin-top: 8px; font-size: 12px; }

      #${OVERLAY_ID} {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.45);
        z-index: 999998;
        display: none;
      }

      #${MODAL_ID} {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: min(600px, calc(100vw - 24px));
        max-height: calc(100vh - 24px);
        overflow: auto;
        background: #fff;
        border-radius: 16px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.25);
        z-index: 999999;
        display: none;
        font-family: Arial, sans-serif;
      }

      .tm-ambro-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 14px 16px;
        border-bottom: 1px solid #e5e7eb;
        position: sticky;
        top: 0;
        background: #fff;
        z-index: 2;
      }

      .tm-ambro-modal-title { font-size: 18px; font-weight: 700; color: #111827; }

      .tm-ambro-close {
        border: 1px solid #d0d5dd;
        background: #fff;
        border-radius: 8px;
        padding: 8px 12px;
        cursor: pointer;
      }

      .tm-ambro-modal-body { padding: 12px 16px 16px; }

      .tm-ambro-search {
        width: 100%;
        padding: 9px 12px;
        border: 1px solid #d0d5dd;
        border-radius: 8px;
        margin-bottom: 12px;
        font-size: 14px;
      }

      .tm-ambro-grid { display: block; }

      .tm-ambro-group {
        margin-bottom: 14px;
      }

      .tm-ambro-group-title {
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.02em;
        color: #ffffff;
        margin: 6px 0 8px;
        padding: 6px 10px;
        border-left: 3px solid #374151;
        background: #4b5563;
        border-radius: 6px;
      }

      .tm-ambro-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .tm-ambro-item {
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 8px 10px;
        background: #fff;
        box-shadow: 0 1px 2px rgba(16,24,40,0.04);
      }

      .tm-ambro-item.tm-theme-skyline { background: #f3f8ff; border-color: #dbeafe; }
      .tm-ambro-item.tm-theme-mirador { background: #fff5f5; border-color: #fecaca; }
      .tm-ambro-item.tm-theme-sola { background: #f0fdf4; border-color: #bbf7d0; }

      .tm-ambro-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 70px auto 88px;
        gap: 8px;
        align-items: center;
      }

      .tm-ambro-col-meta {
        font-size: 12px;
        color: #475467;
        text-align: center;
        white-space: nowrap;
      }

      .tm-ambro-name { font-size: 13px; color: #111827; font-weight: 700; line-height: 1.25; word-break: break-word; }

      .tm-ambro-details-toggle {
        margin-top: 6px;
        border: 1px solid #d0d5dd;
        background: #fff;
        color: #344054;
        border-radius: 6px;
        font-size: 11px;
        padding: 3px 7px;
        cursor: pointer;
      }

      .tm-ambro-qty-control {
        display: inline-flex;
        align-items: center;
        border: 1px solid #d0d5dd;
        border-radius: 8px;
        overflow: hidden;
        background: #fff;
      }

      .tm-qty-btn {
        width: 28px;
        height: 28px;
        border: none;
        background: #f8fafc;
        color: #111827;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        padding: 0;
      }

      .tm-qty-btn:hover { background: #eef2f7; }

      .tm-ambro-product-qty {
        width: 38px;
        min-width: 38px;
        padding: 4px 2px;
        border: none;
        border-left: 1px solid #e5e7eb;
        border-right: 1px solid #e5e7eb;
        font-size: 12px;
        text-align: center;
        background: #fff;
        outline: none;
      }
      .tm-ambro-product-qty::-webkit-outer-spin-button,
      .tm-ambro-product-qty::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
      .tm-ambro-product-qty[type=number] { -moz-appearance: textfield; }

      .tm-ambro-cartons-list {
        display: grid;
        grid-template-columns: 1fr;
        column-gap: 12px;
        row-gap: 3px;
        font-size: 12px;
        color: #475467;
        line-height: 1.35;
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px dashed #d0d5dd;
      }
      .tm-ambro-cartons-list.is-collapsed { display: none; }

      .tm-ambro-carton-line {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .tm-ambro-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 12px 16px 16px;
        border-top: 1px solid #e5e7eb;
        position: sticky;
        bottom: 0;
        background: #fff;
      }

      .tm-ambro-actions { display: flex; gap: 10px; flex-wrap: wrap; }

      .tm-ambro-btn {
        border: 1px solid #d0d5dd;
        background: #fff;
        color: #111827;
        border-radius: 8px;
        padding: 10px 14px;
        cursor: pointer;
        font-size: 14px;
      }

      .tm-ambro-btn-primary { border-color: #0869EB; background: #0869EB; color: #fff; }
      .tm-ambro-summary { font-size: 13px; color: #344054; }

      .tm-ambro-custom-wrap {
        margin-top: 14px;
        border-top: 1px dashed #d0d5dd;
        padding-top: 12px;
        position: relative;
      }
      .tm-ambro-custom-wrap::before {
        content: "";
        position: absolute;
        top: -3px;
        left: 0;
        right: 0;
        height: 3px;
        background: #0869EB;
        border-radius: 3px;
      }
      .tm-ambro-custom-title {
        font-size: 12px;
        font-weight: 700;
        color: #344054;
        margin-bottom: 8px;
      }
      .tm-ambro-custom-grid {
        display: grid;
        grid-template-columns: 1.4fr 1fr;
        gap: 8px;
        margin-bottom: 8px;
      }
      .tm-ambro-input, .tm-ambro-select {
        width: 100%;
        border: 1px solid #d0d5dd;
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 12px;
        background: #fff;
      }
      .tm-ambro-carton-row {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
        gap: 6px;
        margin-bottom: 6px;
      }
      .tm-ambro-mini-btn {
        border: 1px solid #d0d5dd;
        background: #fff;
        border-radius: 8px;
        padding: 6px 10px;
        font-size: 12px;
        cursor: pointer;
      }
      .tm-ambro-mini-btn-primary {
        border-color: #0869EB;
        background: #0869EB;
        color: #fff;
      }
      .tm-ambro-custom-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-top: 8px;
        flex-wrap: wrap;
      }
      .tm-ambro-custom-note { font-size: 11px; color: #667085; }
      .tm-ambro-custom-list { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
      .tm-ambro-custom-item {
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 6px 8px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }
      .tm-ambro-custom-item-main { min-width: 0; }
      .tm-ambro-custom-item-name { font-size: 12px; font-weight: 600; color: #111827; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .tm-ambro-custom-item-meta { font-size: 11px; color: #667085; }

      .tm-ambro-row-actions { display:flex; gap:6px; justify-content:flex-end; align-items:center; flex-wrap: wrap; }
      .tm-ambro-action-btn {
        border: 1px solid #d0d5dd;
        background: #fff;
        border-radius: 8px;
        padding: 6px 10px;
        font-size: 12px;
        cursor: pointer;
        color: #111827;
      }
      .tm-ambro-action-btn:hover { background: #f8fafc; }
      .tm-ambro-action-btn-danger { border-color: #fecdca; background: #fff5f5; }
      .tm-ambro-inline-editor {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px dashed #d0d5dd;
        display: none;
      }
      .tm-ambro-inline-editor.is-open { display: block; }
      .tm-ambro-inline-meta { font-size: 11px; color: #667085; margin-bottom: 8px; }

      .tm-ambro-name-line {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      .tm-ambro-name-line .tm-ambro-name {
        min-width: 0;
        flex: 1 1 auto;
      }
      .tm-ambro-name-actions {
        display: inline-flex;
        gap: 6px;
        flex: 0 0 auto;
        margin-left: auto;
      }
      .tm-ambro-icon-btn {
        width: 26px;
        height: 26px;
        border-radius: 8px;
        border: 1px solid #d0d5dd;
        background: #fff;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        line-height: 1;
        color: #111827;
        padding: 0;
      }
      .tm-ambro-icon-btn:hover { background: #f8fafc; }
      .tm-ambro-icon-btn-danger { border-color: #fecdca; background: #fff5f5; }
      .tm-ambro-icon-btn-danger:hover { background: #ffe4e6; }

      @media (max-width: 900px) {
        .tm-ambro-row {
          grid-template-columns: minmax(0, 1fr) auto;
          grid-template-areas:
            "name meta"
            "qty details";
        }
        .tm-ambro-row > div:nth-child(1) { grid-area: name; }
        .tm-ambro-row > div:nth-child(2) { grid-area: meta; }
        .tm-ambro-row > div:nth-child(3) { grid-area: qty; }
        .tm-ambro-row > div:nth-child(4) { grid-area: details; justify-self: end; }
        .tm-ambro-custom-grid { grid-template-columns: 1fr; }
        .tm-ambro-carton-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
    `;
    document.head.appendChild(style);
  }

  function createModalIfNeeded(forceRecreate = false) {
    if (forceRecreate) {
      document.getElementById(MODAL_ID)?.remove();
      document.getElementById(OVERLAY_ID)?.remove();
    }
    if (document.getElementById(MODAL_ID)) return;

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.addEventListener("click", closeModal);

    const catalog = getCatalogEntries();
    const customGroups = Array.from(
      new Set(catalog.map((p) => p.group).filter((g) => g && !PRODUCT_GROUP_ORDER.includes(g) && g !== "Reszta"))
    );
    const groupsOrder = [...PRODUCT_GROUP_ORDER.filter((g) => g !== "Reszta"), ...customGroups, "Reszta"];
    const grouped = new Map(groupsOrder.map((g) => [g, []]));
    catalog.forEach(({ name, cartons, group }) => {
      const target = grouped.has(group) ? group : "Reszta";
      grouped.get(target).push([name, cartons]);
    });

    const groupedHtml = groupsOrder.map((groupName) => {
      const items = grouped.get(groupName) || [];
      if (!items.length) return "";
      return `
        <section class="tm-ambro-group" data-group-name="${escapeHtml(groupName.toLowerCase())}" data-product-group>
          <div class="tm-ambro-group-title">${escapeHtml(groupName)}</div>
          <div class="tm-ambro-list">
            ${items
              .map(([name, cartons], idx) => {
                const detailsId = `tm-ambro-details-${safeIdToken(name)}-${safeIdToken(groupName)}-${idx}`;
                return `
                  <div class="tm-ambro-item ${getProductThemeClass(name)}" data-product-row data-product-name="${escapeHtml(name.toLowerCase())}" data-product="${escapeHtml(name)}" data-details-id="${detailsId}">
                    <div class="tm-ambro-row">
                      <div>
                        <div class="tm-ambro-name-line">
                          <div class="tm-ambro-name">${escapeHtml(cleanProductTitle(name))}</div>
                          <div class="tm-ambro-name-actions">
                            <button type="button" class="tm-ambro-icon-btn" data-inline-edit aria-label="Edytuj paczki" title="Edytuj paczki">✎</button>
                            <button type="button" class="tm-ambro-icon-btn tm-ambro-icon-btn-danger" data-inline-remove aria-label="Usuń z wyboru" title="Usuń z wyboru">🗑</button>
                          </div>
                        </div>
                      </div>
                      <div class="tm-ambro-col-meta"><span data-cartons-count>${cartons.length}</span> kart.</div>
                      <div style="display:flex;justify-content:flex-end;align-items:center;">
                        <div class="tm-ambro-qty-control">
                          <button type="button" class="tm-qty-btn" data-delta="-1" data-product="${escapeHtml(name)}" aria-label="Zmniejsz ilość">−</button>
                          <input type="number" min="0" step="1" value="0" class="tm-ambro-product-qty" data-product="${escapeHtml(name)}">
                          <button type="button" class="tm-qty-btn" data-delta="1" data-product="${escapeHtml(name)}" aria-label="Zwiększ ilość">+</button>
                        </div>
                      </div>
                      <div class="tm-ambro-row-actions">
                        <button type="button" class="tm-ambro-details-toggle" data-target="${detailsId}" aria-expanded="false">Szczegóły ▾</button>
                      </div>
                    </div>
                    <div class="tm-ambro-inline-editor" data-inline-editor>
                      <div class="tm-ambro-inline-meta">Edycja dotyczy tylko bieżącego wyboru w modalu (nie zapisuje się na stałe).</div>
                      <div data-inline-cartons-wrap></div>
                      <div class="tm-ambro-custom-actions" style="margin-top:6px;">
                        <button type="button" class="tm-ambro-mini-btn" data-inline-add-carton>+ Dodaj karton</button>
                        <button type="button" class="tm-ambro-mini-btn tm-ambro-mini-btn-primary" data-inline-save>Zapisz zmiany</button>
                        <button type="button" class="tm-ambro-mini-btn" data-inline-reset disabled>Reset</button>
                        <button type="button" class="tm-ambro-mini-btn" data-inline-cancel>Zamknij</button>
                      </div>
                      <div class="tm-ambro-custom-note" style="margin-top:6px;">Pola kartonu: dł, szer, wys (m) oraz waga (kg).</div>
                    </div>
                    <div class="tm-ambro-cartons-list is-collapsed" id="${detailsId}">
                      ${cartons
                        .map((c, cidx) => `
                          <div class="tm-ambro-carton-line">
                            ${cidx + 1}: ${Math.round(c.dims[0] * 100)}×${Math.round(c.dims[1] * 100)}×${Math.round(c.dims[2] * 100)} cm / ${c.weight} kg
                          </div>
                        `)
                        .join("")}
                    </div>
                  </div>
                `;
              })
              .join("")}
          </div>
        </section>
      `;
    }).join("");

    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="tm-ambro-modal-header">
        <div class="tm-ambro-modal-title">Produkty</div>
        <button type="button" class="tm-ambro-close" id="tm-ambro-close-btn">Zamknij</button>
      </div>
      <div class="tm-ambro-modal-body">
        <input type="text" id="tm-ambro-search" class="tm-ambro-search" placeholder="Szukaj produktu...">
        <div id="tm-ambro-grid">
          ${groupedHtml}
        </div>
        <div class="tm-ambro-custom-wrap">
          <div class="tm-ambro-custom-title">+ Nowy produkt (zapis lokalny w TM)</div>
          <div class="tm-ambro-custom-grid">
            <input type="text" id="tm-ambro-new-name" class="tm-ambro-input" placeholder="Nazwa produktu">
            <select id="tm-ambro-new-group" class="tm-ambro-select">
              <option value="">Kategoria (auto)</option>
              ${groupsOrder.filter((g) => g !== "Reszta").map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("")}
              <option value="__new__">+ Nowa kategoria...</option>
            </select>
          </div>
          <div id="tm-ambro-new-group-wrap" style="display:none; margin-bottom:8px;">
            <input type="text" id="tm-ambro-new-group-name" class="tm-ambro-input" placeholder="Nazwa nowej kategorii (np. Domki Keter)">
          </div>
          <div id="tm-ambro-cartons-wrap"></div>
          <div class="tm-ambro-custom-actions">
            <button type="button" id="tm-ambro-add-carton-row" class="tm-ambro-mini-btn">+ Dodaj karton</button>
            <button type="button" id="tm-ambro-save-product" class="tm-ambro-mini-btn tm-ambro-mini-btn-primary">Zapisz produkt</button>
            <button type="button" id="tm-ambro-cancel-edit" class="tm-ambro-mini-btn" style="display:none;">Anuluj edycję</button>
            <span class="tm-ambro-custom-note">Pola kartonu: dł, szer, wys (m) oraz waga (kg).</span>
          </div>
          <div class="tm-ambro-custom-list" id="tm-ambro-custom-list"></div>
        </div>
      </div>
      <div class="tm-ambro-footer">
        <div class="tm-ambro-summary" id="tm-ambro-summary">Brak wybranych produktów</div>
        <div class="tm-ambro-actions">
          <button type="button" class="tm-ambro-btn" id="tm-ambro-clear-btn">Wyczyść</button>
          <button type="button" class="tm-ambro-btn tm-ambro-btn-primary" id="tm-ambro-add-btn">Dodaj do paczek</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    document.getElementById("tm-ambro-close-btn")?.addEventListener("click", closeModal);
    document.getElementById("tm-ambro-clear-btn")?.addEventListener("click", resetModalInputs);
    document.getElementById("tm-ambro-add-btn")?.addEventListener("click", handleAddFromModal);
    document.getElementById("tm-ambro-search")?.addEventListener("input", filterProducts);
    const groupSelect = document.getElementById("tm-ambro-new-group");
    const groupWrap = document.getElementById("tm-ambro-new-group-wrap");
    const cartonsWrap = document.getElementById("tm-ambro-cartons-wrap");
    const customListWrap = document.getElementById("tm-ambro-custom-list");
    const saveBtn = document.getElementById("tm-ambro-save-product");
    const cancelEditBtn = document.getElementById("tm-ambro-cancel-edit");
    const nameInput = document.getElementById("tm-ambro-new-name");
    const groupNewInput = document.getElementById("tm-ambro-new-group-name");
    let editingOriginalName = "";

    const renderCartonRow = (carton = null) => `
      <div class="tm-ambro-carton-row" data-carton-row>
        <input type="number" min="0" step="0.01" class="tm-ambro-input" data-carton-d1 placeholder="dł [m]" value="${carton ? escapeHtml(String(carton.dims[0])) : ""}">
        <input type="number" min="0" step="0.01" class="tm-ambro-input" data-carton-d2 placeholder="szer [m]" value="${carton ? escapeHtml(String(carton.dims[1])) : ""}">
        <input type="number" min="0" step="0.01" class="tm-ambro-input" data-carton-d3 placeholder="wys [m]" value="${carton ? escapeHtml(String(carton.dims[2])) : ""}">
        <input type="number" min="0" step="0.01" class="tm-ambro-input" data-carton-w placeholder="waga [kg]" value="${carton ? escapeHtml(String(carton.weight)) : ""}">
        <button type="button" class="tm-ambro-mini-btn" data-remove-carton>×</button>
      </div>
    `;

    if (cartonsWrap) cartonsWrap.innerHTML = renderCartonRow();

    const setEditMode = (isEdit) => {
      if (saveBtn) saveBtn.textContent = isEdit ? "Zapisz zmiany" : "Zapisz produkt";
      if (cancelEditBtn) cancelEditBtn.style.display = isEdit ? "" : "none";
    };

    const resetCustomForm = () => {
      editingOriginalName = "";
      if (nameInput) nameInput.value = "";
      if (groupSelect) groupSelect.value = "";
      if (groupNewInput) groupNewInput.value = "";
      if (groupWrap) groupWrap.style.display = "none";
      if (cartonsWrap) cartonsWrap.innerHTML = renderCartonRow();
      setEditMode(false);
    };

    const renderCustomProductsList = () => {
      if (!customListWrap) return;
      const custom = loadCustomProducts();
      if (!custom.length) {
        customListWrap.innerHTML = `<div class="tm-ambro-custom-note">Brak własnych produktów.</div>`;
        return;
      }
      customListWrap.innerHTML = custom
        .map((p) => {
          const nameEsc = escapeHtml(p.name);
          const groupEsc = escapeHtml(p.group || getProductGroup(p.name));
          const cartonsCount = Array.isArray(p.cartons) ? p.cartons.length : 0;
          return `
            <div class="tm-ambro-custom-item" data-custom-name="${nameEsc}">
              <div class="tm-ambro-custom-item-main">
                <div class="tm-ambro-custom-item-name">${nameEsc}</div>
                <div class="tm-ambro-custom-item-meta">${groupEsc} • ${cartonsCount} kart.</div>
              </div>
              <div style="display:flex;gap:6px;">
                <button type="button" class="tm-ambro-mini-btn" data-custom-edit="${nameEsc}">Edytuj</button>
                <button type="button" class="tm-ambro-mini-btn" data-custom-delete="${nameEsc}">Usuń</button>
              </div>
            </div>
          `;
        })
        .join("");
    };

    renderCustomProductsList();

    groupSelect?.addEventListener("change", () => {
      groupWrap.style.display = groupSelect.value === "__new__" ? "" : "none";
    });
    document.getElementById("tm-ambro-add-carton-row")?.addEventListener("click", () => {
      if (!cartonsWrap) return;
      cartonsWrap.insertAdjacentHTML("beforeend", renderCartonRow());
    });
    cartonsWrap?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove-carton]");
      if (!btn) return;
      const rows = cartonsWrap.querySelectorAll("[data-carton-row]");
      if (rows.length <= 1) return;
      btn.closest("[data-carton-row]")?.remove();
    });
    document.getElementById("tm-ambro-save-product")?.addEventListener("click", () => {
      const name = normalizeSpaces(document.getElementById("tm-ambro-new-name")?.value || "");
      if (!name) {
        toast("Podaj nazwę produktu.");
        return;
      }
      const groupSelected = groupSelect?.value || "";
      const groupNew = normalizeSpaces(document.getElementById("tm-ambro-new-group-name")?.value || "");
      const group = groupSelected === "__new__" ? groupNew : groupSelected;
      if (groupSelected === "__new__" && !group) {
        toast("Podaj nazwę nowej kategorii.");
        return;
      }

      const cartons = Array.from(cartonsWrap?.querySelectorAll("[data-carton-row]") || [])
        .map((row) => {
          const d1 = Number(String(row.querySelector("[data-carton-d1]")?.value || "").replace(",", "."));
          const d2 = Number(String(row.querySelector("[data-carton-d2]")?.value || "").replace(",", "."));
          const d3 = Number(String(row.querySelector("[data-carton-d3]")?.value || "").replace(",", "."));
          const w = Number(String(row.querySelector("[data-carton-w]")?.value || "").replace(",", "."));
          if (!Number.isFinite(d1) || !Number.isFinite(d2) || !Number.isFinite(d3) || !Number.isFinite(w)) return null;
          if (d1 <= 0 || d2 <= 0 || d3 <= 0 || w <= 0) return null;
          return { dims: [d1, d2, d3], weight: w };
        })
        .filter(Boolean);

      if (!cartons.length) {
        toast("Dodaj min. 1 poprawny karton.");
        return;
      }

      const custom = loadCustomProducts();
      const searchName = editingOriginalName || name;
      const idx = custom.findIndex((p) => String(p.name).toLowerCase() === searchName.toLowerCase());
      const row = { name, group, cartons };
      if (idx >= 0) custom[idx] = row;
      else custom.push(row);
      saveCustomProducts(custom);
      toast(idx >= 0 ? `Zapisano zmiany: ${name}` : `Zapisano produkt: ${name}`);
      resetCustomForm();
      renderCustomProductsList();
      createModalIfNeeded(true);
      openModal();
    });
    cancelEditBtn?.addEventListener("click", () => {
      resetCustomForm();
      toast("Anulowano edycję.");
    });
    customListWrap?.addEventListener("click", (e) => {
      const editBtn = e.target.closest("[data-custom-edit]");
      const delBtn = e.target.closest("[data-custom-delete]");
      if (!editBtn && !delBtn) return;

      const key = normalizeSpaces((editBtn || delBtn).getAttribute(editBtn ? "data-custom-edit" : "data-custom-delete") || "");
      if (!key) return;
      const custom = loadCustomProducts();
      const idx = custom.findIndex((p) => String(p.name).toLowerCase() === key.toLowerCase());
      if (idx < 0) return;

      if (editBtn) {
        const row = custom[idx];
        editingOriginalName = row.name;
        if (nameInput) nameInput.value = row.name;
        const groupVal = normalizeSpaces(row.group || "");
        const hasGroupOption = !!groupSelect?.querySelector(`option[value="${CSS.escape(groupVal)}"]`);
        if (groupSelect) groupSelect.value = hasGroupOption ? groupVal : "__new__";
        if (groupNewInput) groupNewInput.value = hasGroupOption ? "" : groupVal;
        if (groupWrap) groupWrap.style.display = !hasGroupOption && groupVal ? "" : (groupSelect?.value === "__new__" ? "" : "none");
        if (cartonsWrap) cartonsWrap.innerHTML = (row.cartons || []).map((c) => renderCartonRow(c)).join("") || renderCartonRow();
        setEditMode(true);
        toast(`Tryb edycji: ${row.name}`);
        return;
      }

      const row = custom[idx];
      const ok = window.confirm(`Usunąć produkt "${row.name}"?`);
      if (!ok) return;
      custom.splice(idx, 1);
      saveCustomProducts(custom);
      if (editingOriginalName && editingOriginalName.toLowerCase() === row.name.toLowerCase()) {
        resetCustomForm();
      }
      renderCustomProductsList();
      toast(`Usunięto: ${row.name}`);
      createModalIfNeeded(true);
      openModal();
    });

    modal.querySelectorAll(".tm-ambro-product-qty").forEach((input) => {
      input.addEventListener("input", () => {
        const v = Math.max(0, parseInt(input.value || "0", 10) || 0);
        input.value = String(v);
        updateSummary();
      });
    });
    modal.querySelectorAll(".tm-qty-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const product = btn.getAttribute("data-product") || "";
        const delta = parseInt(btn.getAttribute("data-delta") || "0", 10) || 0;
        const input = modal.querySelector(`.tm-ambro-product-qty[data-product="${CSS.escape(product)}"]`);
        if (!input) return;
        const current = Math.max(0, parseInt(input.value || "0", 10) || 0);
        input.value = String(Math.max(0, current + delta));
        updateSummary();
      });
    });
    modal.querySelectorAll(".tm-ambro-details-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.getAttribute("data-target");
        const panel = targetId ? document.getElementById(targetId) : null;
        if (!panel) return;
        const collapsed = panel.classList.toggle("is-collapsed");
        btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
        btn.textContent = collapsed ? "Szczegóły ▾" : "Szczegóły ▴";
      });
    });

    // Inline edycja kartonów w wierszu produktu.
    const inlineRenderCartonRow = (carton = null) => `
      <div class="tm-ambro-carton-row" data-inline-carton-row>
        <input type="number" min="0" step="0.01" class="tm-ambro-input" data-inline-d1 placeholder="dł [m]" value="${carton ? escapeHtml(String(carton.dims[0])) : ""}">
        <input type="number" min="0" step="0.01" class="tm-ambro-input" data-inline-d2 placeholder="szer [m]" value="${carton ? escapeHtml(String(carton.dims[1])) : ""}">
        <input type="number" min="0" step="0.01" class="tm-ambro-input" data-inline-d3 placeholder="wys [m]" value="${carton ? escapeHtml(String(carton.dims[2])) : ""}">
        <input type="number" min="0" step="0.01" class="tm-ambro-input" data-inline-w placeholder="waga [kg]" value="${carton ? escapeHtml(String(carton.weight)) : ""}">
        <button type="button" class="tm-ambro-mini-btn" data-inline-remove-carton title="Usuń karton">×</button>
      </div>
    `;

    function normalizeInlineCartons(editorEl) {
      return Array.from(editorEl.querySelectorAll("[data-inline-carton-row]"))
        .map((row) => {
          const d1 = Number(String(row.querySelector("[data-inline-d1]")?.value || "").replace(",", "."));
          const d2 = Number(String(row.querySelector("[data-inline-d2]")?.value || "").replace(",", "."));
          const d3 = Number(String(row.querySelector("[data-inline-d3]")?.value || "").replace(",", "."));
          const w = Number(String(row.querySelector("[data-inline-w]")?.value || "").replace(",", "."));
          if (!Number.isFinite(d1) || !Number.isFinite(d2) || !Number.isFinite(d3) || !Number.isFinite(w)) return null;
          if (d1 <= 0 || d2 <= 0 || d3 <= 0 || w <= 0) return null;
          return { dims: [d1, d2, d3], weight: w };
        })
        .filter(Boolean);
    }

    function updateRowCartonsMeta(rowEl, cartons) {
      const cntEl = rowEl.querySelector("[data-cartons-count]");
      if (cntEl) cntEl.textContent = String(Array.isArray(cartons) ? cartons.length : 0);
      const resetBtn = rowEl.querySelector("[data-inline-reset]");
      if (resetBtn) resetBtn.disabled = !selectionOverrides[rowEl.getAttribute("data-product") || ""];
    }

    function updateRowDetailsPanel(rowEl, cartons) {
      const detailsId = rowEl.getAttribute("data-details-id");
      const panel = detailsId ? document.getElementById(detailsId) : null;
      if (!panel) return;
      const list = Array.isArray(cartons) ? cartons : [];
      panel.innerHTML = list
        .map((c, idx) => {
          return `
            <div class="tm-ambro-carton-line">
              ${idx + 1}: ${Math.round(c.dims[0] * 100)}×${Math.round(c.dims[1] * 100)}×${Math.round(c.dims[2] * 100)} cm / ${c.weight} kg
            </div>
          `;
        })
        .join("");
    }

    modal.addEventListener("click", (e) => {
      const t = e.target;
      const row = t.closest("[data-product-row]");
      if (!row) return;
      const productName = row.getAttribute("data-product") || "";
      if (!productName) return;

      const editor = row.querySelector("[data-inline-editor]");
      const wrap = row.querySelector("[data-inline-cartons-wrap]");

      const inlineEditBtn = t.closest("[data-inline-edit]");
      if (inlineEditBtn) {
        if (!editor || !wrap) return;
        const isOpen = editor.classList.toggle("is-open");
        if (isOpen) {
          const productMap = getProductsMap();
          const cartons = getCartonsForSelection(productMap, productName) || [];
          wrap.innerHTML = (cartons.length ? cartons : [{ dims: [0, 0, 0], weight: 0 }])
            .map((c) => (c.weight > 0 ? inlineRenderCartonRow(c) : inlineRenderCartonRow(null)))
            .join("");
          const resetBtn = row.querySelector("[data-inline-reset]");
          if (resetBtn) resetBtn.disabled = !selectionOverrides[productName];
        }
        return;
      }

      const inlineCancelBtn = t.closest("[data-inline-cancel]");
      if (inlineCancelBtn) {
        editor?.classList.remove("is-open");
        return;
      }

      const inlineRemoveBtn = t.closest("[data-inline-remove]");
      if (inlineRemoveBtn) {
        const ok = window.confirm(`Usunąć "${cleanProductTitle(productName)}" z wyboru?`);
        if (!ok) return;
        const input = modal.querySelector(`.tm-ambro-product-qty[data-product="${CSS.escape(productName)}"]`);
        if (input) input.value = "0";
        delete selectionOverrides[productName];
        editor?.classList.remove("is-open");
        updateSummary();
        return;
      }

      const addCartonBtn = t.closest("[data-inline-add-carton]");
      if (addCartonBtn) {
        if (!wrap) return;
        wrap.insertAdjacentHTML("beforeend", inlineRenderCartonRow());
        return;
      }

      const removeCartonBtn = t.closest("[data-inline-remove-carton]");
      if (removeCartonBtn) {
        if (!wrap) return;
        const rows = wrap.querySelectorAll("[data-inline-carton-row]");
        if (rows.length <= 1) return;
        const ok = window.confirm("Usunąć ten karton?");
        if (!ok) return;
        removeCartonBtn.closest("[data-inline-carton-row]")?.remove();
        return;
      }

      const saveBtn = t.closest("[data-inline-save]");
      if (saveBtn) {
        if (!editor) return;
        const cartons = normalizeInlineCartons(editor);
        if (!cartons.length) {
          toast("Podaj min. 1 poprawny karton (m/kg).");
          return;
        }
        selectionOverrides[productName] = cartons;
        updateRowCartonsMeta(row, cartons);
        updateRowDetailsPanel(row, cartons);
        const resetBtn = row.querySelector("[data-inline-reset]");
        if (resetBtn) resetBtn.disabled = false;
        toast(`Zapisano paczki: ${cleanProductTitle(productName)}`);
        updateSummary();
        return;
      }

      const resetBtn = t.closest("[data-inline-reset]");
      if (resetBtn) {
        if (!selectionOverrides[productName]) return;
        const ok = window.confirm(`Zresetować paczki dla "${cleanProductTitle(productName)}"?`);
        if (!ok) return;
        delete selectionOverrides[productName];
        const productMap = getProductsMap();
        const cartons = productMap[productName] || [];
        updateRowCartonsMeta(row, cartons);
        updateRowDetailsPanel(row, cartons);
        if (wrap) {
          wrap.innerHTML = (cartons.length ? cartons : [{ dims: [0, 0, 0], weight: 0 }])
            .map((c) => (c.weight > 0 ? inlineRenderCartonRow(c) : inlineRenderCartonRow(null)))
            .join("");
        }
        resetBtn.disabled = true;
        toast(`Zresetowano paczki: ${cleanProductTitle(productName)}`);
        updateSummary();
        return;
      }
    });
  }

  function openModal() {
    createModalIfNeeded();
    document.getElementById(OVERLAY_ID).style.display = "block";
    document.getElementById(MODAL_ID).style.display = "block";
    updateSummary();
  }

  function closeModal() {
    const overlay = document.getElementById(OVERLAY_ID);
    const modal = document.getElementById(MODAL_ID);
    if (overlay) overlay.style.display = "none";
    if (modal) modal.style.display = "none";
  }

  function filterProducts() {
    const q = (document.getElementById("tm-ambro-search")?.value || "").trim().toLowerCase();
    const rows = document.querySelectorAll("[data-product-row]");
    rows.forEach((row) => {
      const name = row.getAttribute("data-product-name") || "";
      row.style.display = !q || name.includes(q) ? "" : "none";
    });

    // Ukryj całe grupy, jeśli po filtrze nie mają widocznych pozycji.
    document.querySelectorAll("[data-product-group]").forEach((groupEl) => {
      const hasVisible = Array.from(groupEl.querySelectorAll("[data-product-row]")).some((row) => row.style.display !== "none");
      groupEl.style.display = hasVisible ? "" : "none";
    });
  }

  function updateSummary() {
    const selection = collectSelectionFromModal();
    const summaryEl = document.getElementById("tm-ambro-summary");
    if (!summaryEl) return;
    const queue = buildQueueFromSelection(selection);
    const selectedCount = Object.values(selection).reduce((a, b) => a + Number(b || 0), 0);
    summaryEl.textContent = selectedCount ? `Wybrano produktów: ${selectedCount}, do dodania kartonów: ${queue.length}` : "Brak wybranych produktów";
  }

  function injectButton() {
    if (document.getElementById(BTN_ID)) return false;
    const area = getToolbarArea();
    if (!area) return false;
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.textContent = "Dodaj produkty";
    btn.addEventListener("click", openModal);
    area.appendChild(btn);

    if (!document.getElementById(STATUS_ID)) {
      const status = document.createElement("div");
      status.id = STATUS_ID;
      status.textContent = "Skrypt gotowy.";
      area.appendChild(status);
    }
    return true;
  }

  function ensureUi() {
    if (!isAmbroPackagesPage()) return;
    addStyles();
    createModalIfNeeded();
    injectButton();
  }

  function installDomObserver() {
    if (window[OBSERVER_ID]) return;
    window[OBSERVER_ID] = true;
    domObserver = new MutationObserver(() => {
      if (!document.getElementById(BTN_ID)) ensureUi();
    });
    domObserver.observe(document.body, { childList: true, subtree: true });
  }

  async function handleAddFromModal() {
    if (isRunning) return;

    // Kontrolki Ambro (DevExpress) muszą być dostępne, inaczej nie ma sensu startować.
    const required = ["IloscPaczek", "WagaPaczki", "DlugoscPaczki", "SzerokoscPaczki", "WysokoscPaczki", "ZawartoscPaczki"];
    const missing = required.filter((k) => !(page[k] && typeof page[k].SetText === "function"));
    if (missing.length) {
      setStatus("Ambro: nie widzę kontrolek paczek (odśwież stronę / przejdź do sekcji paczek).", true);
      toast(`Ambro: brak kontrolek paczek: ${missing.join(", ")}`);
      return;
    }

    const selection = collectSelectionFromModal();
    const queue = buildQueueFromSelection(selection);

    if (!queue.length) {
      setStatus("Wybierz przynajmniej 1 produkt.", true);
      return;
    }

    isRunning = true;
    closeModal();

    try {
      setStatus(`Start dodawania. Kartonów do wpisania: ${queue.length}`);

      for (let i = 0; i < queue.length; i++) {
        const pkg = queue[i];
        setStatus(`Dodawanie kartonu ${i + 1} z ${queue.length}: ${pkg.content}`);

        clearFields();
        await sleep(50);

        fillPackageFields(pkg);
        await sleep(70);

        await clickAddAndWait();
        await sleep(60);
      }

      resetModalInputs();
      ensureUi();
      setStatus(`Gotowe. Dodano ${queue.length} kartonów.`);
    } catch (err) {
      console.error(err);
      ensureUi();
      setStatus(`Błąd: ${err.message}`, true);
    } finally {
      isRunning = false;
    }
  }

  function initPackagesUi() {
    if (!isAmbroPackagesPage()) return;
    ensureUi();
    installDomObserver();
  }

  function ambroPackagesInit() {
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      initPackagesUi();
      if (tries > 40 || (document.getElementById(BTN_ID) && window[OBSERVER_ID])) clearInterval(timer);
    }, 700);
  }

  // Start modułu paczek dopiero po pełnej inicjalizacji całego pliku (PRODUCTS itd.).
  if (shouldInitAmbroPackages) {
    ambroPackagesInit();
  }
})();

