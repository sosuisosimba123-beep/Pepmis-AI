import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : new GoogleGenAI();

/**
 * Parses user message using Gemini to extract intent, parameters, and conversational reply.
 * @param {string} messageText
 * @param {Object} [sessionContext] - Accumulated parameters from previous turns
 * @returns {Promise<Object>} Intent decision object
 */
export async function parseUserIntent(messageText, sessionContext = {}) {
  if (!messageText || typeof messageText !== 'string') {
    return {
      intent: 'UNKNOWN',
      checkNumber: sessionContext.checkNumber || null,
      password: sessionContext.password || null,
      reportText: sessionContext.reportText || null,
      missingInfo: ['reportText', 'checkNumber', 'password'],
      replyToUser: 'Habari! Mimi ni msaidizi wako wa PEPMIS. Nipo hapa kukusaidia kuandaa na kujaza ripoti za kazi kwenye Watumishi Portal (ESS). Tafadhali taja taarifa za kazi za wiki hii ili tuandae dashboard yako!'
    };
  }

  // Attempt Gemini API call if key is present and looks like a valid key format
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.startsWith('AIzaSy')) {
    const systemPrompt = `
You are the intelligent AI brain for a Tanzanian government portal (PEPMIS / Watumishi Portal) automation assistant on WhatsApp.
You can engage in friendly conversation with users in Swahili or English, BUT you must ALWAYS guide them to focus on getting their PEPMIS performance report formatted and submitted to their Watumishi Portal (ESS) dashboard.

Current Accumulated Context from Previous Turns:
- Check Number: ${sessionContext.checkNumber || "null"}
- Password: ${sessionContext.password ? "*****" : "null"}
- Report Description/Text: ${sessionContext.reportText || "null"}

Possible intents:
- SUBMIT_REPORT: User provides work task details, check number, password, or wants to submit/evaluate report.
- LOGIN_PEPMIS: User wants to log in or check portal status.
- GENERAL_CHAT: Casual greeting, question, or chit-chat.
- UNKNOWN: Cannot determine intent.

Persona & Rules:
1. Be polite, friendly, professional, and conversable.
2. If the user engages in GENERAL_CHAT (e.g. "hi", "mambo", "habari"), chat briefly, but ALWAYS remind them: "Lengo langu kuu ni kukusaidia kuandaa taarifa zako za kazi na kuzijaza kwenye Watumishi Portal dashboard yako kwa usahihi. Je, una kazi za wiki hii unazotaka tuziwasilishe?"
3. Extract Check Number (7-10 digits) and Portal Password if provided.
4. If user describes work tasks, format them into official, professional PEPMIS report guidelines text for "reportText".
5. Evaluate missingInfo array for SUBMIT_REPORT: required fields are ["checkNumber", "password", "reportText"].
6. Include conversational response in "replyToUser" in Swahili or English matching user language.

Respond strictly in valid JSON format without markdown code blocks:
{
  "intent": "SUBMIT_REPORT",
  "checkNumber": "extracted check number or null",
  "password": "extracted password or null",
  "reportText": "formatted report text or null",
  "missingInfo": [],
  "replyToUser": "Conversational response guiding the user towards dashboard readiness"
}
`;

    const modelsToTry = ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-flash-latest'];

    for (const modelName of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: `${systemPrompt}\n\nUser Message: "${messageText}"`,
        });

        if (response && response.text) {
          const cleanedText = response.text.replace(/```json|```/g, '').trim();
          const parsed = JSON.parse(cleanedText);

          parsed.checkNumber = parsed.checkNumber || sessionContext.checkNumber || null;
          parsed.password = parsed.password || sessionContext.password || null;
          parsed.reportText = parsed.reportText || sessionContext.reportText || null;

          const missing = [];
          if (!parsed.reportText) missing.push('reportText');
          if (!parsed.checkNumber) missing.push('checkNumber');
          if (!parsed.password) missing.push('password');
          parsed.missingInfo = missing;

          return parsed;
        }
      } catch (err) {
        if (err.message.includes('401') || err.message.includes('UNAUTHENTICATED')) {
          console.warn('[AI Worker] Invalid GEMINI_API_KEY detected. Switching to local heuristic parser.');
          break; // Stop trying other models on auth error
        }
        console.warn(`Gemini API warning for model [${modelName}]:`, err.message);
      }
    }
  }

  // Fallback heuristic intent parser if API key is not present or API call fails
  return fallbackIntentParser(messageText, sessionContext);
}

/**
 * Fallback intent parser if LLM is unavailable.
 */
function fallbackIntentParser(messageText, sessionContext = {}) {
  const text = messageText.trim();
  let checkNumber = sessionContext.checkNumber || null;
  let password = sessionContext.password || null;
  let reportText = sessionContext.reportText || null;

  if (/^\d{7,10}$/.test(text)) {
    checkNumber = text;
  } else if (!reportText) {
    reportText = text;
  } else if (checkNumber && !password) {
    password = text;
  }

  const missingInfo = [];
  if (!reportText) missingInfo.push('reportText');
  if (!checkNumber) missingInfo.push('checkNumber');
  if (!password) missingInfo.push('password');

  let replyToUser = "";
  if (missingInfo.length === 0) {
    replyToUser = "✅ Taarifa zote zipo tayari! Mfumo unaanza kuweka ripoti yako kwenye Watumishi Portal dashboard kwako...";
  } else if (missingInfo.includes('checkNumber')) {
    replyToUser = "✅ Taarifa za kazi zimekamilika. Tafadhali weka Namba yako ya Hundi (Check Number) ili tukamilishe kuweka kwenye dashboard yako.";
  } else if (missingInfo.includes('password')) {
    replyToUser = "🔒 Namba ya Hundi imehifadhiwa. Tafadhali weka Neno la Siri (Password) la Watumishi Portal ili uwasilishaji ukamilike.";
  } else {
    replyToUser = "🤖 Habari! Mimi ni Msaidizi wako wa PEPMIS. Lengo langu kuu ni kukusaidia kuandaa taarifa zako za kazi na kuzijaza kwenye Watumishi Portal (ESS) dashboard yako kwa haraka na usahihi. Eleza shughuli za kazi ulizofanya wiki hii ili tuanze!";
  }

  return {
    intent: 'SUBMIT_REPORT',
    checkNumber,
    password,
    reportText,
    missingInfo,
    replyToUser
  };
}
