import { File } from 'expo-file-system';
import { documentRoot } from '../capture/voice-note-fs';
import type { VoiceNoteDeps } from './push-client';

/**
 * MR-51 D1 — `uploadVoiceNote`'s device half: the kept file through `expo-file-system` (`C11`,
 * pinned 57.0.2 — `size` and `bytes()` are in that version, so no further library), the private
 * `audio` bucket and one read through `supabase-js`.
 *
 * Kept thin, as `voice-note-fs.ts` is: every rule lives in `push-client.ts`, where it is tested
 * without a device. Loaded on first use, because `../supabase` throws at import without an `.env`.
 */
const client = async () => (await import('../supabase')).supabase;

export const deviceVoiceNotes: VoiceNoteDeps = {
  signedInUserId: async () => {
    const { data } = await (await client()).auth.getSession();
    return data.session?.user.id ?? null;
  },
  documentRoot,
  fileExists: (uri) => new File(uri).exists,
  fileSize: (uri) => new File(uri).size,
  fileBytes: async (uri) => (await new File(uri).bytes()).buffer,
  removeFile: (uri) => {
    new File(uri).delete();
  },
  storeObject: async (key, bytes) => {
    // `upsert`: a retry after a partial send overwrites under the same live grant. The bucket's
    // INSERT, UPDATE and SELECT policies all require `has_live_upload_grant(name)`, so nothing
    // here can write where the server did not issue a key. The recorder writes AAC in an MP4
    // container; the content type says so whatever the server's key suffix is (`BE-W111`).
    const { error } = await (
      await client()
    ).storage
      .from('audio')
      .upload(key, bytes, { contentType: 'audio/mp4', upsert: true });
    if (error !== null) throw new Error(error.message);
  },
  storedAt: async (noteId) => {
    const { data, error } = await (
      await client()
    )
      .from('voice_notes')
      .select('received_at')
      .eq('id', noteId)
      .maybeSingle();
    if (error !== null) throw new Error(error.message);
    const row = data as { received_at?: unknown } | null;
    return typeof row?.received_at === 'string' ? row.received_at : null;
  },
};
