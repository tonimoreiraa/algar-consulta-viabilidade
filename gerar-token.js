import puppeteer from "puppeteer";
import fs from "fs";

const COOKIE_PATH = "cookies.json";
const TOKEN_PATH = "tokens.json";
const TARGET_URL = "https://viabilidade.algartelecom.com.br/portalviabilidade/";
const TOKEN_ENDPOINT_SUBSTR = "/access-token"; // ajuste se necessário

/* --- util cookies --- */
async function saveCookies(page, path = COOKIE_PATH) {
  const cookies = await page.cookies();
  fs.writeFileSync(path, JSON.stringify(cookies, null, 2), "utf8");
  return cookies;
}

async function loadCookies(page, path = COOKIE_PATH, { verbose = false } = {}) {
  if (!fs.existsSync(path)) {
    if (verbose) console.log("[cookies] arquivo não encontrado:", path);
    return false;
  }
  try {
    const raw = fs.readFileSync(path, "utf8");
    const cookies = JSON.parse(raw);
    if (!Array.isArray(cookies)) throw new Error("cookies inválidos (não é array)");
    // set individualmente p/ evitar falha geral
    for (const c of cookies) {
      try {
        await page.setCookie(c);
      } catch (err) {
        if (verbose) console.warn("[cookies] falha ao aplicar cookie:", c.name, err?.message);
      }
    }
    if (verbose) console.log(`[cookies] carregados ${cookies.length}.`);
    return true;
  } catch (err) {
    console.error("[cookies] erro lendo cookies:", err);
    return false;
  }
}

/* --- persistência de tokens --- */
function saveTokenData(data, path = TOKEN_PATH) {
  const payload = {
    ...data,
    received_at: new Date().toISOString(),
  };
  fs.writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

/* --- esperar URL com tolerância --- */
async function waitForReturnToPortal(page, timeoutMs = 0) {
  // aceita querystring ou path adicional
  const pattern = new RegExp("^" + TARGET_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  await page.waitForFunction(
    (reStr) => {
      const re = new RegExp(reStr);
      return re.test(window.location.href);
    },
    { timeout: timeoutMs },
    pattern.source
  );
}

/* --- principal --- */
export async function gerarToken({ headless = false, debug = true, waitManualLogin = true, tokenTimeoutMs = 60000 } = {}) {
  const browser = await puppeteer.launch({
    headless,
    defaultViewport: null,
  });

  let tokenCaptured = null; // será preenchido quando interceptarmos
  const page = await browser.newPage();

  // registra listeners *antes* do goto
  if (debug) {
    page.on("framenavigated", (frame) => {
      console.log("[Nav]:", frame.url());
    });
  }

  page.on("request", (request) => {
    if (request.url().includes(TOKEN_ENDPOINT_SUBSTR)) {
      if (debug) {
        console.log("[Token Request]");
        console.log("URL:", request.url());
        console.log("Método:", request.method());
        try {
          console.log("Payload:", request.postData());
        } catch { /* ignore */ }
      }
    }
  });

  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes(TOKEN_ENDPOINT_SUBSTR)) return;
    if (debug) console.log("[Token Response]", url, response.status());

    try {
      const ct = response.headers()["content-type"] ?? "";
      let data;
      if (ct.includes("application/json")) {
        data = await response.json();
      } else {
        const txt = await response.text();
        try {
          data = JSON.parse(txt);
        } catch {
          data = { raw: txt };
        }
      }
      tokenCaptured = data;
      saveTokenData(data);
      if (debug) console.log("[Token Capturado]", data);
    } catch (err) {
      console.error("[token] erro lendo resposta:", err);
    }
  });

  // tenta carregar cookies antes de navegar
  await loadCookies(page, COOKIE_PATH, { verbose: debug });

  // vai pro portal
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });

  // Se o portal exigir login e os cookies não funcionarem:
  // Você pode inserir lógica aqui para detectar login page.
  if (waitManualLogin) {
    if (debug) console.log("[login] aguardando retorno ao portal...");
    await waitForReturnToPortal(page, 0); // sem timeout = aguarda indefinidamente até login manual
  } else {
    // apenas aguardar carregamento inicial
    await page.waitForTimeout(5000);
  }

  // cookies pós-login
  await saveCookies(page, COOKIE_PATH);
  if (debug) console.log("[cookies] salvos após login.");

  // espera uma resposta de token (caso ainda não tenha sido capturada pelos listeners)
  if (!tokenCaptured) {
    if (debug) console.log("[token] aguardando resposta /access-token direta...");
    try {
      const resp = await page.waitForResponse(
        (r) => r.url().includes(TOKEN_ENDPOINT_SUBSTR) && ["POST", "GET"].includes(r.request().method()),
        { timeout: tokenTimeoutMs }
      );
      const data = await resp.json().catch(async () => {
        try {
          return JSON.parse(await resp.text());
        } catch {
          return { raw: await resp.text() };
        }
      });
      tokenCaptured = data;
      saveTokenData(data);
      if (debug) console.log("[token] capturado via waitForResponse", data);
    } catch (err) {
      console.warn("[token] timeout aguardando /access-token:", err?.message || err);
    }
  }

  await browser.close();
  return tokenCaptured;
}

/* Execução direta (node script) */
if (import.meta.url === `file://${process.argv[1]}`) {
  gerarToken().then((data) => {
    console.log("Token final:", data);
    process.exit(0);
  }).catch((err) => {
    console.error("Falha gerarToken:", err);
    process.exit(1);
  });
}