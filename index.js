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
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0'
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
  console.log(`Navegando a: ${url}`);
  await page.setUserAgent(getRandomUserAgent());
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

  console.log(`Extrayendo datos de: ${url}`);
  const data = await page.evaluate(() => {
    const getText = (selector) => {
      const element = document.querySelector(selector);
      return element ? element.innerText.trim() : null;
    };
    
    const getAttr = (selector, attr) => {
      const element = document.querySelector(selector);
      return element ? element.getAttribute(attr) : null;
    };

    // Función para extraer precio numérico
    const getPrice = (selector) => {
      const priceText = getText(selector);
      if (!priceText) return null;
      const price = priceText.replace(/[^\d,.-]/g, '').replace(',', '.');
      return parseFloat(price) || null;
    };

    // Función para extraer especificaciones
    const getSpecifications = () => {
      const specs = [];
      const specElements = document.querySelectorAll('.vtex-flex-layout-0-x-flexRow--productSpecificationGroup .vtex-store-components-3-x-productSpecificationText');
      specElements.forEach(spec => {
        if (spec.innerText.trim()) {
          specs.push(spec.innerText.trim());
        }
      });
      return specs.length > 0 ? specs.join(' | ') : null;
    };

    return {
      nombre: getText('h1.vtex-store-components-3-x-productNameContainer') || 
              getText('.vtex-store-components-3-x-productNameContainer') ||
              getText('h1'),
      precio: getPrice('.vtex-product-price-1-x-sellingPriceValue') ||
              getPrice('.vtex-product-price-1-x-currencyContainer') ||
              getPrice('[data-testid="price-value"]'),
      moneda: getText('.vtex-product-price-1-x-currencyContainer') || 'CLP',
      descripcion: getText('.vtex-store-components-3-x-productDescriptionText') ||
                   getText('.vtex-rich-text-0-x-paragraph') ||
                   getText('[data-testid="product-description"]'),
      especificacion: getSpecifications(),
      marca: getText('.vtex-store-components-3-x-brandName') ||
             getText('[data-testid="brand-name"]'),
      disponibilidad: getText('.vtex-product-availability-1-x-availabilityMessage') ||
                      getText('[data-testid="availability"]') ||
                      'No disponible',
      sku: getText('[data-sku]') ||
           getAttr('[data-sku]', 'data-sku') ||
           getText('.vtex-product-identifier-0-x-product-identifier__value'),
      imagen: getAttr('.vtex-store-components-3-x-productImageTag', 'src') ||
              getAttr('img[data-testid="product-image"]', 'src') ||
              getAttr('.product-image img', 'src'),
      url: window.location.href
    };
  });

  console.log(`Datos extraídos de ${url}:`, data);
  return data;
}

async function main() {
  console.log('Iniciando scraper...');
  
  // Lee URLs desde Supabase (sin filtrar por scrapeado)
  console.log('Leyendo URLs desde Supabase...');
  const { data: urls, error } = await supabase
    .from('tabla_url')
    .select('url');

  if (error) {
    console.error('Error leyendo URLs:', error);
    process.exit(1);
  }

  if (!urls || urls.length === 0) {
    console.log('No hay URLs pendientes.');
    return;
  }

  console.log(`Se encontraron ${urls.length} URLs para scrapear`);

  const browser = await puppeteer.launch({
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ],
    headless: true
  });

  // Scrapea en bloques de 100
  const blockSize = 100;
  let totalProcessed = 0;
  
  for (let i = 0; i < urls.length; i += blockSize) {
    const block = urls.slice(i, i + blockSize);
    console.log(`\nProcesando bloque ${Math.floor(i/blockSize) + 1} de ${Math.ceil(urls.length/blockSize)} (${block.length} URLs)`);

    for (const row of block) {
      const url = row.url;
      const page = await browser.newPage();
      
      try {
        const product = await scrapeProduct(page, url);

        // Guarda en Supabase con los nombres de campos correctos
        console.log(`Guardando producto en base de datos...`);
        const { error: insertError } = await supabase
          .from('tabla_productos_construmart')
          .insert([{
            product_name: product.nombre,
            price: product.precio,
            currency: product.moneda,
            description: product.descripcion,
            especification: product.especificacion,
            brand: product.marca,
            availability: product.disponibilidad,
            sku: product.sku,
            image: product.imagen,
            url: product.url
          }]);

        if (insertError) {
          console.error(`Error guardando producto ${url}:`, insertError);
        } else {
          console.log(`✅ Producto guardado exitosamente`);
          
          // Elimina la URL de la tabla de URLs después de scrapearla
          const { error: deleteError } = await supabase
            .from('tabla_url')
            .delete()
            .eq('url', url);

          if (deleteError) {
            console.error(`Error eliminando URL ${url}:`, deleteError);
          } else {
            console.log(`🗑️ URL eliminada de la tabla de URLs`);
          }
        }

        totalProcessed++;
        console.log(`Scrapeado exitosamente (${totalProcessed}/${urls.length}): ${url}`);
        
      } catch (err) {
        console.error(`❌ Error scrapeando ${url}:`, err.message);
      } finally {
        await page.close();
      }

      // Pequeña pausa entre URLs para no sobrecargar
      await sleep(1000 + Math.random() * 2000); // 1-3 segundos
    }

    // Espera entre bloques (7-8 minutos)
    if (i + blockSize < urls.length) {
      const waitMinutes = 7 + Math.random(); // Entre 7 y 8 minutos
      const waitMs = waitMinutes * 60 * 1000;
      console.log(`\n⏳ Esperando ${waitMinutes.toFixed(1)} minutos antes del siguiente bloque...`);
      await sleep(waitMs);
    }
  }

  await browser.close();
  console.log(`\n🎉 Scraping terminado. Total procesado: ${totalProcessed}/${urls.length} URLs`);
}

// Manejo de errores globales
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Ejecutar el scraper
main().catch(console.error);