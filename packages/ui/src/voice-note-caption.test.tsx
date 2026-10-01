import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { VoiceNoteScreen } from './VoiceNoteScreen';
import type { VoiceNoteScreenProps } from './VoiceNoteScreen';

/**
 * **FE-D12 V4.** The line under the timer. After a 4-second note was captured, the screen read
 * "00:04" over **"hold the button to start"**, which tells the rep they have not recorded anything,
 * while "Save this note" sat right below it. A captured, unsaved note is the state in which
 * `onSave` is passed, so that is what the caption follows. The other two states keep their words.
 */
const base: VoiceNoteScreenProps = {
  elapsed: '00:00',
  hint: 'Try covering what they asked.',
  onHoldEnd: () => undefined,
  onHoldStart: () => undefined,
  onStartAgain: () => undefined,
  prompt: 'What should I put in the report?',
  recording: false,
  subject: 'Your note',
};

describe('VoiceNoteScreen — the caption under the timer (FE-D12 V4)', () => {
  it('says the note is recorded once there is one to save', async () => {
    await render(<VoiceNoteScreen {...base} elapsed="00:04" onSave={() => undefined} />);
    expect(screen.getByText('recorded · save it, or start again')).toBeTruthy();
    expect(screen.queryByText('hold the button to start')).toBeNull();
  });

  it('still says how to start when nothing has been recorded', async () => {
    await render(<VoiceNoteScreen {...base} />);
    expect(screen.getByText('hold the button to start')).toBeTruthy();
  });

  it('still says to keep holding while recording', async () => {
    await render(<VoiceNoteScreen {...base} recording />);
    expect(screen.getByText('keep holding · release to finish')).toBeTruthy();
  });
});
