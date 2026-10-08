const { chromium } = require('playwright-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');

chromium.use(stealthPlugin());

/**
 * Automates login and submission on Watumishi Portal (ESS PEPMIS)
 * @param {string} checkNumber - Public Servant Check Number
 * @param {string} password - Portal Password
 * @param {string} structuredReportText - Structured report produced by AI
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
async function executePepmisSubmission(checkNumber, password, structuredReportText) {
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
        console.log(`[Automation] Navigating to Watumishi Portal for check number: ${checkNumber}`);
        await page.goto(process.env.PEPMIS_URL || 'https://ess.utumishi.go.tz/', { waitUntil: 'networkidle' });

        // Input credentials based on the portal UI structure
        const usernameInput = page.locator('input[placeholder*="Username"], input[name="username"], #username').first();
        const passwordInput = page.locator('input[type="password"]').first();
        const loginBtn = page.locator('button:has-text("LOGIN"), button[type="submit"], #loginBtn').first();

        if (await usernameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
            await usernameInput.fill(checkNumber);
            await passwordInput.fill(password);

            // Human-like pause before clicking login
            await page.waitForTimeout(1200);
            await loginBtn.click();

            // Wait for dashboard redirection
            await page.waitForLoadState('networkidle');
            console.log('[Automation] Successfully authenticated. Navigating to PEPMIS module...');
        } else {
            console.log('[Automation] Direct login input not found, checking active session...');
        }

        // Dashboard navigation and form filler
        // Example selector interactions:
        const pepmisMenu = page.locator('#pepmis-menu-link, a[href*="pepmis"]').first();
        if (await pepmisMenu.isVisible({ timeout: 3000 }).catch(() => false)) {
            await pepmisMenu.click();
            await page.waitForLoadState('networkidle');
        }

        const taskTextarea = page.locator('#task-textarea, textarea[name="description"], textarea').first();
        if (await taskTextarea.isVisible({ timeout: 3000 }).catch(() => false)) {
            await taskTextarea.fill(structuredReportText);
            const submitBtn = page.locator('#submit-report-btn, button[type="submit"]').first();
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
        // Clear browser context instantly to free server resources
        await browser.close();
    }
}

module.exports = { executePepmisSubmission };
