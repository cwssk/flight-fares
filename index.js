const puppeteer = require('puppeteer');

/**
 * ฟังก์ชันหลักสำหรับรัน Puppeteer ตาม URL ที่กำหนด
 * @param {string} targetUrl - URL ของหน้าเว็บที่ต้องการเข้าไปจัดการ
 */
async function runAutomation(targetUrl) {
  if (!targetUrl || !targetUrl.startsWith('http')) {
    console.log("❌ URL ไม่ถูกต้อง (ต้องเริ่มด้วย http:// หรือ https://)");
    return;
  }

  console.log(`🚀 กำลังเริ่มต้นสำหรับ: ${targetUrl}`);
  const browser = await puppeteer.launch({
    headless: false, // เปิดหน้าต่างเบราว์เซอร์ให้เห็นการทำงาน
    defaultViewport: null,
    args: ['--start-maximized', '--lang=en-US']
  });

  const page = await browser.newPage();

  try {
    console.log(`🌐 กำลังไปที่: ${targetUrl}`);
    // รอจนกระทั่งเครือข่ายว่าง
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    const urlObj = new URL(targetUrl);
    const hostname = urlObj.hostname;

    // --- กรณีโดเมน GOOGLE.COM ---
    if (hostname.includes('google.com')) {
      console.log("🔍 ตรวจพบ Google: กำลังหาปุ่ม 'Date grid'...");
      
      const buttonSelector = "xpath/.//button[contains(., 'Date grid')]";
      const targetDivXpath = '//*[@id="yDmH0d"]/div[10]/div[1]';

      await page.waitForSelector(buttonSelector, { timeout: 15000 });
      await page.click(buttonSelector);
      console.log("✅ คลิกปุ่ม 'Date grid' สำเร็จ");

      const targetDiv = await page.waitForSelector(`xpath/${targetDivXpath}`, {
        visible: true,
        timeout: 15000
      });

      await new Promise(r => setTimeout(r, 2000));
      await targetDiv.screenshot({ path: 'google_capture.png' });
      console.log("💾 บันทึกรูปภาพ: google_capture.png");

    // --- กรณีโดเมน TRIP.COM ---
    } else if (hostname.includes('trip.com')) {
      console.log("🔍 ตรวจพบ Trip.com: กำลังเตรียมหาปุ่มเปิดปฏิทินราคา (Price table)...");
      
      // พยายามปิด Pop-up คุกกี้หรือโฆษณาที่อาจบังปุ่ม (ถ้ามี)
      try {
        const closeBtn = await page.$('.adv-close, .sl-close, .cookie-policy-close, .close-icon');
        if (closeBtn) await closeBtn.click();
      } catch (e) { /* ข้ามถ้าไม่มี pop-up */ }

      // หน่วงเวลาเพื่อให้สคริปต์หน้าเว็บพร้อม
      console.log("⏳ รอ 5 วินาทีเพื่อให้หน้าเว็บนิ่งและพร้อมรับการคลิก...");
      await new Promise(r => setTimeout(r, 5000));

      const buttonSelector = "xpath/.//*[contains(., 'Price table')]";
      await page.waitForSelector(buttonSelector, { timeout: 20000 });
      
      const buttons = await page.$$(buttonSelector);
      let clicked = false;
      
      for (const btn of buttons) {
        try {
          const box = await btn.boundingBox();
          if (box && box.width > 0 && box.height > 0) {
            // เลื่อนมาที่กึ่งกลางจอ
            await btn.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
            await new Promise(r => setTimeout(r, 1000));

            // คลิกโดยใช้พิกัดจริงของเมาส์ (Mouse Click)
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            console.log("🖱️ คลิกด้วยพิกัดเมาส์เรียบร้อย");
            
            // ให้เวลาระบบเด้งปฏิทินขึ้นมาเล็กน้อยก่อนเช็ค
            await new Promise(r => setTimeout(r, 3000));
            
            // เช็คว่ามีปฏิทินปรากฏขึ้นมาหรือยัง (ใช้ JavaScript เช็คความสูงของ Element ที่น่าจะเป็นปฏิทิน)
            const calendarFound = await page.evaluate(() => {
              const selectors = ['#lowPriceCalendar', '[class*="price-calendar"]', '[class*="m-calendar"]', '.flight-calendar'];
              for (const s of selectors) {
                const el = document.querySelector(s);
                if (el && el.offsetHeight > 100) return true; // ถ้าเจอและมีความสูงพอสมควร ถือว่าเปิดแล้ว
              }
              return false;
            });
            
            if (!calendarFound) {
              console.log("⚠️ ปฏิทินยังไม่ปรากฏ กำลังลองคลิกสำรองด้วย Script...");
              await page.evaluate(el => el.click(), btn);
              await new Promise(r => setTimeout(r, 3000));
            }

            clicked = true;
            console.log("✅ ขั้นตอนการคลิกปุ่มสำเร็จ");
            break; 
          }
        } catch (e) {
          continue;
        }
      }

      // ขั้นตอนตรวจสอบปฏิทินและ Screenshot
      console.log("📸 กำลังตรวจสอบการโหลดข้อมูลปฏิทิน...");
      
      // เพิ่มความยืดหยุ่นของ XPath เพื่อหาปฏิทิน
      const calendarXpaths = [
        '//*[@id="lowPriceCalendar"]',
        '//div[contains(@id, "lowPriceCalendar")]',
        '//div[contains(@class, "price-calendar")]',
        '//div[contains(@class, "m-calendar")]',
        '//div[contains(@class, "calendar-content")]'
      ];

      let calendarDiv = null;

      for (const xpath of calendarXpaths) {
        try {
          // ลองหา Element ที่มองเห็นได้
          calendarDiv = await page.waitForSelector(`xpath/${xpath}`, {
            visible: true,
            timeout: 8000 
          });
          if (calendarDiv) {
            console.log(`✅ พบโครงสร้างปฏิทินจาก XPath: ${xpath}`);
            break;
          }
        } catch (e) {}
      }

      if (calendarDiv) {
        // รอให้ราคาวิ่งจนครบ
        await new Promise(r => setTimeout(r, 3000));
        await calendarDiv.screenshot({ path: 'trip_capture.png' });
        console.log("💾 บันทึกรูปภาพสำเร็จ: trip_capture.png");
      } else {
        // กรณีหา Element ไม่เจอ แต่รูป debug ยันว่ามี ให้ถ่ายแบบเจาะจงพื้นที่กลางจอ
        console.log("⚠️ ไม่พบ Element ปฏิทินแบบเจาะจงด้วย XPath แต่จะลองถ่ายภาพพื้นที่คาดการณ์");
        await page.screenshot({ path: 'trip_capture_fallback.png' });
      }

    } else {
      console.log("⚠️ โดเมนนี้ไม่ได้อยู่ในเงื่อนไขที่กำหนด");
    }

  } catch (error) {
    console.error("❌ เกิดข้อผิดพลาดหลัก:", error.message);
    await page.screenshot({ path: 'error_debug.png', fullPage: true });
    console.log("📸 บันทึกหน้าจอ error_debug.png เพื่อตรวจสอบ");
  } finally {
    console.log("🏁 เสร็จสิ้นการทำงาน");
    await browser.close();
  }
}

// --- ตัวอย่างการเรียกใช้งาน ---
const myUrlGoogle = "https://www.google.com/travel/flights/search?tfs=CBwQAhojEgoyMDI2LTA1LTI5agwIAxIIL20vMGZuMmdyBwgBEgNDQU4aIxIKMjAyNi0wNi0wM2oHCAESA0NBTnIMCAMSCC9tLzBmbjJnQAFIAXABggELCP___________wGYAQE";
const myUrlTrip = "https://th.trip.com/flights/showfarefirst?dcity=bkk&acity=can&ddate=2026-05-29&rdate=2026-06-03&aairport=can&triptype=rt&class=y&lowpricesource=searchform&quantity=1&searchboxarg=t&nonstoponly=off&locale=en-TH&curr=THB";

(async () => {
  await runAutomation(myUrlTrip); 
})();