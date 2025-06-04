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

// Función para limpiar memoria
function forceGarbageCollection() {
  if (global.gc) {
    global.gc();
  }
}

// Scraping de un solo producto con reintentos
async function scrapeProduct(page, url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Navegando a: ${url} (intento ${attempt}/${retries})`);
      
      // Configurar página para ser más ligera
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const resourceType = req.resourceType();
        if (['stylesheet', 'font', 'image'].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.setUserAgent(getRandomUserAgent());
      await page.setViewport({ width: 1366, height: 768 });
      
      // Navegar con timeout más corto
      await page.goto(url, { 
        waitUntil: 'domcontentloaded', 
        timeout: 45000 
      });

      // Esperar un poco para que cargue el contenido dinámico
      await sleep(2000);

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

        // Función para extraer especificaciones mejorada
        const getSpecifications = () => {
          const specs = [];
          
          // Múltiples selectores para especificaciones
          const specSelectors = [
            '.vtex-flex-layout-0-x-flexRow--productSpecificationGroup .vtex-store-components-3-x-productSpecificationText',
            '.vtex-store-components-3-x-productSpecificationText',
            '[data-testid="product-specifications"] li',
            '.product-specifications li'
          ];

          for (const selector of specSelectors) {
            const specElements = document.querySelectorAll(selector);
            if (specElements.length > 0) {
              specElements.forEach(spec => {
                const text = spec.innerText.trim();
                if (text && !specs.includes(text)) {
                  specs.push(text);
                }
              });
              break; // Si encontró especificaciones, no buscar en otros selectores
            }
          }
          
          return specs.length > 0 ? specs.join(' | ') : null;
        };

        // Función para extraer marca con selector específico
        const getBrand = () => {
          const brandSelectors = [
            '.vtex-store-components-3-x-productBrandName',
            '.vtex-store-components-3-x-brandName',
            '[data-testid="brand-name"]',
            '.product-brand'
          ];

          for (const selector of brandSelectors) {
            const brand = getText(selector);
            if (brand) return brand;
          }
          return null;
        };

        // Función para extraer disponibilidad con selector específico
        const getAvailability = () => {
          const availabilitySelectors = [
            '.construmartcl-custom-apps-0-x-stockBalanceQuantity',
            '.vtex-product-availability-1-x-availabilityMessage',
            '[data-testid="availability"]',
            '.product-availability'
          ];

          for (const selector of availabilitySelectors) {
            const availability = getText(selector);
            if (availability) return availability;
          }
          return 'No disponible';
        };

        return {
          nombre: getText('h1.vtex-store-components-3-x-productNameContainer') || 
                  getText('.vtex-store-components-3-x-productNameContainer') ||
                  getText('h1') ||
                  getText('.product-name'),
          precio: getPrice('.vtex-product-price-1-x-sellingPriceValue') ||
                  getPrice('.vtex-product-price-1-x-currencyContainer') ||
                  getPrice('[data-testid="price-value"]') ||
                  getPrice('.price'),
          moneda: getText('.vtex-product-price-1-x-currencyContainer') || 
                  getText('.currency') || 
                  'CLP',
          descripcion: getText('.vtex-store-components-3-x-productDescriptionText') ||
                       getText('.vtex-rich-text-0-x-paragraph') ||
                       getText('[data-testid="product-description"]') ||
                       getText('.product-description'),
          especificacion: getSpecifications(),
          marca: getBrand(),
          disponibilidad: getAvailability(),
          sku: getText('[data-sku]') ||
               getAttr('[data-sku]', 'data-sku') ||
               getText('.vtex-product-identifier-0-x-product-identifier__value') ||
               getText('.product-sku'),
          imagen: getAttr('.vtex-store-components-3-x-productImageTag', 'src') ||
                  getAttr('img[data-testid="product-image"]', 'src') ||
                  getAttr('.product-image img', 'src') ||
                  getAttr('img[alt*="product"]', 'src'),
          url: window.location.href
        };
      });

      console.log(`Datos extraídos de ${url}:`, {
        ...data,
        descripcion: data.descripcion ? `${data.descripcion.substring(0, 100)}...` : null
      });
      
      return data;

    } catch (error) {
      console.error(`Error en intento ${attempt} para ${url}:`, error.message);
      if (attempt === retries) {
        throw error;
      }
      await sleep(2000 * attempt); // Espera progresiva entre reintentos
    }
  }
}

// Función para guardar progreso
async function saveProgress(processed, total, currentUrl = null) {
  const progress = {
    processed,
    total,
    percentage: Math.round((processed / total) * 100),
    current_url: currentUrl,
    timestamp: new Date().toISOString()
  };
  
  console.log(`📊 Progreso: ${progress.processed}/${progress.total} (${progress.percentage}%)`);
  
  // Opcional: guardar progreso en una tabla de logs
  try {
    await supabase.from('scraper_logs').insert([progress]);
  } catch (error) {
    // Si la tabla no existe, solo mostrar en consola
    console.log('Log de progreso:', progress);
  }
}

async function main() {
  console.log('🚀 Iniciando scraper robusto...');
  
  // Configuración más conservadora para Railway
  const blockSize = 25; // Bloques más pequeños
  const maxRetries = 3;
  const delayBetweenUrls = 2000; // 2 segundos entre URLs
  const delayBetweenBlocks = 5 * 60 * 1000; // 5 minutos entre bloques
  
  // Lee URLs desde Supabase
  console.log('📖 Leyendo URLs desde Supabase...');
  const { data: urls, error } = await supabase
    .from('tabla_url')
    .select('url')
    .limit(500); // Limitar a 500 URLs por ejecución

  if (error) {
    console.error('❌ Error leyendo URLs:', error);
    process.exit(1);
  }

  if (!urls || urls.length === 0) {
    console.log('✅ No hay URLs pendientes.');
    return;
  }

  console.log(`📋 Se encontraron ${urls.length} URLs para scrapear`);

  // Configuración optimizada de Puppeteer para Railway
  const browser = await puppeteer.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--memory-pressure-off'
    ],
    headless: true,
    defaultViewport: { width: 1366, height: 768 }
  });

  let totalProcessed = 0;
  let totalErrors = 0;
  
  try {
    for (let i = 0; i < urls.length; i += blockSize) {
      const block = urls.slice(i, i + blockSize);
      const blockNumber = Math.floor(i/blockSize) + 1;
      const totalBlocks = Math.ceil(urls.length/blockSize);
      
      console.log(`\n🔄 Procesando bloque ${blockNumber}/${totalBlocks} (${block.length} URLs)`);

      for (let j = 0; j < block.length; j++) {
        const row = block[j];
        const url = row.url;
        let page = null;
        
        try {
          page = await browser.newPage();
          
          // Configurar límites de memoria para la página
          await page.setDefaultTimeout(30000);
          await page.setDefaultNavigationTimeout(45000);
          
          const product = await scrapeProduct(page, url, maxRetries);

          // Validar que tenemos datos mínimos
          if (!product.nombre && !product.precio) {
            throw new Error('No se pudieron extraer datos básicos del producto');
          }

          // Guardar en Supabase
          console.log(`💾 Guardando producto en base de datos...`);
          const { error: insertError } = await supabase
            .from('tabla_productos_construmart')
            .insert([{
              product_name: product.nombre,
              price: product.precio,
              currency: product.moneda,
              description: product.descripcion,
              especification: product.especificacion,
              brand: product.marca,
              availability: product.disponibilidad, // Corregido: availability en lugar de disponibilidad
              sku: product.sku,
              image: product.imagen,
              url: product.url
            }]);

          if (insertError) {
            console.error(`❌ Error guardando producto ${url}:`, insertError);
            totalErrors++;
          } else {
            console.log(`✅ Producto guardado exitosamente`);
            
            // Eliminar URL procesada
            const { error: deleteError } = await supabase
              .from('tabla_url')
              .delete()
              .eq('url', url);

            if (deleteError) {
              console.error(`⚠️ Error eliminando URL ${url}:`, deleteError);
            } else {
              console.log(`🗑️ URL eliminada de la tabla`);
            }
          }

          totalProcessed++;
          await saveProgress(totalProcessed, urls.length, url);
          
        } catch (err) {
          console.error(`❌ Error procesando ${url}:`, err.message);
          totalErrors++;
          
          // Guardar URL con error para revisión manual
          try {
            await supabase.from('scraper_errors').insert([{
              url: url,
              error_message: err.message,
              timestamp: new Date().toISOString()
            }]);
          } catch (logError) {
            console.log(`Error logged: ${url} - ${err.message}`);
          }
          
        } finally {
          if (page) {
            await page.close();
            page = null;
          }
          
          // Limpiar memoria
          forceGarbageCollection();
          
          // Pausa entre URLs
          if (j < block.length - 1) {
            await sleep(delayBetweenUrls);
          }
        }
      }

      // Pausa entre bloques
      if (i + blockSize < urls.length) {
        const waitMinutes = delayBetweenBlocks / (60 * 1000);
        console.log(`\n⏳ Esperando ${waitMinutes} minutos antes del siguiente bloque...`);
        console.log(`📊 Progreso total: ${totalProcessed}/${urls.length} procesadas, ${totalErrors} errores`);
        await sleep(delayBetweenBlocks);
      }
    }

  } finally {
    await browser.close();
  }

  console.log(`\n🎉 Scraping completado!`);
  console.log(`📊 Estadísticas finales:`);
  console.log(`   - URLs procesadas: ${totalProcessed}/${urls.length}`);
  console.log(`   - Errores: ${totalErrors}`);
  console.log(`   - Tasa de éxito: ${Math.round((totalProcessed / urls.length) * 100)}%`);
}

// Manejo robusto de errores y señales
process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception:', error);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('🛑 Recibida señal SIGTERM, cerrando gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Recibida señal SIGINT, cerrando gracefully...');
  process.exit(0);
});

// Ejecutar el scraper
main().catch((error) => {
  console.error('🚨 Error fatal:', error);
  process.exit(1);
});