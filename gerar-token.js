import puppeteer from "puppeteer";
import fs from 'fs'

const saveCookies = async (page, path = 'cookies.json') => {
  const cookies = await page.cookies();
  fs.writeFileSync(path, JSON.stringify(cookies, null, 2));
};

const loadCookies = async (page, path = 'cookies.json') => {
  if (fs.existsSync(path)) {
    const cookies = JSON.parse(fs.readFileSync(path));
    await page.setCookie(...cookies);
    return true;
  }

  return false;
};

async function main()
{
    const browser = await puppeteer.launch({
        headless: false, // Deixe como true se não quiser ver o navegador
        defaultViewport: null,
    });

    const page = await browser.newPage();

    await loadCookies(page)

    // Loga toda navegação (para debug)
    page.on('framenavigated', frame => {
        console.log('[Navegação]:', frame.url());
    });

    // Intercepta a requisição ao endpoint de token
    page.on('request', request => {
        if (
            (request.resourceType() === 'xhr' || request.resourceType() === 'fetch') &&
            request.url().includes('/access-token')
        ) {
            console.log('[Request Interceptada]');
            console.log('URL:', request.url());
            console.log('Método:', request.method());
            console.log('Payload:', request.postData());
        }
    });

    // Intercepta a resposta do endpoint de token
    page.on('response', async response => {
        if (response.url().includes('/access-token')) {
            console.log('[Resposta Interceptada]');
            console.log('URL:', response.url());
            console.log('Status:', response.status());

            try {
                const contentType = response.headers()['content-type'] || '';
                if (contentType.includes('application/json')) {
                    const data = await response.json();
                    console.log('Resposta JSON:', data);
                    fs.writeFileSync('tokens.json', JSON.stringify(data))

                    await browser.close()
                    process.exit(0);
                } else {
                    const text = await response.text();
                    console.log('Resposta TEXT:', text);
                }
            } catch (err) {
                console.error('Erro ao ler resposta:', err);
            }
        }
    });

    // Acessa a página inicial
    const targetUrl = 'https://viabilidade.algartelecom.com.br/portalviabilidade/';
    await page.goto(targetUrl);

    // Aguarda o redirecionamento de volta após o login
    await page.waitForFunction(
        url => window.location.href === url,
        { timeout: 0 },
        targetUrl
    );
    await saveCookies(page)

    console.log('[Página voltou ao portalviabilidade]');

    // Aguarda especificamente a resposta do /access-token, se quiser garantir que pegou ela
    const tokenResponse = await page.waitForResponse(
        response =>
        response.url().includes('/access-token') &&
        response.request().method() === 'POST',
        { timeout: 60000 } // 60 segundos de timeout
    );

    const tokenBody = await tokenResponse.json();
    console.log('[Token Capturado]:', tokenBody);

    
}

main()