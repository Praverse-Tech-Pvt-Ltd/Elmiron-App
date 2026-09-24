-- Rollback for AI-C1 -- removes approved knowledge.
--
-- What rolling back MEANS: every document, every version -- approved or not, with its reviewer
-- and attestation -- and every chunk is destroyed. That is the record of what the company
-- approved and when; do not run this where anything has been approved unless that loss is the
-- intent. audit_log rows recording approvals are NOT removed (append-only). Any AI feature built
-- on `search_approved_knowledge` must be rolled back first.

drop table if exists public.knowledge_chunks;
drop table if exists public.knowledge_document_versions;
drop table if exists public.knowledge_documents;

drop function if exists public.search_approved_knowledge(text, uuid, uuid, integer);
drop function if exists public.retire_knowledge_version(uuid);
drop function if exists public.reject_knowledge_version(uuid, text);
drop function if exists public.approve_knowledge_version(uuid, text);
drop function if exists public.submit_knowledge_version(uuid);
drop function if exists public.knowledge_admin_version(uuid);
drop function if exists public.knowledge_chunk_version(uuid);
drop function if exists public.knowledge_version_readable(uuid);
drop function if exists public.knowledge_versions_before_update();
drop function if exists public.knowledge_versions_before_insert();
drop function if exists public.knowledge_documents_validate();

drop type if exists public.knowledge_version_status;
drop type if exists public.knowledge_document_type;
