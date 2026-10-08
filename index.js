const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { formatPepmisReport } = require('./aiWorker');
const { executePepmisSubmission } = require('./automationEngine');
const pino = require('pino');
require('dotenv').config();

// In-memory session state store for active chat flows (Credentials are strictly held in-memory and wiped after execution)
const userSessions = {};

async function startBot() {
    console.log("==================================================");
    console.log("    PEPMIS AI WHATSAPP BOT (BAILEYS) - STARTING   ");
    console.log("==================================================");

    try {
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');

        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: true
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log(`Connection closed (status code: ${statusCode}). Reconnecting: ${shouldReconnect}...`);
                if (shouldReconnect) {
                    startBot();
                }
            } else if (connection === 'open') {
                console.log('✅ PEPMIS AI WhatsApp Bot (@whiskeysockets/baileys) is connected and active!');
            }
        });

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;

            for (const msg of messages) {
                if (!msg.message || msg.key.fromMe) continue;

                const senderJid = msg.key.remoteJid;

                // Extract text from standard conversation or extendedTextMessage
                const messageText = (
                    msg.message.conversation ||
                    msg.message.extendedTextMessage?.text
                )?.trim();

                if (!messageText) continue;

                await handleConversationFlow(senderJid, messageText, async (replyText) => {
                    await sock.sendMessage(senderJid, { text: replyText });
                });
            }
        });

    } catch (err) {
        console.error("Fatal Error in Baileys WhatsApp Bot:", err.message);
    }
}

/**
 * Stateful conversation handler (IDLE -> AWAITING_CHECK_NUMBER -> AWAITING_PASSWORD)
 */
async function handleConversationFlow(senderJid, messageText, reply) {
    if (!userSessions[senderJid]) {
        userSessions[senderJid] = { step: 'IDLE', draftText: '', checkNumber: '' };
    }

    const session = userSessions[senderJid];

    // Global reset command
    if (messageText.toUpperCase() === 'CANCEL' || messageText.toUpperCase() === 'RESET') {
        userSessions[senderJid] = { step: 'IDLE', draftText: '', checkNumber: '' };
        await reply("🔄 Session reset. Send your work tasks whenever you're ready!");
        return;
    }

    // Step 1: User provides raw work task descriptions
    if (session.step === 'IDLE') {
        await reply("🤖 *PEPMIS AI*: Formatting your task description according to official Watumishi/PEPMIS guidelines...");

        try {
            const formattedReport = await formatPepmisReport(messageText);
            session.draftText = formattedReport;
            session.step = 'AWAITING_CHECK_NUMBER';

            await reply(`✅ *Report Drafted Successfully:*\n\n${formattedReport}\n\n-------------------\nReply with your official *Check Number* to proceed with submission, or type 'CANCEL' to restart.`);
        } catch (err) {
            console.error("Error drafting report:", err.message);
            await reply("❌ Failed to format report text. Please try describing your tasks again.");
        }
        return;
    }

    // Step 2: Capture Check Number
    if (session.step === 'AWAITING_CHECK_NUMBER') {
        session.checkNumber = messageText.trim();
        session.step = 'AWAITING_PASSWORD';

        await reply("🔒 Check number received. Now, reply with your *Portal Password*.\n\n*(Note: Your password is held strictly in-memory for this single automated session and is never stored on disk.)*");
        return;
    }

    // Step 3: Capture Password & Trigger Playwright Automation
    if (session.step === 'AWAITING_PASSWORD') {
        const password = messageText.trim();
        const checkNumber = session.checkNumber;
        const draftText = session.draftText;

        await reply("🚀 Launching secure automation agent to log into Watumishi portal... Please wait (~30 seconds).");

        try {
            const result = await executePepmisSubmission(checkNumber, password, draftText);

            if (result.success) {
                await reply(`🎉 *Success!* ${result.message}`);
            } else {
                await reply(`⚠️ *Automation Submission Notice:* ${result.error || 'Failed to complete portal submission.'}\n\nPlease check your credentials or portal status and try again.`);
            }
        } catch (err) {
            console.error("Automation error:", err.message);
            await reply(`❌ *Error:* Automation engine encountered an error: ${err.message}`);
        } finally {
            // Immediate security wipe of sensitive credentials from in-memory session
            userSessions[senderJid] = { step: 'IDLE', draftText: '', checkNumber: '' };
        }
        return;
    }
}

if (require.main === module) {
    startBot();
}

module.exports = { startBot, handleConversationFlow };
