-- Rollback for MR-54 `BE-W96` -- restores `complete_upload` to its MR-37 B2 body, in which
-- `p_recorded_at` is the device's unbounded word again.
--
-- Taken verbatim from 20260916000100 rather than hand-written, so rolling back cannot
-- quietly also roll back the size-is-observed rule that migration carried.

CREATE OR REPLACE FUNCTION public.complete_upload(p_grant_id uuid, p_object_id uuid, p_duration_seconds integer, p_size_bytes bigint, p_recorded_at timestamp with time zone, p_bitrate_kbps integer DEFAULT 28)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid     uuid;
  v_grant   public.upload_grants%rowtype;
  v_consent public.consent_records%rowtype;
  v_observed_bytes bigint;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_grant from public.upload_grants g where g.id = p_grant_id and g.mr_id = v_uid
   for update;
  if not found then
    raise exception 'upload grant % is not yours', p_grant_id using errcode = '42501';
  end if;

  -- Already finalised. Returning the existing object rather than raising is what
  -- makes the sync queue safe to retry: the device that lost the response resends
  -- and gets the same answer.
  if v_grant.state = 'completed' then
    return jsonb_build_object('kind', v_grant.kind, 'objectId', p_object_id,
                              'storageKey', v_grant.storage_key, 'alreadyCompleted', true);
  end if;

  -- The last consent check, and the one that matters most: everything before it
  -- guarded permission to WRITE bytes, and this one guards permission to KEEP them.
  perform public.assert_upload_still_permitted(v_grant);

  -- `FE-W46`, MR-37 B2. THE SIZE IS THE SERVER'S OBSERVATION, NOT THE CLIENT'S CLAIM.
  --
  -- The bytes have already landed in Storage by the time this runs, and Storage records how
  -- many arrived: `storage.objects.metadata ->> 'size'`, written from the request it actually
  -- received. Measured on the local stack, 118 of 118 objects carry that key.
  --
  -- `p_size_bytes` is therefore a claim about a fact the server already holds, and the ceiling
  -- it used to feed is a limit on the very client making the claim. The field app has been
  -- sending a literal `1` since the recording screen was written, because the real count was
  -- not available to it -- so every row is worth one byte and `audio_storage_bytes()` sums
  -- exactly those columns. This is the same correction `capture_consent` and `record_check_in`
  -- were both rewritten around: if the server knows, the server decides.
  --
  -- The parameter is kept so the signature, its grants and every caller are unchanged. It is
  -- now ignored for the stored value, which is why no client has to ship for this to take
  -- effect.
  select (o.metadata ->> 'size')::bigint
    into v_observed_bytes
    from storage.objects o
   where o.bucket_id = 'audio'
     and o.name = v_grant.storage_key;

  -- A precondition, asserted rather than assumed. Finalising an upload for which nothing was
  -- ever stored writes a row claiming bytes that do not exist -- and the old version allowed
  -- exactly that, because it never looked.
  if v_observed_bytes is null then
    raise exception 'nothing has been stored at %, so there is nothing to finalise',
      v_grant.storage_key
      using errcode = '22023',
            hint = 'Upload the audio before finalising it. If the upload failed, begin it again.';
  end if;

  if v_observed_bytes <= 0 or v_observed_bytes > v_grant.max_bytes then
    raise exception 'the finalised size % does not fit the grant''s % bytes',
      v_observed_bytes, v_grant.max_bytes using errcode = '22023';
  end if;

  if p_duration_seconds is null or p_duration_seconds <= 0
     or p_duration_seconds > v_grant.max_duration_seconds then
    raise exception 'the finalised duration % does not fit the grant''s % seconds',
      p_duration_seconds, v_grant.max_duration_seconds using errcode = '22023';
  end if;

  if v_grant.kind = 'recording' then
    select * into v_consent
      from public.consent_records c
     where c.visit_id = v_grant.visit_id
       and c.outcome = 'consented'
       and c.is_withdrawal = false
       and not exists (select 1 from public.consent_records w
                        where w.supersedes_consent_record_id = c.id)
     order by c.captured_at desc
     limit 1;

    insert into public.recordings
      (id, visit_id, mr_id, consent_record_id, storage_key, bitrate_kbps,
       duration_seconds, size_bytes, upload_status, recorded_at, purge_after)
    values
      (p_object_id, v_grant.visit_id, v_uid, v_consent.id, v_grant.storage_key,
       coalesce(p_bitrate_kbps, 28), p_duration_seconds, v_observed_bytes, 'uploaded',
       p_recorded_at, now())
    on conflict (id) do nothing;
  else
    insert into public.voice_notes
      (id, visit_id, mr_id, storage_key, duration_seconds, size_bytes,
       upload_status, recorded_at, purge_after)
    values
      (p_object_id, v_grant.visit_id, v_uid, v_grant.storage_key,
       p_duration_seconds, v_observed_bytes, 'uploaded', p_recorded_at, now())
    on conflict (id) do nothing;
  end if;

  -- Single-use means consumed at FINALISATION, not at first byte. Until this line
  -- the storage policy still lets chunks through; after it, nothing more is written
  -- at that key by anybody.
  update public.upload_grants
     set state         = 'completed',
         consumed_at   = clock_timestamp(),
         closed_at     = clock_timestamp(),
         closed_reason = 'upload finalised',
         bytes_received = greatest(bytes_received, p_size_bytes)
   where id = p_grant_id;

  return jsonb_build_object('kind', v_grant.kind, 'objectId', p_object_id,
                            'storageKey', v_grant.storage_key, 'alreadyCompleted', false);
end;
$function$;
