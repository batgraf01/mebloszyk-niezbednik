// ==UserScript==
// @name         Mebloszyk
// @namespace    mebloszyk-mag1
// @version      0.3.2
// @description  Kopiuje dane zamówienia z SellRocket do Niezbędnika; auto‑kopiowanie i auto‑otwarcie pierwszego wyniku tylko po starcie z Zgłoszeń (mr_q).
// @match        https://suuhouse.enterprise.sellrocket.pl/unified-orders*
// @match        https://suuhouse.enterprise.sellrocket.pl/unified-orders/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// ==/UserScript==

(() => {
  "use strict";

  const AUTO_RETURN_ENABLED = true;
  const AUTO_RETURN_DELAY_MS = 1000;

  const KEYS = {
    pendingSearch: "mr_pending_search",
    returnUrl: "mr_return_url",
    lastOrder: "mr_last_order",
    lastAppliedAt: "mr_last_applied_at",
    autoCopySession: "mr_autocopy_session",
  };

  const COPY_BTN_ID = "mr-copy-btn";
  const STATE = { lastPath: location.pathname };

  const nowIso = () => new Date().toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const isSellrocket = () => location.hostname.endsWith("sellrocket.pl");
  const isSellrocketOrderView = () => /\/unified-orders\/\d+/.test(location.pathname);

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === "style" && typeof v === "object") Object.assign(node.style, v);
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, String(v));
    });
    for (const c of children) node.append(c);
    return node;
  }

  function setNativeValue(element, value) {
    if (!element) return;
    const valueSetter = Object.getOwnPropertyDescriptor(element, "value")?.set;
    const proto = Object.getPrototypeOf(element);
    const protoSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (protoSetter && valueSetter !== protoSetter) protoSetter.call(element, value);
    else if (valueSetter) valueSetter.call(element, value);
    else element.value = value;
  }

  function toast(msg) {
    const t = el("div", {
      style: {
        position: "fixed",
        right: "16px",
        bottom: "16px",
        zIndex: 999999,
        background: "#111827",
        color: "#fff",
        padding: "10px 12px",
        borderRadius: "10px",
        boxShadow: "0 8px 28px rgba(0,0,0,.35)",
        font: "13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Arial",
        maxWidth: "360px",
      },
    }, [msg]);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  function fullscreenNotice(message) {
    const overlay = el("div", {
      style: {
        position: "fixed",
        inset: 0,
        zIndex: 1000000,
        background: "rgba(0,0,0,.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "24px",
        cursor: "pointer",
      },
    });
    const text = el("div", {
      style: {
        color: "#fff",
        font: "600 32px/1.25 system-ui,-apple-system,Segoe UI,Roboto,Arial",
        letterSpacing: "0.2px",
        textShadow: "0 10px 40px rgba(0,0,0,.6)",
        maxWidth: "900px",
        userSelect: "none",
      },
    }, [message]);
    overlay.appendChild(text);
    document.body.appendChild(overlay);
    return () => overlay.remove();
  }

  function normalizeSpaces(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  function cleanValue(v) {
    v = normalizeSpaces(v);
    if (!v || v === "-" || v === "--" || v === "..." || v === "…") return "";
    return v;
  }

  function findValueByLabelText(labelText) {
    const label = normalizeSpaces(labelText).toLowerCase();
    const candidates = Array.from(document.querySelectorAll("div,span,td,th,dt,strong,b,small,label"));
    for (const c of candidates) {
      const t = normalizeSpaces(c.textContent).toLowerCase();
      if (!t) continue;
      if (t === label || t === `${label}:`) {
        const sibling = c.nextElementSibling;
        if (sibling && normalizeSpaces(sibling.textContent)) return normalizeSpaces(sibling.textContent);
        const row = c.closest("tr,dl,div");
        if (row) {
          const texts = Array.from(row.querySelectorAll("div,span,td,dd"))
            .map((n) => normalizeSpaces(n.textContent)).filter(Boolean);
          const filtered = texts.filter((x) => normalizeSpaces(x).toLowerCase() !== t);
          if (filtered.length) return filtered.sort((a, b) => b.length - a.length)[0];
        }
      }
    }
    return "";
  }

  function extractNameFromRjsfRows(container) {
    const scope = container || document;
    const rows = Array.from(scope.querySelectorAll(".rjsf-form-row"));
    let firstName = "";
    let lastName = "";
    for (const row of rows) {
      const label = normalizeSpaces(
        row.querySelector(".css-qryf0i")?.textContent ||
        row.querySelector(".rjsf-form-row-left")?.textContent || ""
      );
      const value = normalizeSpaces(
        row.querySelector(".rjsf-form-row-value")?.textContent ||
        row.querySelector(".rjsf-form-row-right")?.textContent || ""
      );
      if (!label || !value) continue;
      if (!firstName && /^imię/i.test(label)) firstName = cleanValue(value);
      if (!lastName && /^nazwisko/i.test(label)) lastName = cleanValue(value);
    }
    return normalizeSpaces([firstName, lastName].filter(Boolean).join(" "));
  }

  function sellrocketListUrl() {
    return "https://suuhouse.enterprise.sellrocket.pl/unified-orders?includeLineItemsElasticFields=true&orderBy=DateInStatus&orderDir=Descending";
  }

  function getIncomingQuery() {
    const params = new URLSearchParams(location.search || "");
    const fromQuery = params.get("mr_q");
    if (fromQuery) {
      try { return decodeURIComponent(fromQuery); } catch { return fromQuery; }
    }
    const h = (location.hash || "").trim();
    const m = h.match(/mr_q=([^&]+)/i);
    if (m) {
      try { return decodeURIComponent(m[1]); } catch { return m[1]; }
    }
    return "";
  }

  function ensureSearchParams(q) {
    const params = new URLSearchParams(location.search || "");
    const needsParams = !params.get("buyer.email") && !params.get("buyer.username");
    if (!needsParams) return false;

    params.set("operator", "OR");
    params.set("buyer.username", q);
    params.set("buyer.email", q);
    params.set("delivery.recipient.firstLastCompanyName", q);
    params.set("source.platformOrderId", q);
    params.set("shipmentsTrackingNumber", q);
    params.set("orderBy", params.get("orderBy") || "DateInStatus");
    params.set("orderDir", params.get("orderDir") || "Descending");
    params.set("includeLineItemsElasticFields", "true");
    params.delete("mr_q");

    const next = `${location.pathname}?${params.toString()}`;
    const current = `${location.pathname}${location.search}`;
    if (next !== current) {
      location.replace(next);
      return true;
    }
    return false;
  }

  // === KLUCZOWA FUNKCJA ===
  // Zwraca true tylko gdy była sesja z Niezbędnika (mr_q lub pendingSearch) – wtedy wolno auto‑otwierać pierwszy wynik.
  async function sellrocketMaybeAutoSearch() {
    const fromHash = getIncomingQuery();
    const pending = GM_getValue(KEYS.pendingSearch, null);
    const q = normalizeSpaces(fromHash || (pending && pending.q) || "");
    if (!q) return false;

    // Ustawiamy flagę sesji od razu, żeby nie zginęła przy redirectach
    GM_setValue(KEYS.autoCopySession, "1");
    GM_deleteValue(KEYS.pendingSearch);
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);

    if (isSellrocketOrderView()) return true;

    if (ensureSearchParams(q)) return true; // redirect – strona się przeładuje

    toast(`Próba wyszukania w Rakiecie: ${q}`);

    for (let i = 0; i < 40; i++) {
      const input = document.querySelector(
        "[data-testid='globalSearch_input'] input, input[placeholder*='Szukaj' i], input[type='search'], input[type='text']"
      );
      const btn =
        document.querySelector("[data-testid='globalSearch_searchBtn']") ||
        Array.from(document.querySelectorAll("button")).find((b) => /szukaj/i.test(b.textContent || ""));

      const form = input && input.closest("form");
      const submitBtn = form && form.querySelector("button[type='submit']");

      if (input && btn) {
        input.focus();
        setNativeValue(input, q);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        btn.click();
        return true;
      }

      if (input && submitBtn) {
        input.focus();
        setNativeValue(input, q);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        submitBtn.click();
        return true;
      }

      if (input) {
        input.focus();
        setNativeValue(input, q);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        return true;
      }

      await sleep(500);
    }

    toast("Nie znalazłem pola wyszukiwania w Rakiecie. Wyszukaj ręcznie.");
    return true;
  }

  function sellrocketExtractOrder() {
    const orderIdFromUrl = location.pathname.split("/").pop() || "";
    const headerText = normalizeSpaces(
      document.querySelector("h1, h2, .title")?.textContent || document.body.textContent || ""
    );
    const orderId = orderIdFromUrl || (headerText.match(/\b\d{4,}\b/)?.[0] ?? "");

    const email = cleanValue(findValueByLabelText("E-mail") || findValueByLabelText("Email"));
    const phone = cleanValue(findValueByLabelText("Telefon"));
    let fullName = cleanValue(findValueByLabelText("Klient (Login)") || findValueByLabelText("Klient"));

    if (!fullName) {
      const deliveryHeading = Array.from(
        document.querySelectorAll("h1,h2,h3,h4,div,span,strong,b")
      ).find((el) => normalizeSpaces(el.textContent).toLowerCase() === "dane dostawy");
      const deliveryContainer = deliveryHeading?.closest("section,div,article") || null;
      fullName = cleanValue(extractNameFromRjsfRows(deliveryContainer));
    }

    if (!fullName) fullName = cleanValue(extractNameFromRjsfRows(document));

    if (!fullName) {
      const firstName = cleanValue(findValueByLabelText("Imię"));
      const lastName = cleanValue(findValueByLabelText("Nazwisko"));
      fullName = normalizeSpaces([firstName, lastName].filter(Boolean).join(" "));
    }

    const purchaseDate = (() => {
      const top = normalizeSpaces(document.querySelector("header, .header, .page-header, body")?.textContent || "");
      const m = top.match(/\b\d{2}\.\d{2}\.\d{4}\b(?:\s+\d{2}:\d{2}:\d{2})?/);
      return m ? m[0] : "";
    })();

    return { source: "sellrocket", capturedAt: nowIso(), orderId, email, phone, fullName, purchaseDate, url: location.href };
  }

  function buildReturnUrlWithData(data) {
    try {
      const url = new URL("https://mebloszyk.pl/reklamacje");
      url.searchParams.set("mr_name", data.fullName || "");
      url.searchParams.set("mr_email", data.email || "");
      url.searchParams.set("mr_phone", data.phone || "");
      url.searchParams.set("mr_order", data.orderId || "");
      url.searchParams.set("mr_date", data.purchaseDate || "");
      return url.toString();
    } catch {
      return "";
    }
  }

  function afterCopyNavigateIfEnabled(data) {
    const url = buildReturnUrlWithData(data);
    if (!AUTO_RETURN_ENABLED || !url) return;
    const cleanup = fullscreenNotice("Skopiowano.\nWracam do Niezbędnika…");
    setTimeout(() => {
      cleanup();
      location.href = url;
    }, AUTO_RETURN_DELAY_MS);
  }

  function copyOrderToClipboard(data) {
    GM_setValue(KEYS.lastOrder, data);
    GM_setClipboard(JSON.stringify(data), "text");
  }

  function sellrocketInjectCopyButton() {
    if (!isSellrocketOrderView()) return;
    if (document.getElementById(COPY_BTN_ID)) return;

    const btn = el("button", {
      id: COPY_BTN_ID,
      type: "button",
      style: {
        position: "fixed",
        top: "84px",
        right: "24px",
        zIndex: 999999,
        padding: "10px 12px",
        borderRadius: "10px",
        border: "1px solid rgba(0,0,0,.15)",
        background: "#7c3aed",
        color: "#fff",
        cursor: "pointer",
        font: "13px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Arial"
      }
    }, ["Zgłoszenie: kopiuj dane"]);

    btn.addEventListener("click", () => {
      const data = sellrocketExtractOrder();
      copyOrderToClipboard(data);
      afterCopyNavigateIfEnabled(data);
    });

    document.body.appendChild(btn);
  }

  // Auto‑kopiowanie tylko, gdy sesja przyszła z Zgłoszeń
  function autoCopyOnOrderView() {
    if (!isSellrocketOrderView()) return;

    const autoFlag = GM_getValue(KEYS.autoCopySession, null);
    if (!autoFlag) return; // normalna praca w Rakiecie – nic nie robimy

    GM_deleteValue(KEYS.autoCopySession); // jednorazowe

    setTimeout(() => {
      const data = sellrocketExtractOrder();
      if (!data || (!data.email && !data.phone && !data.orderId)) {
        toast("Nie udało się automatycznie zczytać zamówienia. Użyj przycisku „Zgłoszenie: kopiuj dane”.");
        return;
      }
      copyOrderToClipboard(data);
      afterCopyNavigateIfEnabled(data);
    }, 1000);
  }

  // Otwiera pierwszy wynik na liście – tylko gdy użytkownik przyszedł z Niezbędnika (hadQuery).
  function autoOpenFirstResult() {
    if (isSellrocketOrderView()) return;
    const links = Array.from(document.querySelectorAll("a[href*='/unified-orders/']"));
    if (!links.length) return;
    links[0].click();
  }

  async function main() {
    if (!isSellrocket()) return;

    const hadQuery = await sellrocketMaybeAutoSearch(); // true tylko gdy start z Zgłoszeń (mr_q)
    sellrocketInjectCopyButton();

    if (isSellrocketOrderView()) {
      setTimeout(autoCopyOnOrderView, 600);
    } else {
      // Auto‑otwarcie pierwszego zamówienia tylko po wejściu z Niezbędnika (wyszukiwanie)
      if (hadQuery) setTimeout(autoOpenFirstResult, 800);
    }
  }

  setTimeout(() => { main().catch(console.error); }, 700);

  // SPA navigation
  setInterval(() => {
    if (!isSellrocket()) return;
    if (STATE.lastPath !== location.pathname) {
      STATE.lastPath = location.pathname;
      main().catch(console.error);
    }
  }, 500);
})();
