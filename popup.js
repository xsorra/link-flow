const MAX_TABS = 50;
const CONFIRM_THRESHOLD = 50;
const AUTO_CLEAR_MS = 1800;

const inputEl = document.getElementById("input");
const pasteBtn = document.getElementById("pasteBtn");
const openBtn = document.getElementById("openBtn");
const statusEl = document.getElementById("status");
const linksListEl = document.getElementById("linksList");

// Stores the last pasted HTML clipboard payload (where Google Docs keeps real hrefs)
let lastPastedHTML = "";

/**
 * KEY FIX:
 * When user pastes into textarea, capture text/html from clipboard.
 * Google Docs hyperlinks are in text/html <a href="...">, not in text/plain.
 */
inputEl.addEventListener("paste", (e) => {
  try {
    const html = e.clipboardData?.getData("text/html") || "";
    const text = e.clipboardData?.getData("text/plain") || "";

    // Save HTML payload for href extraction
    lastPastedHTML = html;

    // Put plain text into textarea for user visibility
    e.preventDefault();
    inputEl.value = text;

    const links = extractLinks({ text, html: lastPastedHTML });
    renderLinks(links);

    setStatus(
      links.length
        ? `Captured paste. Found ${links.length} link(s).`
        : "Captured paste. No web links found yet.",
      links.length ? "success" : "info"
    );
  } catch {
    // If anything fails, let the default paste happen
  }
});

pasteBtn.addEventListener("click", async () => {
  // Reads clipboard directly (works even if user doesn't manually paste)
  try {
    setStatus("Reading clipboard…", "info");

    let text = "";
    let html = "";

    // Try rich clipboard first
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes("text/html")) {
          const blob = await item.getType("text/html");
          html = await blob.text();
        }
        if (item.types.includes("text/plain")) {
          const blob = await item.getType("text/plain");
          text = await blob.text();
        }
      }
    } catch {
      // Fallback to plain text
      text = await navigator.clipboard.readText();
    }

    inputEl.value = text || "";
    lastPastedHTML = html || "";

    const links = extractLinks({ text: inputEl.value, html: lastPastedHTML });
    renderLinks(links);

    setStatus(
      links.length
        ? `Pasted from clipboard. Found ${links.length} link(s).`
        : "Pasted from clipboard. No web links found.",
      links.length ? "success" : "info"
    );
  } catch {
    setStatus("Clipboard read blocked. Paste manually (Cmd/Ctrl+V).", "error");
  }
});

openBtn.addEventListener("click", async () => {
  try {
    const text = inputEl.value || "";
    const html = lastPastedHTML || "";

    const links = extractLinks({ text, html });
    renderLinks(links);

    if (!links.length) {
      setStatus(
        "No links found. In Google Docs, links are in the HTML clipboard — paste into this box first, then click Extract.",
        "error"
      );
      return;
    }

    if (links.length >= CONFIRM_THRESHOLD) {
      const ok = confirm(`Open ${links.length} tabs?`);
      if (!ok) {
        setStatus("Canceled.", "info");
        return;
      }
    }

    const toOpen = links.slice(0, MAX_TABS);
    for (const url of toOpen) {
      chrome.tabs.create({ url, active: false });
    }

    setStatus(
      toOpen.length < links.length
        ? `Opened ${toOpen.length} of ${links.length} (limit ${MAX_TABS}).`
        : `Opened ${toOpen.length} tab(s).`,
      "success"
    );
  } catch (e) {
    setStatus(`Error: ${e?.message || String(e)}`, "error");
  }
});

/**
 * Extract links from:
 * 1) HTML clipboard (<a href="...">)  ✅ fixes Google Docs
 * 2) Plain text URLs (https://..., www..., domain.tld/...) fallback
 *
 * Also avoids filename-only junk like "001.jpg"
 */
function extractLinks({ text, html }) {
  const urls = [];

  // 1) From HTML anchors
  if (html && html.includes("href")) {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const anchors = Array.from(doc.querySelectorAll("a[href]"));
      for (const a of anchors) {
        const href = a.getAttribute("href") || "";
        if (href) urls.push(href);
      }
    } catch {
      // ignore html parse errors
    }
  }

  // 2) From plain text (fallback)
  const textCandidates = extractFromText(text);
  urls.push(...textCandidates);

  // Normalize + validate + dedupe
  const seen = new Set();
  const out = [];

  for (let u of urls) {
    u = (u || "").trim();

    // Clean common punctuation
    u = u.replace(/^[("'[\{]+/g, "").replace(/[)\]}\>.,;:"'!?]+$/g, "");

    // Some apps put Google redirect links; still valid.
    if (!/^https?:\/\//i.test(u) && /^www\./i.test(u)) {
      u = "https://" + u;
    }

    // Only accept http(s)
    try {
      const url = new URL(u);

      if (!["http:", "https:"].includes(url.protocol)) continue;

      // Reject "https://001.jpg" type junk (hostname must contain letters + a real TLD)
      if (!/[a-z]/i.test(url.hostname)) continue;
      if (!/\.[a-z]{2,}$/i.test(url.hostname)) continue;

      const href = url.href;
      if (seen.has(href)) continue;

      seen.add(href);
      out.push(href);
    } catch {
      // ignore invalid
    }
  }

  return out;
}

function extractFromText(text) {
  // Requires at least one letter in hostname, and a TLD (so "001.jpg" won't match)
  const re =
    /((https?:\/\/)[^\s<>"']+)|(\b(?:www\.)?[a-z0-9-]*[a-z][a-z0-9-]*\.[a-z]{2,}(?:\.[a-z]{2,})?(?:\/[^\s<>"']*)?)/gi;

  const raw = (text || "").match(re) || [];

  return raw.map((s) => {
    s = s.trim().replace(/^[("'[\{]+/g, "").replace(/[)\]}\>.,;:"'!?]+$/g, "");
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;
    return s;
  });
}

function renderLinks(links) {
  if (!linksListEl) return;

  if (!links.length) {
    linksListEl.style.display = "none";
    linksListEl.innerHTML = "";
    return;
  }

  linksListEl.style.display = "block";
  linksListEl.innerHTML = `<div style="font-weight:700; margin-bottom:10px;">Found ${links.length} link(s)</div>`;

  for (const link of links) {
    const div = document.createElement("div");
    div.className = "link-item";
    div.textContent = link;
    linksListEl.appendChild(div);
  }
}

function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = type || "info";

  clearTimeout(setStatus._t);
  setStatus._t = setTimeout(() => {
    statusEl.textContent = "Ready. Paste from Docs, then click Extract.";
    statusEl.className = "info";
  }, AUTO_CLEAR_MS);
}
