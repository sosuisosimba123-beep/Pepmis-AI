import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { parseUserIntent } from './aiWorker.js';
import { executePepmisSubmission } from './automationEngine.js';
import { authenticatePocketBase, logSubmission, saveDbSession, getDbSession } from './pocketbase.js';
import { chromium } from 'playwright-extra';

// Global uncaught exception handlers to prevent crashes from internal library rejections
process.on('uncaughtException', (err) => {
    console.error('[Process Warning] Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('[Process Warning] Unhandled Rejection:', reason?.message || reason);
});

// In-memory context store per active chat sender
const userSessions = {};

let puppeteerOpts = {
    headless: true,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
    ]
};

try {
    const execPath = chromium.executablePath();
    if (execPath) {
        puppeteerOpts.executablePath = execPath;
    }
} catch (e) {
    console.log('[Setup] Using default Puppeteer Chrome location.');
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: puppeteerOpts,
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    }
});

client.on('qr', (qr) => {
    console.log('Scan this QR code with your WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('✅ WhatsApp client is ready and connected!');
    await authenticatePocketBase();
});

client.on('message', async (msg) => {
    try {
        console.log(`Received message: "${msg.body}" from ${msg.from}`);

        if (msg.body === '!ping') {
            await msg.reply('pong').catch(() => {});
            return;
        }

        const senderId = msg.from;
        const userMessage = msg.body ? msg.body.trim() : '';

        if (!userMessage) return;

        // Initialize or restore session context (checking memory then PocketBase)
        if (!userSessions[senderId]) {
            const dbSession = await getDbSession(senderId);
            userSessions[senderId] = dbSession || { checkNumber: null, password: null, reportText: null };
        }

        const currentContext = userSessions[senderId];

        if (userMessage.toUpperCase() === 'CANCEL' || userMessage.toUpperCase() === 'RESET') {
            userSessions[senderId] = { checkNumber: null, password: null, reportText: null };
            await saveDbSession(senderId, userSessions[senderId]);
            await msg.reply("🔄 Session state reset. How can I help you today?").catch(() => {});
            return;
        }

        // Let AI worker parse user intent & extract parameters
        const decision = await parseUserIntent(userMessage, currentContext);

        // Update session context in memory and PocketBase
        userSessions[senderId] = {
            checkNumber: decision.checkNumber,
            password: decision.password,
            reportText: decision.reportText
        };
        await saveDbSession(senderId, userSessions[senderId]);

        // Send conversational reply to user safely
        if (decision.replyToUser) {
            await msg.reply(decision.replyToUser).catch((err) => {
                console.warn('[WhatsApp Reply Error]:', err.message);
            });
        }

        // Trigger Playwright automation if all parameters are verified
        if ((decision.intent === 'SUBMIT_REPORT' || decision.intent === 'LOGIN_PEPMIS') && decision.missingInfo.length === 0) {
            await msg.reply("🚀 All parameters verified. Triggering PEPMIS Playwright automation engine...").catch(() => {});

            // Log pending status to PocketBase
            await logSubmission({
                senderId,
                checkNumber: decision.checkNumber,
                reportText: decision.reportText,
                status: 'PENDING',
                details: 'Automation execution initiated'
            });

            try {
                const result = await executePepmisSubmission(
                    decision.checkNumber,
                    decision.password,
                    decision.reportText
                );

                if (result.success) {
                    await msg.reply(`🎉 *Automation Success:* ${result.message}`).catch(() => {});
                    await logSubmission({
                        senderId,
                        checkNumber: decision.checkNumber,
                        reportText: decision.reportText,
                        status: 'SUCCESS',
                        details: result.message
                    });
                } else {
                    await msg.reply(`⚠️ *Automation Notice:* ${result.error || 'Portal submission could not be completed.'}`).catch(() => {});
                    await logSubmission({
                        senderId,
                        checkNumber: decision.checkNumber,
                        reportText: decision.reportText,
                        status: 'FAILED',
                        details: result.error || 'Portal submission incomplete'
                    });
                }
            } catch (err) {
                console.error('Automation error:', err.message);
                await msg.reply(`❌ *Error:* Automation failed: ${err.message}`).catch(() => {});
                await logSubmission({
                    senderId,
                    checkNumber: decision.checkNumber,
                    reportText: decision.reportText,
                    status: 'FAILED',
                    details: err.message
                });
            } finally {
                // Keep saved credentials in PocketBase for seamless future submissions, reset report text
                userSessions[senderId].reportText = null;
                await saveDbSession(senderId, userSessions[senderId]);
            }
        }
    } catch (err) {
        console.error('[Message Handler Error]:', err.message);
    }
});

client.initialize();
