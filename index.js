require('dotenv').config();
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

// Configuración Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// User-Agents para rotar
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0'
];

function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// Espera en ms
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Scraping de un solo producto
async function scrapeProduct(page, url) {
  await page.setUserAgent(getRandomUserAgent());
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

  // Ajusta los selectores según tu HTML real
  const data = await page.evaluate(() => {
    const getText = (selector) => document.querySelector(selector)?.innerText?.trim() || null;
    const getAttr = (selector, attr) => document.querySelector(selector)?.getAttribute(attr) || null;

    return {
      nombre: getText('h1.vtex-store-components-3-x-productNameContainer'),
      precio: getText('.vtex-product-price-1-x-sellingPriceValue'),
      moneda: getText('.vtex-product-price-1-x-currencyContainer'),
      descripcion: getText('.vtex-store-components-3-x-productDescriptionText'),
      marca: getText('.vtex-store-components-3-x-brandName'),
      disponibilidad: getText('.vtex-product-availability-1-x-availabilityMessage'),
      sku: getText('[data-sku]'),
      imagen: getAttr('.vtex-store-components-3-x-productImageTag', 'src'),
      url: window.location.href
    };
  });

  return data;
}

async function main() {
  // Lee URLs desde Supabase
  const { data: urls, error } = await supabase
    .from('tabla_url')
    .select('url')
    .eq('scrapeado', false);

  if (error) {
    console.error('Error leyendo URLs:', error);
    process.exit(1);
  }

  if (!urls || urls.length === 0) {
    console.log('No hay URLs pendientes.');
    return;
  }

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  // Scrapea en bloques de 100
  const blockSize = 100;
  for (let i = 0; i < urls.length; i += blockSize) {
    const block = urls.slice(i, i + blockSize);

    for (const row of block) {
      const url = row.url;
      const page = await browser.newPage();
      try {
        const product = await scrapeProduct(page, url);

        // Guarda en Supabase
        await supabase.from('tabla_productos_construmart').insert([product]);
        // Marca como scrapeado
        await supabase.from('tabla_url').update({ scrapeado: true }).eq('url', url);

        console.log(`Scrapeado: ${url}`);
      } catch (err) {
        console.error(`Error en ${url}:`, err);
      } finally {
        await page.close();
      }
    }

    if (i + blockSize < urls.length) {
      // Espera 7-8 minutos (elige aleatorio entre 420000 y 480000 ms)
      const wait = 420000 + Math.floor(Math.random() * 60000);
      console.log(`Esperando ${Math.round(wait / 60000)} minutos antes del siguiente bloque...`);
      await sleep(wait);
    }
  }

  await browser.close();
  console.log('Scraping terminado.');
}

main();