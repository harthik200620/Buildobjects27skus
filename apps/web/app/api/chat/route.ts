import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { type ChatMessage, runTurn } from '@/lib/chat/engine';
import { GeminiKeyMissing } from '@/lib/chat/gemini';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';
import { SESSION_COOKIE, verifySession } from '@/lib/session';

/**
 * POST { message, history } → the assistant's turn.
 *
 * Everything the reply says came back from a tool in lib/chat/tools.ts during this request, and
 * was held against a ledger of those facts before it was returned — see lib/chat/validator.ts. A
 * sentence containing a figure no tool produced does not get past that check.
 *
 * 400 no message · 401 no session · 429 over the budget · 503 no key configured.
 *
 * SIGNED IN ONLY, and not for gatekeeping: the tools price against the reader's own pincode, and
 * the turn budget is per account rather than per IP so one office behind one address is not one
 * user's worth of assistant.
 *
 * NOTHING IS PERSISTED. The history arrives from the tab that holds it and is forgotten when the
 * response is written.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** A conversation is cheap per turn and expensive per hour. Thirty an hour is a long session. */
const CHAT_LIMIT = { limit: 30, windowMs: 60 * 60_000 };
const MAX_MESSAGE = 600;
const MAX_HISTORY = 16;

export async function POST(req: NextRequest) {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'Sign in to ask the assistant anything.' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { message?: unknown; history?: unknown } | null;
  const message = typeof body?.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE) : '';
  if (!message) return NextResponse.json({ error: 'Ask a question.' }, { status: 400 });

  /* The tab's own history, trusted for CONTINUITY and nothing else — every fact in the reply is
     re-fetched by a tool this turn regardless of what the history claims. */
  const history: ChatMessage[] = Array.isArray(body?.history)
    ? (body.history as unknown[])
        .filter(
          (m): m is ChatMessage =>
            !!m && typeof (m as ChatMessage).content === 'string' && ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant'),
        )
        .slice(-MAX_HISTORY)
        .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE) }))
    : [];

  const rl = rateLimit(`chat:${session.uid}:${clientIp(req)}`, CHAT_LIMIT.limit, CHAT_LIMIT.windowMs);
  if (!rl.ok) return tooManyRequests(`That is ${CHAT_LIMIT.limit} questions in an hour — give it a few minutes.`, rl.retryAfterMs);

  try {
    const result = await runTurn({ message, history, pincode: session.pincode, regionId: session.regionId });
    return NextResponse.json({ reply: result.reply, ui: result.ui, suggestions: result.suggestions, refused: result.refused });
  } catch (e) {
    if (e instanceof GeminiKeyMissing)
      return NextResponse.json({ error: 'The assistant is not configured on this deployment — BO_CHAT_API_KEY is not set.' }, { status: 503 });
    /* Logged, because the reply below deliberately says nothing about what went wrong and a 502
       with no trace behind it is a bug you cannot start on. `cause` carries the real network
       error when the failure is the upstream fetch. */
    console.error('[chat] turn failed:', e, (e as { cause?: unknown })?.cause ?? '');
    return NextResponse.json({ error: 'The assistant could not answer that. Try again in a moment.' }, { status: 502 });
  }
}
