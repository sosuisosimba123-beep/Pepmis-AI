import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';

dotenv.config();

chromium.use(stealthPlugin());

/**
 * Automates login and submission on Watumishi Portal (ESS PEPMIS)
 * @param {string} checkNumber - Public Servant Check Number
 * @param {string} password - Portal Password
 * @param {string} structuredReportText - Structured report produced by AI
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
export async function executePepmisSubmission(checkNumber, password, structuredReportText) {
    const targetUrl = process.env.PEPMIS_URL || 'https://ess.utumishi.go.tz/';

    // Launch browser with stealth parameters
    const browser = await chromium.launch({
        headless: process.env.HEADLESS !== 'false',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-infobars',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    try {
        console.log(`[Automation] Navigating to official Watumishi Portal (${targetUrl}) for check number: ${checkNumber}`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

        // Wait briefly for page inputs to load
        await page.waitForTimeout(2000);

        // Input credentials based on the Watumishi Portal (ESS) UI structure
        const usernameInput = page.locator('input[placeholder*="Username"], input[placeholder*="Check"], input[name="username"], input[name="check_number"], #username, input[type="text"]').first();
        const passwordInput = page.locator('input[type="password"]').first();
        const loginBtn = page.locator('button:has-text("LOGIN"), button:has-text("Login"), button:has-text("INGIA"), button[type="submit"], #loginBtn').first();

        if (await usernameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
            await usernameInput.fill(checkNumber);
            await passwordInput.fill(password);

            // Human-like pause before clicking login
            await page.waitForTimeout(1200);
            await loginBtn.click();

            // Wait for dashboard redirection
            await page.waitForLoadState('domcontentloaded').catch(() => {});
            console.log('[Automation] Credentials submitted. Navigating to PEPMIS module...');
        } else {
            console.log('[Automation] Direct login input not found, checking active session...');
        }

        // Dashboard navigation and form filler
        const pepmisMenu = page.locator('#pepmis-menu-link, a[href*="pepmis"], a:has-text("PEPMIS"), a:has-text("Performance")').first();
        if (await pepmisMenu.isVisible({ timeout: 4000 }).catch(() => false)) {
            await pepmisMenu.click();
            await page.waitForLoadState('domcontentloaded').catch(() => {});
        }

        const taskTextarea = page.locator('#task-textarea, textarea[name="description"], textarea[name="activity"], textarea').first();
        if (await taskTextarea.isVisible({ timeout: 4000 }).catch(() => false)) {
            await taskTextarea.fill(structuredReportText);
            const submitBtn = page.locator('#submit-report-btn, button[type="submit"], button:has-text("Submit"), button:has-text("WASILISHA")').first();
            if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
                await submitBtn.click();
            }
        }

        console.log('[Automation] Task log successfully submitted.');
        return { success: true, message: "Report successfully submitted to PEPMIS!" };

    } catch (error) {
        console.error('[Automation Error]:', error.message);
        return { success: false, error: error.message };
    } finally {
        await browser.close();
    }
}
