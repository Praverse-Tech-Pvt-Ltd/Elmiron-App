import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { BodyText, Heading, Label, Title } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { ListRow } from './ListRow';

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
 */

const styles = StyleSheet.create({
  head: { gap: 2 },
  list: { gap: tokens.space.sm },
  section: { gap: tokens.space.xs, paddingTop: tokens.space.sm },
  foot: { gap: tokens.space.sm, paddingTop: tokens.space.md },
});

type Failure =
  | { readonly kind: 'offline'; readonly onRetry: () => void }
  | { readonly kind: 'error'; readonly onRetry: () => void };

const FailureCard = ({
  failure,
  what,
}: {
  readonly failure: Failure;
  readonly what: string;
}): ReactNode => (
  <Card>
    <BodyText>
      {failure.kind === 'offline'
        ? `No signal, so ${what} could not be loaded.`
        : `${what.charAt(0).toUpperCase()}${what.slice(1)} did not load.`}
    </BodyText>
    <Button label="Try again" onPress={failure.onRetry} variant="secondary" />
  </Card>
);

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

export const LearningListScreen = ({ view }: { readonly view: LearningListView }): ReactNode => (
  <>
    <View style={styles.head}>
      <Title>Learning</Title>
      <Label muted>The courses assigned to you.</Label>
    </View>
    {view.kind === 'loading' ? <Label muted>Loading your courses…</Label> : null}
    {view.kind === 'offline' || view.kind === 'error' ? (
      <FailureCard failure={view} what="your courses" />
    ) : null}
    {view.kind === 'loaded' && view.courses.length === 0 ? (
      <Card>
        <BodyText>No course has been assigned to you.</BodyText>
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

// ---------------------------------------------------------------------------

export type CourseView =
  | { readonly kind: 'loading' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'nothing_published'; readonly title: string }
  | {
      readonly kind: 'can_start';
      readonly title: string;
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
  switch (view.kind) {
    case 'loading':
      return <Label muted>Loading the course…</Label>;
    case 'offline':
    case 'error':
      return <FailureCard failure={view} what="this course" />;
    case 'not_found':
      return (
        <Banner
          detail="This course is not one your company has published to you."
          title="Course not available"
          tone="info"
        />
      );
    case 'nothing_published':
      return (
        <>
          <Title>{view.title}</Title>
          <Card>
            <BodyText>
              No version of this course has been published yet, so there is nothing to start.
            </BodyText>
          </Card>
        </>
      );
    case 'can_start':
      return (
        <>
          <Title>{view.title}</Title>
          {view.choices.length > 1 ? (
            <Label muted>
              This course has a version for more than one market. Start the one for where you work.
            </Label>
          ) : null}
          <View style={styles.foot}>
            {view.choices.map((choice) => (
              <Button
                key={choice.label}
                label={view.choices.length > 1 ? `Start: ${choice.label}` : 'Start this course'}
                loading={view.starting}
                onPress={choice.onStart}
              />
            ))}
          </View>
          {view.notice === null ? null : <Label muted>{view.notice}</Label>}
        </>
      );
    case 'outline':
      return (
        <>
          <View style={styles.head}>
            <Title>{view.title}</Title>
            <Label muted>
              {view.finished === null
                ? `${String(view.done)} of ${String(view.total)} lessons finished`
                : `Course finished ${view.finished}`}
            </Label>
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
      /** The server's stamp for this lesson, already formatted, or null while not finished. */
      readonly finished: string | null;
      readonly recording: boolean;
      readonly onFinish: () => void;
      /** What happened to the last attempt to record a finish, in the rep's words, or null. */
      readonly notice: string | null;
    }
  | Failure;

export const LessonScreen = ({ view }: { readonly view: LessonView }): ReactNode => {
  switch (view.kind) {
    case 'loading':
      return <Label muted>Loading the lesson…</Label>;
    case 'offline':
    case 'error':
      return <FailureCard failure={view} what="this lesson" />;
    case 'not_found':
      return (
        <Banner
          detail="This lesson is not part of a course you can open."
          title="Lesson not available"
          tone="info"
        />
      );
    case 'reading':
      return (
        <>
          <View style={styles.head}>
            <Title>{view.title}</Title>
            {view.minutes === null ? null : <Label muted>{view.minutes}</Label>}
          </View>
          <BodyText>{view.body}</BodyText>
          <View style={styles.foot}>
            {view.finished === null ? (
              <Button
                label={view.recording ? 'Recording…' : 'I have finished this lesson'}
                loading={view.recording}
                onPress={view.onFinish}
              />
            ) : (
              <Card>
                <BodyText>{`Finished — recorded ${view.finished}.`}</BodyText>
              </Card>
            )}
            {view.notice === null ? null : <Label muted>{view.notice}</Label>}
          </View>
        </>
      );
  }
};
