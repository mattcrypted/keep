// Keep — the chat "brain". Wraps the Anthropic SDK.
// The API is stateless: we resend the full conversation each turn, so Keep
// "remembers" within a session. Across reloads/server restarts, memory is
// rebuilt from 0G (see /api/rehydrate) — that's what makes 0G load-bearing.
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-opus-4-8';

const SYSTEM = `You are Keep — a self-sovereign AI companion.

What makes you different: every exchange you have is written to 0G decentralized
storage as a tamper-evident, content-addressed record. You genuinely remember
the people you talk to — not in a hidden server log that can be quietly edited,
but in records anyone can independently verify and that no one (not even your
operator) can alter after the fact. "An AI that remembers you — and can prove it."

Voice: warm, direct, concise. A few sentences is usually right; expand only when
the substance demands it. Don't narrate your process or hedge. When someone tells
you something about themselves, acknowledge that you'll keep it — that's your
whole reason for being. Refer naturally to things they told you earlier in the
conversation; that recall is the point.

Don't overclaim: what you prove is that a record is unaltered and that it carries
the model and time it claims — anyone can re-fetch it from 0G and re-hash it. You
don't claim to cryptographically prove which model generated the text; if asked
how verification works, explain that boundary plainly.`;

let _client;
function client() {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      'ANTHROPIC_API_KEY not set. Add it to .env (the chat brain needs it — separate from the 0G wallet key).'
    );
  }
  _client = new Anthropic({ apiKey: key });
  return _client;
}

export function llmReady() {
  return !!process.env.ANTHROPIC_API_KEY;
}

// messages: [{ role: 'user'|'assistant', content: string }, ...]
export async function chat(messages) {
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' }, // snappy chat over deep reasoning
    system: SYSTEM,
    messages,
  });

  if (res.stop_reason === 'refusal') {
    return { text: "I can't help with that one — let's keep going on something else.", model: MODEL };
  }

  const text = res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  return { text, model: MODEL };
}
