import { chromium } from 'playwright';
import { networkInterfaces } from 'node:os';

const localAddress = (networkInterfaces().en0 || []).find(x => x.family === 'IPv4')?.address;
if (!localAddress) throw new Error('Mac Wi-Fi adapter en0 has no IPv4 address');
const port = process.env.LAN_TEST_PORT || '8787';
const url = `http://${localAddress}:${port}/`;
const browser = await chromium.launch({
 executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 headless: true,
 args: ['--no-first-run','--no-default-browser-check']
});
try {
 const page = await browser.newPage();
 const errors = [];
 page.on('pageerror', err => errors.push(err.message));
 const response = await page.goto(url, {waitUntil:'networkidle',timeout:15000});
 if (response.status() !== 200) throw new Error('LAN root HTTP '+response.status());
 await page.getByLabel('用户名').waitFor({timeout:5000});
 const features = await page.evaluate(() => ({
  secure: window.isSecureContext,
  randomUUID: typeof crypto.randomUUID,
  getRandomValues: typeof crypto.getRandomValues
 }));
 if (features.secure !== false) throw new Error('Did not test an insecure LAN HTTP origin: '+JSON.stringify(features));
 if (errors.length) throw new Error('Browser JS errors: '+errors.join(' | '));
 console.log('LAN_HTTP_BROWSER_OK',url,features,'login_form_visible=true');
}finally{await browser.close()}
