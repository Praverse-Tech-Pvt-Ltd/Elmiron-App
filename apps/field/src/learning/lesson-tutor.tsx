import { useState } from 'react';
import type { ReactNode } from 'react';
import { TutorPanel } from '@fieldforce/ui';
import type { TutorView } from '@fieldforce/ui';
import type { GatewayResponse } from '../assistant/contract';
import { appLiveConnection } from '../live-connection';
import { clockIn, dayMonthIn } from '../today/territory-day';
import type { TerritoryZone } from '../today/territory-day';
import {
  createLiveLessonTutorTransport,
  lessonTutorOutcome,
  lessonTutorOutcomeFromThrown,
  lessonTutorRequestBody,
} from './tutor';
import type { LessonTutorOutcome, LessonTutorRequestBody } from './tutor';

/**
 * The lesson tutor under a lesson. The decisions are in `./tutor` and `TutorPanel`; this binds them.
 * A transport can be injected for tests; on the device it is the live one, as the signed-in rep.
 */
export const LessonTutor = ({
  lessonId,
  zone,
  transport = createLiveLessonTutorTransport(appLiveConnection()),
}: {
  readonly lessonId: string;
  readonly zone: TerritoryZone;
  readonly transport?: (body: LessonTutorRequestBody) => Promise<GatewayResponse>;
}): ReactNode => {
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [view, setView] = useState<TutorView>({ kind: 'idle' });

  const ask = (body: LessonTutorRequestBody): void => {
    setAsking(true);
    const retry = (): void => {
      ask(body);
    };
    const show = (outcome: LessonTutorOutcome): void => {
      setAsking(false);
      switch (outcome.kind) {
        case 'explained':
        case 'not_in_lesson':
        case 'refusal':
          setView({ kind: outcome.kind, text: outcome.text });
          return;
        case 'switched_off':
          setView({ kind: 'switched_off' });
          return;
        case 'at_limit':
          setView({
            kind: 'at_limit',
            resetLabel:
              outcome.resetsAt === null
                ? null
                : `${clockIn(outcome.resetsAt, zone)} on ${dayMonthIn(outcome.resetsAt, zone)}`,
          });
          return;
        case 'offline':
        case 'error':
          setView({ kind: outcome.kind, onRetry: retry });
      }
    };
    transport(body)
      .then((response) => {
        show(lessonTutorOutcome(response));
      })
      .catch((error: unknown) => {
        show(lessonTutorOutcomeFromThrown(error));
      });
  };

  return (
    <TutorPanel
      asking={asking}
      onAsk={() => {
        const body = lessonTutorRequestBody(lessonId, question);
        if (body !== null && !asking) ask(body);
      }}
      onChangeQuestion={setQuestion}
      question={question}
      view={view}
    />
  );
};
