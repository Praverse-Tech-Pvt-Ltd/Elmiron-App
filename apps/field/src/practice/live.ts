import { callRpc, postGateway, selectRows } from '../live-rest';
import type { LiveConnection } from '../live-rest';
import { PRACTICE_DIMENSIONS } from './contract';
import type {
  CoachFinding,
  PersonaStance,
  PracticeAnalysis,
  PracticeDimension,
  PracticeSession,
  PracticeSessionSummary,
  PracticeTurn,
  SuggestedModule,
} from './contract';
import type { PracticeBackend } from './transport';

/**
 * W1-Z B — the REAL practice backend: the same `PracticeBackend` the sample implements, so the screens
 * do not change. Built against `main` once FE-CR-11 landed; NOT what `transport.ts` exports yet — the
 * screens still say "sample data", and switching is the access-day step (`docs/log/backend.md`, W1-Z B5).
 *
 * **Every read is a plain table read under the row rules the rep already has** — approved personas and
 * scenarios of their company, their own sessions, turns and analyses (`simulation_core.sql`). The two
 * read RPCs FE-CR-11 asked for are not needed for anything the screens show, so they were not built
 * (W1-Z B2). The session itself comes from `sim_session_context`, the server's own copy, which is what
 * the gateway briefs the model from.
 *
 * **What the app sends the gateway is only what the gateway reads**: the feature, the session and, for a
 * turn, the rep's text. The persona brief, stance, objection and history in the request bodies are the
 * server's to supply (`BE-W136`) and are not sent.
 */

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const one = (value: unknown): Record<string, unknown> | null => {
  // PostgREST embeds a to-one relation as an object, and a reverse relation as an array of one.
  const row: unknown = Array.isArray(value) ? (value as unknown[])[0] : value;
  return typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : null;
};
const stance = (value: unknown): PersonaStance =>
  value === 'receptive' || value === 'rushed' || value === 'hostile' ? value : 'sceptical';
const findings = (value: unknown): readonly CoachFinding[] =>
  Array.isArray(value) ? (value as CoachFinding[]) : [];

export const createLivePracticeBackend = (connection: LiveConnection): PracticeBackend => ({
  listScenarios: async () => {
    const [personas, scenarios] = await Promise.all([
      selectRows(
        connection,
        'sim_personas?select=id,display_name,specialty,stance,brief&status=eq.approved&order=display_name',
      ),
      selectRows(
        connection,
        'sim_scenarios?select=id,persona_id,title,objective,objection&status=eq.approved&order=title',
      ),
    ]);
    return {
      personas: personas.map((p) => ({
        id: text(p['id']),
        displayName: text(p['display_name']),
        specialty: text(p['specialty']),
        stance: stance(p['stance']),
        brief: text(p['brief']),
      })),
      scenarios: scenarios.map((s) => ({
        id: text(s['id']),
        personaId: text(s['persona_id']),
        title: text(s['title']),
        objective: text(s['objective']),
        objection: text(s['objection']),
      })),
    };
  },

  start: async (scenarioId) => {
    const r = (await callRpc(connection, 'start_sim_session', {
      p_scenario_id: scenarioId,
    })) as Record<string, unknown>;
    return {
      sessionId: text(r['sessionId']),
      personaId: text(r['personaId']),
      personaDisplayName: text(r['personaDisplayName']),
      personaStance: stance(r['personaStance']),
      objective: text(r['objective']),
      objection: text(r['objection']),
      startedAt: text(r['startedAt']),
    };
  },

  readSession: async (sessionId): Promise<PracticeSession | null> => {
    const [meta] = await selectRows(
      connection,
      `sim_sessions?select=id,state,started_at,sim_personas(display_name),sim_scenarios(title),sim_coach_analyses(id)&id=eq.${encodeURIComponent(sessionId)}`,
    );
    if (meta === undefined) return null;
    const context = (await callRpc(connection, 'sim_session_context', {
      p_session_id: sessionId,
    })) as Record<string, unknown>;
    const turns = Array.isArray(context['turns']) ? (context['turns'] as PracticeTurn[]) : [];
    return {
      sessionId,
      personaDisplayName: text(one(meta['sim_personas'])?.['display_name']),
      personaStance: stance(context['personaStance']),
      personaBrief: text(context['personaBrief']),
      scenarioTitle: text(one(meta['sim_scenarios'])?.['title']),
      objective: text(context['objective']),
      objection: text(context['objection']),
      state: meta['state'] === 'ended' ? 'ended' : 'open',
      startedAt: text(meta['started_at']),
      turns,
      analysisId: (one(meta['sim_coach_analyses'])?.['id'] as string | undefined) ?? null,
    };
  },

  listMySessions: async (): Promise<readonly PracticeSessionSummary[]> => {
    const rows = await selectRows(
      connection,
      'sim_sessions?select=id,state,started_at,sim_personas(display_name),sim_scenarios(title),sim_coach_analyses(id)&order=started_at.desc',
    );
    return rows.map((row) => ({
      sessionId: text(row['id']),
      scenarioTitle: text(one(row['sim_scenarios'])?.['title']),
      personaDisplayName: text(one(row['sim_personas'])?.['display_name']),
      state: row['state'] === 'ended' ? 'ended' : 'open',
      startedAt: text(row['started_at']),
      analysisId: (one(row['sim_coach_analyses'])?.['id'] as string | undefined) ?? null,
    }));
  },

  turn: (body) =>
    postGateway(connection, {
      feature: 'ai_doctor',
      sessionId: body.sessionId,
      repText: body.repText,
    }),

  end: async (sessionId) => {
    await callRpc(connection, 'end_sim_session', { p_session_id: sessionId });
  },

  analyse: (body) => postGateway(connection, { feature: 'ai_coach', sessionId: body.sessionId }),

  readAnalysis: async (analysisId): Promise<PracticeAnalysis | null> => {
    const [row] = await selectRows(
      connection,
      `sim_coach_analyses?select=*&id=eq.${encodeURIComponent(analysisId)}`,
    );
    if (row === undefined) return null;
    const scores = (row['dimension_scores'] ?? {}) as Record<string, unknown>;
    return {
      id: text(row['id']),
      sessionId: text(row['session_id']),
      overallScore: Number(row['overall_score']),
      dimensionScores: Object.fromEntries(
        PRACTICE_DIMENSIONS.map((d) => [d, Number(scores[d] ?? 0)]),
      ) as Record<PracticeDimension, number>,
      strengths: findings(row['strengths']),
      improvements: findings(row['improvements']),
      suggestedModules: Array.isArray(row['suggested_modules'])
        ? (row['suggested_modules'] as SuggestedModule[])
        : [],
      summary: text(row['summary']),
      modelProvider: text(row['model_provider']),
      modelName: text(row['model_name']),
      createdAt: text(row['created_at']),
    };
  },

  moduleTitles: async (moduleIds) => {
    const candidates = (await callRpc(connection, 'sim_coach_module_candidates', {})) as {
      moduleId?: unknown;
      moduleTitle?: unknown;
    }[];
    return Object.fromEntries(
      (Array.isArray(candidates) ? candidates : [])
        .filter((c) => typeof c.moduleId === 'string' && moduleIds.includes(c.moduleId))
        .map((c) => [c.moduleId as string, text(c.moduleTitle)]),
    );
  },
});
