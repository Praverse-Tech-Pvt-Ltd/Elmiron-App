import { MR_CHAT_FEATURE } from './contract';
import type { ChatRequestBody } from './contract';

/**
 * FE-D15 — the chat request, built from what the rep typed and nothing else.
 *
 * **This function takes a string and only a string**, so no caller can attach a doctor, patient,
 * visit, name or prescribing data to a chat request by passing context along. The rep may type
 * such things, and the server's guardrail refuses patient details before any model is called
 * (`detectPatientSignals` in `mr-chat.ts` on the AI branch). But the app never adds them on its own.
 *
 * **No `history` is sent.** The contract allows earlier turns. Sending them would send assistant
 * text the rep did not type, so FE-CR-7 asks whether a single-turn chat is acceptable.
 */
export const chatRequestBody = (typed: string): ChatRequestBody | null => {
  const message = typed.trim();
  return message.length === 0 ? null : { feature: MR_CHAT_FEATURE, message };
};
