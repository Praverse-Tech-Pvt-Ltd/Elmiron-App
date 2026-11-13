import { describe, expect, it } from 'vitest';
import { LISTEN, LISTEN_START, listenStep, spokenTurnBody, spokenTurnOutcome } from './voice';
import type { ListenDecision, ListenState } from './voice';
import type { PracticeSession } from './contract';

/** `FE-W163` — hands-free practice: when the rep has finished, and what the gateway's answer means. */

/** Feed levels, one per sample; return every decision and the last state. */
const run = (
  levels: readonly (number | undefined)[],
): { decisions: ListenDecision[]; state: ListenState } => {
  let state = LISTEN_START;
  const decisions: ListenDecision[] = [];
  for (const level of levels) {
    const step = listenStep(state, level);
    state = step.state;
    decisions.push(step.decision);
  }
  return { decisions, state };
};
const samples = (ms: number): number => Math.ceil(ms / LISTEN.SAMPLE_MS);
const repeat = (level: number, ms: number): number[] => Array<number>(samples(ms)).fill(level);

describe('listenStep — when the rep has finished speaking', () => {
  it('quiet room, a sentence, then a pause: sent after the pause, not before', () => {
    const { decisions } = run([...repeat(-60, 600), ...repeat(-25, 2_000), ...repeat(-60, 2_000)]);
    const sentAt = decisions.indexOf('send');
    expect(sentAt).toBeGreaterThan(samples(2_600));
    expect(sentAt).toBeLessThanOrEqual(samples(2_600 + LISTEN.END_SILENCE_MS) + 1);
    expect(decisions.slice(0, samples(600))).not.toContain('hearing');
  });

  it('a noisy corridor (-38 dB) is the room, not speech; the rep over it is', () => {
    const { decisions } = run([
      ...repeat(-38, 1_500),
      ...repeat(-15, 1_500),
      ...repeat(-38, 2_000),
    ]);
    expect(decisions.slice(0, samples(1_500))).toEqual(Array(samples(1_500)).fill('listening'));
    expect(decisions).toContain('send');
  });

  it('a click or a cough is not a turn', () => {
    const { decisions } = run([...repeat(-60, 500), -20, ...repeat(-60, 3_000)]);
    expect(decisions).not.toContain('send');
  });

  it('nobody speaks: stop listening after a while, and say so', () => {
    const { decisions } = run(repeat(-60, LISTEN.NOTHING_SAID_MS + 300));
    expect(decisions).toContain('nothing_said');
    expect(decisions).not.toContain('send');
  });

  it('a pause mid-sentence shorter than the end pause does not cut the rep off', () => {
    const { decisions } = run([
      ...repeat(-60, 300),
      ...repeat(-25, 1_000),
      ...repeat(-60, LISTEN.END_SILENCE_MS - 400),
      ...repeat(-25, 1_000),
    ]);
    expect(decisions).not.toContain('send');
  });

  it('a very long turn is sent at the cap', () => {
    const { decisions } = run([...repeat(-60, 300), ...repeat(-20, LISTEN.MAX_TURN_MS)]);
    expect(decisions).toContain('send');
  });

  it('no level from the phone counts as silence, never as speech', () => {
    const { decisions } = run(Array<undefined>(samples(3_000)).fill(undefined));
    expect(decisions).not.toContain('hearing');
  });
});

describe('spokenTurnOutcome', () => {
  it('a reply: what was heard, the reply, and its speech', () => {
    expect(
      spokenTurnOutcome({
        status: 200,
        body: {
          kind: 'replied',
          reply: ' Go on. ',
          repText: 'May I show you the data?',
          doctorAudio: { base64: 'AAAA', mimeType: 'audio/mpeg' },
        },
      }),
    ).toEqual({
      kind: 'replied',
      heard: 'May I show you the data?',
      reply: 'Go on.',
      audio: 'AAAA',
    });
  });

  it('a reply that could not be spoken still arrives, without audio', () => {
    expect(
      spokenTurnOutcome({
        status: 200,
        body: { kind: 'replied', reply: 'Hm.', doctorAudio: null },
      }),
    ).toMatchObject({ kind: 'replied', audio: null });
  });

  it("the gateway's voice answers each have their own state", () => {
    expect(spokenTurnOutcome({ status: 200, body: { kind: 'no_speech' } })).toEqual({
      kind: 'no_speech',
    });
    expect(spokenTurnOutcome({ status: 503, body: { code: 'voice_unavailable' } })).toEqual({
      kind: 'voice_unavailable',
    });
    expect(spokenTurnOutcome({ status: 502, body: { code: 'voice_failed' } })).toEqual({
      kind: 'not_heard',
    });
    expect(
      spokenTurnOutcome({
        status: 200,
        body: { kind: 'patient_specific', message: 'No patient details.' },
      }),
    ).toEqual({ kind: 'refused', message: 'No patient details.' });
  });

  it('the shared refusals and a stub reply read as they do for typed turns', () => {
    expect(spokenTurnOutcome({ status: 429, body: { code: '45012' } })).toEqual({
      kind: 'at_limit',
    });
    expect(spokenTurnOutcome({ status: 503, body: { code: 'no_provider' } })).toEqual({
      kind: 'not_available',
    });
    expect(
      spokenTurnOutcome({ status: 200, body: { kind: 'replied', reply: '[PRACTICE STUB] hello' } }),
    ).toEqual({ kind: 'not_available' });
    expect(spokenTurnOutcome({ status: 500, body: null })).toEqual({ kind: 'error' });
  });
});

describe('spokenTurnBody', () => {
  it('sends the session and the recording, nothing else', () => {
    const session = { sessionId: 's-1' } as PracticeSession;
    expect(spokenTurnBody(session, 'QUJD')).toEqual({
      feature: 'ai_doctor',
      sessionId: 's-1',
      repAudio: { base64: 'QUJD', mimeType: 'audio/mp4' },
    });
  });
});
