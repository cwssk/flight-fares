const puppeteer = require('puppeteer');
const fs = require('fs');

/**
 * ฟังก์ชันสำหรับ Parse ข้อมูลดิบจาก GetCalendarGrid ของ Google Flights (Version เต็ม)
 */
function parseGoogleCalendarResponse(rawText) {
  try {
    let cleanText = rawText.replace(/^\)\]\}'\s*/, '');
    const parts = cleanText.split(/\n\d+\n/);
    let allResults = [];

    for (let part of parts) {
      if (!part.includes('"wrb.fr"') || !part.includes('"GetCalendarGrid"')) continue;

      try {
        const startIdx = part.indexOf('[[');
        const endIdx = part.lastIndexOf(']]');
        if (startIdx === -1 || endIdx === -1) continue;

        const jsonArrayText = part.substring(startIdx, endIdx + 2);
        const outerData = JSON.parse(jsonArrayText);

        if (outerData[0] && outerData[0][2]) {
          const innerDataString = outerData[0][2];
          const innerData = JSON.parse(innerDataString);
          const priceEntries = innerData[1];

          if (Array.isArray(priceEntries)) {
            const mapped = priceEntries
              .filter(entry => Array.isArray(entry) && entry.length >= 3 && entry[2] !== null)
              .map(entry => {
                const departureDate = entry[0];
                const returnDate = entry[1];
                let priceValue = null;
                try {
                  if (Array.isArray(entry[2]) && entry[2][0] && entry[2][0].length >= 2) {
                    priceValue = entry[2][0][1];
                  }
                } catch (e) {}

                return {
                  departureDate,
                  returnDate,
                  price: priceValue ? parseFloat(priceValue) : null,
                  source: 'Google Flights'
                };
              });
            allResults = [...allResults, ...mapped];
          }
        }
      } catch (innerError) {}
    }

    const uniqueResults = [];
    const seen = new Set();
    for (const item of allResults) {
      const key = `${item.departureDate}_${item.returnDate}`;
      if (!seen.has(key) && item.price !== null) {
        seen.add(key);
        uniqueResults.push(item);
      }
    }
    return uniqueResults;
  } catch (e) {
    return null;
  }
}

/**
 * ฟังก์ชันสำหรับ Google Flights: ดักจับข้อมูลจาก Network Request จริง
 */
async function runGoogleAutomation(targetUrl) {
  console.log(`🔎 เริ่มต้น Google Flights: ${targetUrl}`);
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized', '--no-sandbox']
  });

  const page = await browser.newPage();
  let googleResults = [];

  try {
    // ดักจับ Response จาก Network
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('GetCalendarGrid')) {
        try {
          const text = await response.text();
          const parsed = parseGoogleCalendarResponse(text);
          if (parsed && parsed.length > 0) {
            googleResults = [...googleResults, ...parsed];
            console.log(`✅ ดักจับข้อมูลจาก Google ได้ ${parsed.length} รายการ`);
          }
        } catch (err) {
          // บางครั้ง response อาจจะไม่สามารถอ่านได้
        }
      }
    });

    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // รอสักพักเพื่อให้ Google โหลดข้อมูลปฏิทินจนครบ (หรือรอ selector ที่แสดงว่าโหลดเสร็จ)
    await new Promise(resolve => setTimeout(resolve, 10000)); 

    return googleResults;
  } catch (error) {
    console.error("❌ Google Flights Error:", error.message);
    return [];
  } finally {
    await browser.close();
  }
}

/**
 * ฟังก์ชันสำหรับ Trip.com: ดึงข้อมูลจากตารางราคา (Matrix Logic)
 */
async function runTripAutomation(targetUrl) {
  console.log(`🚀 เริ่มต้น Trip.com: ${targetUrl}`);
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized', '--lang=en-US', '--no-sandbox']
  });

  const page = await browser.newPage();
  let tableData = [];

  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    try {
      await page.waitForSelector('.usp-loading-wrapper', { hidden: true, timeout: 15000 });
    } catch (e) {}

    const buttonSelector = "xpath/.//*[contains(text(), 'Price table')]";
    await page.waitForSelector(buttonSelector, { timeout: 15000 });
    
    await page.evaluate((sel) => {
      const element = document.evaluate(sel.replace('xpath/', ''), document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      if (element) element.click();
    }, buttonSelector);

    await page.waitForSelector('.round-trip-price-table', { visible: true, timeout: 20000 });

    tableData = await page.evaluate(() => {
      const results = [];
      const parseDateToUTC = (text) => {
        const months = { 'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5, 'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11 };
        const clean = text.trim().split(' ');
        if (clean.length < 2) return null;
        return new Date(Date.UTC(2026, months[clean[0]], parseInt(clean[1], 10)));
      };
      const formatDate = (d) => {
        const year = d.getUTCFullYear();
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      const td00 = document.querySelector('[data-testid="td-00"] .row-head-date');
      const td70 = document.querySelector('[data-testid="td-70"] .row-head-date');
      if (!td00 || !td70) return [];

      const baseDepUTC = parseDateToUTC(td00.innerText); 
      const baseRetUTC = parseDateToUTC(td70.innerText);
      const startDepDate = new Date(baseDepUTC);
      startDepDate.setUTCDate(startDepDate.getUTCDate() + 1);
      const startRetDate = new Date(baseRetUTC);
      startRetDate.setUTCDate(startRetDate.getUTCDate() - 6);

      for (let r = 1; r <= 6; r++) {
        for (let c = 1; c <= 7; c++) {
          const testId = `td-${r}${c}`;
          const cell = document.querySelector(`[data-testid="${testId}"]`);
          if (cell) {
            const priceEl = cell.querySelector('.price-result');
            if (priceEl) {
              const currentDep = new Date(startDepDate);
              currentDep.setUTCDate(currentDep.getUTCDate() + (c - 1));
              const currentRet = new Date(startRetDate);
              currentRet.setUTCDate(currentRet.getUTCDate() + (r - 1));
              results.push({
                departureDate: formatDate(currentDep),
                returnDate: formatDate(currentRet),
                price: parseInt(priceEl.innerText.replace(/[^0-9]/g, ''), 10),
                cell: testId,
                source: 'Trip.com'
              });
            }
          }
        }
      }
      return results;
    });

    return tableData;
  } catch (error) {
    console.error("❌ Trip.com Error:", error.message);
    return [];
  } finally {
    await browser.close();
  }
}

// --- การรันกระบวนการทั้งหมด ---

// อัปเดต URL ของ Google Flights ตามที่ระบุ
const googleUrl = "https://www.google.com/travel/flights/search?tfs=CBwQAhojEgoyMDI2LTA1LTI5agwIAxIIL20vMGZuMmdyBwgBEgNDQU4aIxIKMjAyNi0wNi0wM2oHCAESA0NBTnIMCAMSCC9tLzBmbjJnQAFIAXABggELCP___________wGYAQE";
const tripUrl = "https://th.trip.com/flights/showfarefirst?dcity=bkk&acity=can&ddate=2026-05-29&rdate=2026-06-03&aairport=can&triptype=rt&class=y&lowpricesource=searchform&quantity=1&searchboxarg=t&nonstoponly=off&locale=en-TH&curr=THB";

(async () => {
  // 1. รันดักจับข้อมูลจาก Google Flights (จาก Network จริง)
  const googleData = await runGoogleAutomation(googleUrl);
  
  // 2. รันดึงข้อมูลจาก Trip.com (จาก Matrix ตาราง)
  const tripData = await runTripAutomation(tripUrl);

  // 3. รวมผลลัพธ์
  const finalResults = {
    googleFlights: googleData,
    tripCom: tripData
  };

  console.log("\n🚀 รวมผลลัพธ์ทั้งหมดเรียบร้อยแล้ว:");
  console.log(JSON.stringify(finalResults, null, 2));
  
  // บันทึกผลลัพธ์ลงไฟล์เพื่อนำไปใช้งานต่อ
  fs.writeFileSync('final_flights_data.json', JSON.stringify(finalResults, null, 2));
})();