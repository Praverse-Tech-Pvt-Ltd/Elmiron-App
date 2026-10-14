import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { BodyText, Heading, Secondary, Title } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { ListRow } from './ListRow';
import { Spinner } from './Spinner';
import { useT } from './i18n';
import type { TextKey } from './i18n';

/**
 * W2-F B — a rep's learning: the courses assigned to them, one course's lessons, a lesson, and
 * recording that they finished it. Three screens, one file, the same rules as every screen shipped:
 *
 * - **Every sentence is true of what the server said.** "Finished" appears only where the server has a
 *   completion; a course reads finished only when the server stamped it.
 * - **A finish that did not reach the server is not saved anywhere.** `complete_lesson` is not in the
 *   outbox, so with no signal the screen says the lesson was NOT recorded and offers to try again —
 *   never a tick it cannot stand behind.
 * - **No tutor in these screens.** The lesson tutor is its own component (`TutorPanel`), drawn under
 *   a lesson by the route when its own flag (`EXPO_PUBLIC_LESSON_TUTOR`) is on.
 *
 * `FE-W183`. Every word here is on the catalogue (`learning.*`), the last rep-facing screens to
 * move. Course, module and lesson titles and a lesson's text are the company's content, from the
 * server, and are shown as written.
 */

const styles = StyleSheet.create({
  lessonBody: { gap: tokens.space.md },
  bullets: { gap: tokens.space.xs },
  // `FE-W184`. A bullet is a row: the mark in its own column and the text beside it, so a point
  // that wraps hangs under its own first word rather than back under the mark.
  bullet: { flexDirection: 'row', gap: tokens.space.sm },
  bulletText: { flex: 1 },
  head: { gap: tokens.space.xxs },
  list: { gap: tokens.space.sm },
  section: { gap: tokens.space.xs, paddingTop: tokens.space.sm },
  foot: { gap: tokens.space.sm, paddingTop: tokens.space.md },
});

type Failure =
  | { readonly kind: 'offline'; readonly onRetry: () => void }
  | { readonly kind: 'error'; readonly onRetry: () => void };

/**
 * `FE-W183`. Whole sentences, one per screen and failure. They were built from a fragment — "No
 * signal, so " + "your courses" + " could not be loaded." — which no other language can follow.
 */
const FAILURE_LINES = {
  courses: { offline: 'learning.coursesOffline', error: 'learning.coursesError' },
  course: { offline: 'learning.courseOffline', error: 'learning.courseError' },
  lesson: { offline: 'learning.lessonOffline', error: 'learning.lessonError' },
} as const satisfies Record<string, Record<Failure['kind'], TextKey>>;

const FailureCard = ({
  failure,
  what,
}: {
  readonly failure: Failure;
  readonly what: keyof typeof FAILURE_LINES;
}): ReactNode => {
  const { t } = useT();
  return (
    <Card>
      <BodyText>{t(FAILURE_LINES[what][failure.kind])}</BodyText>
      <Button label={t('common.tryAgain')} onPress={failure.onRetry} variant="secondary" />
    </Card>
  );
};

// ---------------------------------------------------------------------------

export type LearningListView =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'loaded';
      readonly courses: readonly {
        readonly id: string;
        readonly title: string;
        readonly line: string;
        readonly due: string | null;
        readonly onOpen: () => void;
      }[];
    }
  | Failure;

export const LearningListScreen = ({ view }: { readonly view: LearningListView }): ReactNode => {
  const { t } = useT();
  return (
    <>
      <View style={styles.head}>
        <Title>{t('learning.title')}</Title>
        {/* `FE-W178`. The line under a screen title is `Secondary`, as on the call report. */}
        <Secondary>{t('learning.subtitle')}</Secondary>
      </View>
      {view.kind === 'loading' ? <Spinner label={t('learning.loadingCourses')} /> : null}
      {view.kind === 'offline' || view.kind === 'error' ? (
        <FailureCard failure={view} what="courses" />
      ) : null}
      {view.kind === 'loaded' && view.courses.length === 0 ? (
        <Card>
          <BodyText>{t('learning.noCourses')}</BodyText>
        </Card>
      ) : null}
      {view.kind === 'loaded' && view.courses.length > 0 ? (
        <View style={styles.list}>
          {view.courses.map((course) => (
            <ListRow
              detail={course.due === null ? course.line : `${course.line} · ${course.due}`}
              key={course.id}
              onPress={course.onOpen}
              title={course.title}
            />
          ))}
        </View>
      ) : null}
    </>
  );
};

// ---------------------------------------------------------------------------

export type CourseView =
  | { readonly kind: 'loading' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'nothing_published'; readonly title: string }
  | {
      readonly kind: 'can_start';
      readonly title: string;
      /**
       * `FE-W193`. What the course is about — the version's own summary, as the company wrote it —
       * and what it holds ("6 lessons · about 30 min"). Without them the page was a title and a
       * button: the rep was asked to start a course without being told what it was.
       */
      readonly summary?: string | null;
      readonly facts?: string | null;
      readonly starting: boolean;
      readonly choices: readonly { readonly label: string; readonly onStart: () => void }[];
      /** Set when the last start did not reach the server, or was refused. */
      readonly notice: string | null;
    }
  | {
      readonly kind: 'outline';
      readonly title: string;
      readonly done: number;
      readonly total: number;
      /** The server's completion stamp, already formatted, or null while not finished. */
      readonly finished: string | null;
      readonly sections: readonly {
        readonly title: string;
        readonly lessons: readonly {
          readonly id: string;
          readonly title: string;
          readonly detail: string;
          readonly onOpen: () => void;
        }[];
      }[];
    }
  | Failure;

export const CourseScreen = ({ view }: { readonly view: CourseView }): ReactNode => {
  const { t } = useT();
  switch (view.kind) {
    case 'loading':
      return <Spinner label={t('learning.loadingCourse')} />;
    case 'offline':
    case 'error':
      return <FailureCard failure={view} what="course" />;
    case 'not_found':
      return (
        <Banner
          detail={t('learning.courseNotFoundDetail')}
          title={t('learning.courseNotFoundTitle')}
          tone="info"
        />
      );
    case 'nothing_published':
      return (
        <>
          <Title>{view.title}</Title>
          <Card>
            <BodyText>{t('learning.nothingPublished')}</BodyText>
          </Card>
        </>
      );
    case 'can_start':
      return (
        <>
          <View style={styles.head}>
            <Title>{view.title}</Title>
            {view.facts === undefined || view.facts === null ? null : (
              <Secondary>{view.facts}</Secondary>
            )}
          </View>
          {view.summary === undefined || view.summary === null ? null : (
            <BodyText>{view.summary}</BodyText>
          )}
          {view.choices.length > 1 ? <Secondary>{t('learning.chooseMarket')}</Secondary> : null}
          <View style={styles.foot}>
            {view.choices.map((choice) => (
              <Button
                key={choice.label}
                label={
                  view.choices.length > 1
                    ? t('learning.startVersion', { version: choice.label })
                    : t('learning.startCourse')
                }
                loading={view.starting}
                onPress={choice.onStart}
              />
            ))}
          </View>
          {view.notice === null ? null : <Secondary>{view.notice}</Secondary>}
        </>
      );
    case 'outline':
      return (
        <>
          <View style={styles.head}>
            <Title>{view.title}</Title>
            <Secondary>
              {view.finished === null
                ? t('learning.lessonsFinished', { done: view.done, count: view.total })
                : t('learning.courseFinished', { date: view.finished })}
            </Secondary>
          </View>
          {view.sections.map((section) => (
            <View key={section.title} style={styles.section}>
              <Heading>{section.title}</Heading>
              {section.lessons.map((lesson) => (
                <ListRow
                  detail={lesson.detail}
                  key={lesson.id}
                  onPress={lesson.onOpen}
                  title={lesson.title}
                />
              ))}
            </View>
          ))}
        </>
      );
  }
};

// ---------------------------------------------------------------------------

export type LessonView =
  | { readonly kind: 'loading' }
  | { readonly kind: 'not_found' }
  | {
      readonly kind: 'reading';
      readonly title: string;
      readonly body: string;
      readonly minutes: string | null;
      /**
       * `FE-W127` — what the lesson shows above its text, when it has more than text: the app's video
       * player. A slot rather than a player here, so the design system takes no media dependency.
       */
      readonly media?: ReactNode;
      /** The server's stamp for this lesson, already formatted, or null while not finished. */
      readonly finished: string | null;
      readonly recording: boolean;
      readonly onFinish: () => void;
      /** What happened to the last attempt to record a finish, in the rep's words, or null. */
      readonly notice: string | null;
    }
  | Failure;

/**
 * UX polish. A lesson's text, read as the author wrote it: paragraphs split on a blank line, a line
 * opening with `# ` as a section heading, `- ` or `• ` as a bullet. It was one `BodyText` -- a long
 * clinical lesson arrived as a single wall of text. Nothing is reworded or reordered; a body with
 * no blank lines renders exactly as before.
 *
 * `FE-W193`. A heading with nothing under it — the last block, or straight before another heading —
 * is not drawn: a "Check yourself" left without its questions is a title that asks the rep to do
 * something and gives them nothing to do. A heading WITH its questions under it is the author's
 * section and stays, drawn like every other section of the lesson.
 */
const isHeading = (block: string | undefined): boolean => block?.startsWith('# ') ?? false;

export const LessonBody = ({ body }: { readonly body: string }): ReactNode => (
  <View style={styles.lessonBody}>
    {body
      .split(/\n\s*\n/u)
      .map((block) => block.trim())
      .filter((block) => block !== '')
      .map((block, index, blocks) => {
        const key = `${String(index)}:${block.slice(0, 24)}`;
        if (isHeading(block)) {
          const next = blocks[index + 1];
          return next === undefined || isHeading(next) ? null : (
            <Heading key={key}>{block.slice(2)}</Heading>
          );
        }
        const lines = block.split('\n');
        if (lines.every((line) => /^\s*[-•]\s+/u.test(line))) {
          return (
            <View key={key} style={styles.bullets}>
              {lines.map((line) => (
                <View key={line} style={styles.bullet}>
                  <BodyText>•</BodyText>
                  <View style={styles.bulletText}>
                    <BodyText>{line.replace(/^\s*[-•]\s+/u, '')}</BodyText>
                  </View>
                </View>
              ))}
            </View>
          );
        }
        return <BodyText key={key}>{block}</BodyText>;
      })}
  </View>
);

export const LessonScreen = ({ view }: { readonly view: LessonView }): ReactNode => {
  const { t } = useT();
  switch (view.kind) {
    case 'loading':
      return <Spinner label={t('learning.loadingLesson')} />;
    case 'offline':
    case 'error':
      return <FailureCard failure={view} what="lesson" />;
    case 'not_found':
      return (
        <Banner
          detail={t('learning.lessonNotFoundDetail')}
          title={t('learning.lessonNotFoundTitle')}
          tone="info"
        />
      );
    case 'reading':
      return (
        <>
          <View style={styles.head}>
            <Title>{view.title}</Title>
            {view.minutes === null ? null : <Secondary>{view.minutes}</Secondary>}
          </View>
          {view.media ?? null}
          <LessonBody body={view.body} />
          <View style={styles.foot}>
            {view.finished === null ? (
              <Button
                // "Saving", not "Recording": in this app "recording" means audio of a doctor.
                label={view.recording ? t('learning.saving') : t('learning.finishLesson')}
                loading={view.recording}
                onPress={view.onFinish}
              />
            ) : (
              <Card>
                <BodyText>{t('learning.finishedRecorded', { when: view.finished })}</BodyText>
              </Card>
            )}
            {view.notice === null ? null : <Secondary>{view.notice}</Secondary>}
          </View>
        </>
      );
  }
};
