# Id ledger — every BE-/FE- id, minted once, never reused

> **The rule (W1-Q C, proposed by backend): an id, once on `main`, is never deleted, renumbered or
> given a new meaning.** A new id is minted by adding ONE row here, by the track its prefix names,
> in the same commit that first cites it. `node scripts/check-ids.mjs` enforces it in CI:
>
> 1. every id has exactly one row; 2. every row on `main` is still here, unchanged;
> 3. every `BE-`/`FE-` id cited in a tracked file has a row; 4. a row's track matches its prefix.
>
> **Why.** Prefixes (`BE-C3`, `BE-C4`) stopped two tracks minting the same id at the same moment. They
> did not stop one track minting INTO the other's space (`BE-C4` named the voice note `FE-CR-1`) or
> renumbering into an id already used (CR-1 → `FE-CR-1`). Both now fail rule 1 or rule 4.
>
> **What no check can catch:** citing an EXISTING id to mean something new without touching this
> file. That is why rule 3 makes minting an act — you add a row, and a taken number fails rule 1.

Bootstrapped 2026-10-01 from 289 ids cited in tracked files. Meanings for
bootstrap rows are not restated here; the first file that cites each is the pointer.

| Id | Minted by | Meaning |
| --- | --- | --- |
| `BE-C1` | backend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `BE-C2` | backend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `BE-C3` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C4` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C5` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C6` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C7` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C8` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C9` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C10` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C11` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C12` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C13` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C14` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C15` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C16` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C17` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C18` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C19` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C20` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C21` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C22` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C23` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C24` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C25` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C26` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C27` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C28` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C29` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C30` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C31` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C32` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C33` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C34` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C35` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C36` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C37` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C38` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C39` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C40` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C41` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C42` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C43` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C44` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C45` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C46` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C47` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C48` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C49` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C50` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C51` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C52` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C53` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C54` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C55` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C56` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C57` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C58` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C59` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C60` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-C61` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-CR-1` | backend | existing at bootstrap; first cited in `docs/contract-requests.md` |
| `BE-CR-2` | backend | existing at bootstrap; first cited in `docs/contract-requests.md` |
| `BE-CR-3` | backend | existing at bootstrap; first cited in `docs/contract-requests.md` |
| `BE-CR-4` | backend | existing at bootstrap; first cited in `docs/contract-requests.md` |
| `BE-CR-5` | backend | existing at bootstrap; first cited in `docs/contract-requests.md` |
| `BE-CR-6` | backend | existing at bootstrap; first cited in `docs/4-OCTOBER.md` |
| `BE-W1` | backend | existing at bootstrap; first cited in `.ai-collab/rollback.md` |
| `BE-W2` | backend | existing at bootstrap; first cited in `.ai-collab/constraints.md` |
| `BE-W3` | backend | existing at bootstrap; first cited in `.ai-collab/constraints.md` |
| `BE-W4` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W5` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W6` | backend | existing at bootstrap; first cited in `.ai-collab/bug-log.md` |
| `BE-W7` | backend | existing at bootstrap; first cited in `.ai-collab/README.md` |
| `BE-W8` | backend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `BE-W9` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W10` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W11` | backend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `BE-W12` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W13` | backend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `BE-W14` | backend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `BE-W15` | backend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `BE-W16` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W17` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W18` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W19` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W20` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W21` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-W22` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W23` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W24` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W25` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W26` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W27` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W28` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W29` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W30` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W31` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W32` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-W33` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W34` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W35` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W36` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W37` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W38` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W39` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W40` | backend | existing at bootstrap; first cited in `.ai-collab/constraints.md` |
| `BE-W41` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W42` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W43` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W44` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W45` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W46` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W47` | backend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `BE-W48` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W49` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W50` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W51` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W52` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W53` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W54` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W55` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W56` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W57` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W58` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W59` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W60` | backend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `BE-W61` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W62` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W63` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W64` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W65` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W66` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W67` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W68` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W69` | backend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `BE-W70` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W71` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W72` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W73` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W74` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W75` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W76` | backend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `BE-W77` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W78` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W79` | backend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `BE-W80` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W81` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W82` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W83` | backend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `BE-W84` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W85` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W86` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W87` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W88` | backend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `BE-W89` | backend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `BE-W90` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W91` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W92` | backend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `BE-W93` | backend | existing at bootstrap; first cited in `.ai-collab/constraints.md` |
| `BE-W94` | backend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `BE-W95` | backend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `BE-W96` | backend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `BE-W97` | backend | existing at bootstrap; first cited in `.ai-collab/architecture.md` |
| `BE-W98` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W99` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W100` | backend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `BE-W101` | backend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `BE-W102` | backend | existing at bootstrap; first cited in `.ai-collab/bug-log.md` |
| `BE-W103` | backend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `BE-W104` | backend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `BE-W105` | backend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `BE-W106` | backend | existing at bootstrap; first cited in `.ai-collab/bug-log.md` |
| `BE-W107` | backend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `BE-W108` | backend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `BE-W109` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-W110` | backend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `BE-W111` | backend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `BE-W112` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W113` | backend | existing at bootstrap; first cited in `.ai-collab/bug-log.md` |
| `BE-W114` | backend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `BE-W115` | backend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `BE-W116` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W117` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W118` | backend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `BE-W119` | backend | existing at bootstrap; first cited in `.githooks/pre-push` |
| `BE-W120` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-W121` | backend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W122` | backend | existing at bootstrap; first cited in `apps/console/e2e/practice.spec.ts` |
| `BE-W123` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W124` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W125` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W126` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W127` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-W128` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-W129` | backend | existing at bootstrap; first cited in `.ai-collab/decisions-backend.md` |
| `BE-W130` | backend | existing at bootstrap; first cited in `docs/4-OCTOBER.md` |
| `BE-W131` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W132` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W133` | backend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `BE-W134` | backend | product_qa has no step that can set `possible_adverse_event`, `off_label_request` or `possible_quality_complaint`; three benchmark cases expect it (W1-Q A) |
| `FE-CR-1` | frontend | `BACKUP_DESTINATION` (was CR-1, renamed FE-D13). **Collision:** `BE-C4` also used this id for the voice note, which is `FE-CR-5` — never reuse it for anything else |
| `FE-CR-2` | frontend | existing at bootstrap; first cited in `docs/contract-requests.md` |
| `FE-CR-3` | frontend | existing at bootstrap; first cited in `docs/contract-requests.md` |
| `FE-CR-4` | frontend | existing at bootstrap; first cited in `CLAUDE.md` |
| `FE-CR-5` | frontend | existing at bootstrap; first cited in `CLAUDE.md` |
| `FE-D1` | frontend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `FE-D2` | frontend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `FE-D3` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-D4` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-D5` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-D6` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-D7` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-D8` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-D9` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-D10` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-D11` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-D12` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-D13` | frontend | existing at bootstrap; first cited in `CLAUDE.md` |
| `FE-D16` | frontend | Coaching, Analysis and Reply made ready, still hidden; first cited in `PROJECT-OVERVIEW.md` (PR #14). Row added by backend on 5 October, W1-W, when PR #14 was merged with `main` |
| `FE-D17` | frontend | AI Doctor practice on sample data, and the clock lint in packages/ui; first cited in `PROJECT-OVERVIEW.md` (PR #15). Row added by backend on 5 October, W1-W, when PR #15 was merged with its base |
| `FE-W1` | frontend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `FE-W2` | frontend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `FE-W3` | frontend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `FE-W4` | frontend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `FE-W5` | frontend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `FE-W6` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-W7` | frontend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `FE-W8` | frontend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `FE-W9` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-W10` | frontend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `FE-W11` | frontend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `FE-W12` | frontend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `FE-W13` | frontend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `FE-W14` | frontend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `FE-W15` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-W16` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-W17` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-W18` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-W19` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-W20` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-W21` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-W22` | frontend | existing at bootstrap; first cited in `apps/field/src/sync/pull.test.ts` |
| `FE-W23` | frontend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `FE-W24` | frontend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `FE-W25` | frontend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `FE-W26` | frontend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `FE-W27` | frontend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `FE-W28` | frontend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `FE-W29` | frontend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `FE-W30` | frontend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `FE-W31` | frontend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `FE-W32` | frontend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `FE-W33` | frontend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `FE-W34` | frontend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `FE-W35` | frontend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `FE-W36` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-W37` | frontend | existing at bootstrap; first cited in `docs/COMPLETION-PLAN.md` |
| `FE-W38` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-W39` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-W40` | frontend | existing at bootstrap; first cited in `.ai-collab/constraints.md` |
| `FE-W41` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-W42` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-W43` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-W44` | frontend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `FE-W45` | frontend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `FE-W46` | frontend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `FE-W47` | frontend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `FE-W48` | frontend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `FE-W49` | frontend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `FE-W50` | frontend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `FE-W51` | frontend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `FE-W52` | frontend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `FE-W53` | frontend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `FE-W54` | frontend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `FE-W55` | frontend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `FE-W56` | frontend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `FE-W57` | frontend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `FE-W58` | frontend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `FE-W59` | frontend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `FE-W60` | frontend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `FE-W61` | frontend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `FE-W62` | frontend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `FE-W63` | frontend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `FE-W64` | frontend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `FE-W65` | frontend | existing at bootstrap; first cited in `.ai-collab/decisions.md` |
| `FE-W66` | frontend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `FE-W67` | frontend | existing at bootstrap; first cited in `.ai-collab/handover.md` |
| `FE-W68` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `FE-W69` | frontend | existing at bootstrap; first cited in `.ai-collab/bug-log.md` |
| `FE-W70` | frontend | existing at bootstrap; first cited in `PROJECT-OVERVIEW.md` |
| `BE-W135` | backend | `mr_chat` and `ai_doctor` sent client-supplied `history` to the model unscreened for patient details; fixed W1-Q E1. Residual: an `assistant`/`doctor` turn is still the client's word |
| `FE-CR-6` | frontend | carry the AI allowance and its reset time to the app (filed on `fe-d14-screens`); answered W1-Q |
| `FE-CR-7` | frontend | land the chat contract in `packages/core` on `main` (filed on `fe-d14-screens`); lands with PR #2 |
| `FE-CR-8` | frontend | what writes an analysis and its findings, and when (filed on `fe-d16-coaching`); open. Row added by backend on 5 October, W1-W, when PR #14 was merged with `main` |
| `FE-CR-9` | frontend | should opening an analysis stamp `mr_viewed_at` (filed on `fe-d16-coaching`); open. Row added by backend on 5 October, W1-W, when PR #14 was merged with `main` |
| `FE-CR-10` | frontend | queue a reply offline, and the shape `respond_to_analysis` returns (filed on `fe-d16-coaching`); open. Row added by backend on 5 October, W1-W, when PR #14 was merged with `main` |
| `BE-C62` | backend | the coach's analysis covers the operator's TEN items; "Strengths" is the existing list, nothing changes (W1-R B) |
| `BE-C63` | backend | practice-analysis visibility MR + Admin yes, Manager no — measured as met (W1-R B4) |
| `BE-W136` | backend | the AI doctor and coach took persona brief, stance, objective, objection and turns from the CLIENT although the server holds them; the approved persona brief never reached the model (W1-R C) |
| `FE-CR-11` | frontend | the AI Doctor practice-session contract on `main` (filed on `fe-d17-practice`, `fbd5e4f`); lands with PR #2 |
| `BE-C64` | backend | the request log flags a model refusal `model_refused` and keeps a vendor error's NAME in `error_code` (W1-S B) |
| `BE-W137` | backend | no tool creates the MR sheet's accounts on production: `seed:mr` refuses remote targets by design; accounts are made by hand (runbook step 4) |
| `BE-C65` | backend | the `model_refused` rollback refuses while a refusal is recorded; the request log is never rewritten (W1-T B) |
| `BE-W138` | backend | `write_rejections` has no append-only trigger, unlike every other record-of-what-happened table (W1-T B4) |
| `BE-W139` | backend | day-one consequence of `BE-W23`/`FE-W28`: nothing in production creates a beat plan or a visit, the cut list's "manual assignment for the pilot" has no tool or runbook step, and no operator input asks for it — a rep's Today is empty (W1-T C) |
| `BE-C66` | backend | settings belong to each company (operator item 15); `BE-W106` closed by the schema, two gaps remain (W1-U3 C) |
| `BE-W140` | backend | a company's default working hours can only be temporary: the 60-day expiry on `org_default_shift_window` checks the key, not the scope |
| `BE-W141` | backend | `ucpmp_cap_decision_status` runs with no caller and reads only the GLOBAL cap: a company-level cap would not stop the 6 November build failure |
| `BE-CR-7` | backend | which items on the operator's 4 October list have a screen and which only a server, measured from the code (W1-V E) |
| `BE-C67` | backend | a cut-off answer is flagged `output_truncated`, not `schema_invalid`; every Bedrock stop reason decided against the SDK enum (W1-W C) |
| `BE-W142` | backend | the Edge Function's npm imports are pinned exactly, but their TRANSITIVE dependencies are not: no Deno lockfile is committed, so the deployed function resolves them on deploy day while the tests run pnpm-lock's (W1-W D3) |
| `BE-W143` | backend | setting `BACKUP_DESTINATION` makes the backup job produce and verify a dump that is then stored NOWHERE: no step uploads it or reads the secret's value, so "no code change needed" is false and the runbook's 0.1 ("its artefact listed on the run") cannot pass on the answer alone (W1-W E) |
| `FE-D14` | frontend | Day end and Mileage on real data, and the AI-limit warning; first cited in `PROJECT-OVERVIEW.md` (merged with PR #13). Row added by backend on 5 October, W1-W: PR #13 reached `main` unregistered and turned the id check red |
| `FE-D15` | frontend | the operator's direction, the gap map, and the assistant on sample data; first cited in `PROJECT-OVERVIEW.md` (merged with PR #13). Row added by backend on 5 October, W1-W, for the same reason |
| `BE-C68` | backend | the unowned questions answered (W1-Y B): this release's "AI Analysis" is the practice feedback screen, Coaching/Analysis/Reply stay hidden; no read-stamp, no offline reply, no practice reply; self-written practice scores fixed before any admin sees one |
| `BE-W144` | backend | a rep can write BOTH sides of a practice turn (`record_sim_turn`) and their own coach score labelled as any model (`record_sim_coach_analysis`), both granted to `authenticated`; one analysis per session, so a self-written score blocks the real one (W1-Y B4) |
| `BE-W145` | backend | the coach flow handles only 22023/23514 from `record_sim_coach_analysis`; a 23505 (an analysis already exists) rethrows and leaves the AI request open after the model was paid for (W1-Y B4) |
| `BE-C69` | backend | a practice turn and score are written by the gateway as the service role, through a writer limited to `record_sim_turn` and `record_sim_coach_analysis`, each bound to the rep's open request; amends `C30` narrowly (W1-Z A) |
| `BE-W146` | backend | `ai_complete_request` runs as the rep, so a rep can close their own AI request as `completed` with any model name and token counts: the request log is forgeable row by row (found W1-Z A, not fixed) |
| `BE-C70` | backend | the service-role key is read in exactly one place (`_shared/practice-writer.ts`); a CI check fails on a second read, a whole-environment read, a computed name, a wider writer, or core reading the environment — what replaces `C30`'s spent absence (W2-A A) |
| `BE-W147` | backend | `BE-C5` built: an off-site or approximate check-in is TOLD to the rep in one line — `sync_push` warns (`check_in_outside_geofence`, `check_in_location_approximate`), the push client and outbox stop dropping warnings, the visit screen shows it (W2-B A) |
| `BE-W148` | backend | the emulator's five other findings: the MR-49 witnessed-consent regression (`7403c25` gated it on recording being on) fixed into the consent card, "He agreed" made neutral, "1 check-ins", no check-out time, the demo script's stale mock check; the ₹ "finding" was a misreading (W2-B B) |
| `BE-W149` | backend | `witnessedStage` counts SYNCED queue items as well as queued ones, so a flushed check-in still reads "Checked in — waiting to send" until the next pull lands (found W2-B A, not fixed) |
| `BE-W150` | backend | a release build refuses to start without `EXPO_PUBLIC_API_BASE_URL` (`app/_layout.tsx`), the address of the :4010 mock that no app file imports any more (found W2-B B3, not fixed) |
| `BE-W151` | backend | Today and Me read the queue once per MOUNT and a tab stays mounted: offline, Today said "Everything sent" over six queued writes and Me said "21 not sent" after all 21 had gone; also Today drew "Everything sent" before its first read. Fixed: the store announces every save, clear and owner change; Today starts from "not read" (W2-B C) |
| `BE-W152` | backend | sign-out failure is RETURNED by supabase-js, not thrown, so Me's "You are still signed in" never showed: offline, Sign out did nothing and said nothing on a shared handset. Fixed to surface the failure; whether an offline sign-out should still clear the phone is OPEN (W2-B C) |
| `BE-W153` | backend | after consent, `router.replace` leaves the earlier visit screen underneath: Back shows it with stale state, offering "Ask about recording" and check-out again for a finished visit (W2-B C, emulator, 2 of 2 visits; not fixed) |
| `BE-W154` | backend | offline, Today's "Next visit" and the route view ignore queued work — the finished visit is still "next", the route says "0 done" — and a second visit to the same doctor today cannot be reached from the route (W2-B C; not fixed) |
| `BE-W155` | backend | offline, the Doctors tab says "Could not load doctors" though the phone holds them — `FE-W62`'s defect on another screen (W2-B C; not fixed) |
| `BE-W156` | backend | the call-report header renders "Dr … · " with nothing after the dot (W2-B C, offline; not fixed) |
| `BE-W157` | backend | Today's sync line formats its time with `clockFrom`, the character slice that shows UTC on Supabase data: "Everything sent. 07:22" at 12:52 IST (W2-B D, emulator; not fixed) |
| `BE-W158` | backend | ONE shipped-configuration test: a jest day through the real routes, outbox and queue, fed a `sync_pull` fixture captured from the real local server (Z timestamps, recording off), push faked only at the RPC boundary — would have caught most of W2-B/W2-C's device findings (W2-C A5; not built) |
| `BE-W159` | backend | `BE-C36` built: the rep FLAGS a possible adverse event from the visit — through `sync_push` (new `adverse_event` kind → the existing `report_adverse_event`), offline too; who/when/what only, no severity or patient field; obvious identifiers (phone, email, 12-digit ID) withhold Send (W2-C B) |
| `BE-W160` | backend | Product Q&A screen on the REAL transport, behind `EXPO_PUBLIC_PRODUCT_QA` (off): "approved information not available" is its own honest state, an answer always shows its source; proved end to end by the screen's own transport against the local stack (W2-C C) |
| `BE-W161` | backend | the assistant's limit mapping reads `resetsAt` at the top of the gateway's 429 body; the gateway puts it inside `allowance`, so "that is all for today" never says when it resets (`assistant/outcome.ts:56`; found W2-C C, not fixed) |
| `BE-W162` | backend | the practice writer moved off the legacy `service_role` key (retired end of 2026) to the NAMED secret key `practice_writer` from `SUPABASE_SECRET_KEYS` (falling back to `default`); the check now forbids the legacy key in function code (W2-C D2) |
| `BE-W163` | backend | the coach's contract never names its JSON keys (`overallScore`, `dimensionScores`, `strengths`, `improvements`, `suggestedModules`, `summary`); the other four flows do, so a real model guesses them and every analysis fails `schema_invalid` — prediction #14 (W2-D A2) |
| `BE-W164` | backend | the console `/prompts` screen saves only feature and text: no `output_schema_name`, so every flow refuses a prompt approved there (`prompt_schema_mismatch`); it offers 3 of the 5 features (not `mr_chat`, `lms_tutor`) and cannot set `model_config` — prediction #15 (W2-D A2) |
| `BE-W165` | backend | a visit finished on the phone is ticked and counted done (the queue overlay, `BE-W154`) but its times are not overlaid: the route's stop reads "Not started" and Doctors says last seen "yesterday" until a pull reflects the server — found by the shipped-configuration day test (W2-D C, `shipped-day.test.tsx`; not fixed) |
| `BE-C71` | backend | `BE-W146` deferred with a trigger: fixed before production AI traffic or before anything reads `ai_requests` model, token or status fields — written into the key-day checklist (W2-A B) |
| `BE-C72` | backend | `BE-C70`'s check reduces ACCIDENTAL use and changes nothing about capability; rule 6 added (function code may not name `SUPABASE_SECRET_KEYS`, `SUPABASE_SECRET_KEY` or `SUPABASE_DB_URL`); no narrower key exists on the hosted platform as documented; move the writer off the legacy key before end of 2026 (W2-B E) |
| `BE-C73` | backend | `BE-C35`'s six are built as five persona BRIEFS on the existing four stances plus one scenario; `sim_persona_stance` is not widened (a stance is one prompt line and a label; nothing branches on it) (W2-D B3) |
| `BE-C74` | backend | `BE-W146` fixed: every AI request is closed by the gateway as the service role through `ai_gateway_complete_request`, bound to the request row (exists, still `started`); `ai_complete_request` is dropped, so a rep can open a request but never write its status, model or tokens; the practice writer's allow-list gains exactly that one name (W2-E C) |
| `BE-C75` | backend | the status table is complete by construction: `docs/operator/must-haves.json` holds the operator's fourteen items (direction 2 Oct, items 16-17) keyed OP-1..OP-14; every status table cites each key in a MODULE cell; `check-status-table.mjs` fails on a missing item, a status outside the four, a DONE row with a blocker, or a row naming Dev (W2-F C3) |
| `BE-W166` | backend | with no model, a LOCAL assistant answers every question with the real out-of-scope redirect ("That looks like a product question…"): the stub's default `mr_chat` reply is `inScope: false`, untrue of a how-to question and indistinguishable from a real refusal on the screen; production cannot show it (the stub refuses non-local targets, so `503 no_provider`); found W2-G A4, not fixed — the HTTP suites assert that default |
| `BE-C76` | backend | the date-bound plan documents (`docs/4-OCTOBER.md`, `docs/AFTER-4-OCTOBER.md`) are retired, not re-derived: the status table is the single list, checked against `docs/operator/must-haves.json`; each retired file begins with a banner naming that list, and `check-status-table.mjs` fails if a banner is removed or a listed file is missing (W2-G C) |
| `BE-W167` | backend | a course load that failed part-way left an empty DRAFT version that nothing could clear (publish refuses no lessons; draft→retired is illegal; no delete grant) and the loader then refused every re-run with `draft_already_open` — one dropped connection locked the course. Found W2-H D in the loader W2-H A built; fixed the same day: an open draft with no modules is reused, one with content is still refused (`tests/loaders.spec.ts`, mutated both ways) |
| `BE-W168` | backend | nothing in `apps/` publishes a course version or submits a knowledge draft: the console lists knowledge only when `in_review` and has no publish button, so every loaded course and every loaded document needed a hand-written RPC call to move on, and the W2-H loaders' messages pointed the admin at screens that do not exist. Found W2-I A4; fixed the same day with `services/api/scripts/content-step.mjs` (`publish-course`, `submit-knowledge`, as the signed-in admin; never approves) and corrected loader messages. A console button is still not built |
| `BE-W170` | backend | a draft submitted by an admin who did NOT write it can never be approved in a two-admin organisation: `submit_knowledge_version`, `submit_ai_prompt_version` and `submit_sim_content` accept any admin of the organisation, and every `approve_*` refuses the author AND the submitter. Found 9 October ("Pratham — joining", `docs/log/backend.md`). The knowledge screen built that day draws Submit only for the author; **the prompt and simulation screens still draw it for every admin, and no function refuses it.** Open: whether the database should refuse a non-author submit |
| `BE-C77` | backend | the AUTHOR submits a draft for review and a DIFFERENT admin approves or rejects it; the author may not decide their own content. Held by each `submit_*` refusing a non-author `42501` and a `*_author_submits` CHECK on knowledge, prompt, persona and scenario versions (`20261009000100_author_submits`). Closes `BE-W170`. Courses excluded until Q-21 |
| `BE-W169` | backend | no script or page makes a production APK, and the Expo template signs every RELEASE build with the public Android debug key, so `assembleRelease` made a release-looking APK anyone could replace; found W2-I C. Built what can be built without a key: `apps/field/plugins/release-signing.cjs` (a non-demo release build uses the company key from four Gradle properties or Gradle REFUSES it; demo builds unchanged) and `apps/field/scripts/verify-release-apk.mjs` (refuses the debug key, more than one signer, or a signer that is not the operator-supplied fingerprint). Still missing: the release key (operator), the production address (Q-19), the start-up gate ruling (`BE-W150`), a versionCode rule, and the production build script that uses them |
| `BE-W171` | backend | manager planning did not exist: nothing wrote a rep's plan but the rep, the phone never creates a visit (a stop without a server visit cannot be checked in), and a plan-less visit was indistinguishable from a malformed one. Built `20261009000200_manager_planning`: `plan_mr_day`, `reassign_planned_visits`, `grant_planning_access`/`revoke_planning_access`, `plannable_reps`, `manager_day_review`, `review_unplanned_visit`; `visits.origin`; tests `manager-planning.spec.ts`. Console and phone screens still to build |
| `BE-C78` | backend | a FIELD MANAGER plans a rep's day (own subtree, or an admin's dated, revocable GRANT); an ADMIN grants scope and never plans or writes a visit; a visit is a rep's; every save is a new plan version and a started/finished visit is never touched; reassignment is explicit and audited; a rep's own visit is UNPLANNED with a reason, needs no approval, and is reviewed afterwards; no signed-in caller creates an unclassified visit. Answers Q-16/Q-17/Q-18 as given in the development instruction of 9 October 2026 |
| `BE-W172` | backend | every `ci-local --with-db` run -- so every push through `.githooks/pre-push` -- left the AI-gateway server running: the step backgrounds `supabase functions serve` with `&`, a GitHub runner kills it at job end, and nothing locally did. A `sh` → `pnpm.js exec` → `node supabase.js` → `supabase.exe` tree was measured alive 25+ minutes after its run, parent gone, holding inherited stdout/stderr. Fixed in `scripts/ci-local.mjs`: each step's shell PID and run window are recorded, and afterwards only processes whose parent is one of those shells AND that were born inside its window are stopped, with their trees (Windows; no name matching). An earlier stall of pnpm after "Done" was seen once and is NOT reproduced or explained by this |
| `BE-W173` | backend | check-ins and check-outs had no device-clock bound: only a visit's FIRST check-in was refused in the future, by accident (via `started_at`), and a check-out before its check-in was clamped to 0 seconds or failed as a bare 23514. `20261009000300_check_in_out_clock_bounds` applies the existing `consent_future_tolerance_seconds` (120, inclusive) to both through `assert_field_event_not_in_future` (45013 `field_event_in_future`) and refuses a check-out before the first check-in (45014 `check_out_before_check_in`). No age limit on old offline events (none exists for check-ins). Tests `check-in-clock.spec.ts` |
| `BE-W174` | backend | `daily_mileage` dated each check-in by the DOCTOR's territory zone with an `Asia/Kolkata` fallback, while `visit_day()`/`coverage()`/Today use the REP's zone with a UTC fallback, so a check-in could count on a different day from its own visit. `20261009000400_mileage_day_zone` uses `day_zone_unchecked(<rep>)`, the one rule; the Asia/Kolkata literal is gone. Tests `mileage-day-zone.spec.ts` (offsets, 23:59/00:00, UTC boundary, late sync, DST, doctor moved, no zone configured) |
| `BE-W175` | backend | call reports accepted ANY product ids (an array, so no foreign key; no company or active check) and the phone sent `[]` because it had no catalogue. `20261009000500_call_report_products`: each id must be a product of the rep's organisation (unknown and other-company are one answer, 23503), a NEWLY chosen product must be active (a product kept from the version being revised may have been retired since), no duplicates; zero products stays valid; market scope deferred (no rep market exists, catalogue D6). The phone reads its company's active products, keeps them for offline, and sends only marked ids. Tests `call-report-products.spec.ts`, `src/catalogue/products.test.ts`, `src/routes/report-products.test.tsx` |
| `BE-W176` | backend | the phone could not make an unplanned visit: no screen, the outbox refused to replay a `visit` (`not_convertible`), and a visit the phone made was invisible to its own screens until a pull. Built: Today's "Add an unplanned visit" → doctor, clinic, reason → queued FIRST (`enqueueFirst`) then flushed; the push client sends it as `origin: 'unplanned'` with the reason and no owner fields; the outbox holds every item whose `entityId` is a not-yet-accepted visit (queued, in flight or refused, from the WHOLE queue) so no check-in/report/check-out is sent for a visit the server lacks; the visit screen reads the queued visit back (`visitFor`: server copy first, by id) and shows UNPLANNED · reason. Tests `src/sync/unplanned-visit.test.ts`, `src/routes/unplanned-visit.test.tsx`, `services/api/tests/unplanned-visit-flow.spec.ts` |
| `BE-W177` | backend | there was no production APK build: only the demo script, which builds debug-signed against a laptop. `apps/field/scripts/build-release-apk.ps1` wraps the same prebuild + Gradle `assembleRelease` flow and refuses, before Gradle, anything `scripts/release-build-checks.mjs` refuses: the app configuration not loading as the app loads it, a non-https or local Supabase URL, a secret key in the publishable slot, a missing or malformed `FIELD_ANDROID_VERSION_CODE`, a missing release-signing value or keystore, the public debug keystore/alias/password, and demo/recording/coaching switches. After the build it runs `verify-release-apk.mjs` against `-ExpectSha256`. Signing architecture unchanged (`BE-W169`); no value is printed or written. Tests `src/release-build-checks.test.ts` |
| `BE-W178` | backend | the AI gateway could reach only the stub or Bedrock India, and the operator selected OpenAI for the pilot. Built `services/api/supabase/functions/_shared/openai-provider.ts` behind the existing `LlmProvider` (Chat Completions over `fetch`; refusal from `message.refusal`/`content_filter`, truncation from `length`, HTTP failures as the vendor's code never its message, malformed bodies as `malformed_response`, the abort signal passed to `fetch`), selected by `AI_PROVIDER=openai` with `OPENAI_API_KEY` as an Edge Function secret; tier→model map `OPENAI_MODEL` in core, shared with the console label. Stub and Bedrock kept. Tests `services/api/tests/openai-provider.spec.ts` (mocked network). **IMPLEMENTED, NOT LIVE VERIFIED** |
| `BE-C79` | backend | the PILOT's AI provider is OpenAI (operator decision, 9 October 2026), overriding `BE-C26`'s Bedrock India for the pilot; the India-residency property `BE-C26` asserted does NOT hold for OpenAI's API, and the operator accepted that. The provider abstraction stays, Bedrock's code stays, and every flow rule (approved content, guardrails before the model, four-eyes, audit) is unchanged because it lives in the flows, not the adapter. The key is a server secret only |
| `BE-W179` | backend | Q-7 doctors and clinics had no import path: `seed:reference` took doctors only as hand-written JSON and nothing loaded `clinic_addresses` (coordinates, geofence). Added `docs/operator/doctors-clinics-template.csv` and `services/api/scripts/check-doctor-sheet.mjs`, which checks the sheet against the territory checker's `reference.json` (territory must exist; company derived from the territory; identity conflicts, PIN, coordinates, geofence refused by row) and writes `doctors[]` + `clinicAddresses[]`; `seed-reference-data.mjs` now loads `clinicAddresses` and FAILS a reload whose doctor or clinic differs from the stored row instead of silently skipping it. Tests `services/api/tests/doctor-sheet.spec.ts`. No production data loaded |
| `BE-C80` | backend | production's backup is SUPABASE'S MANAGED (scheduled) BACKUP, on the paid plan (Q-19, answered by the operator 10 October 2026). Deploy step 0.1 checks the plan is active and a completed Supabase backup dated today exists; the GitHub *Database backup* artefact is not required for the pilot deployment. `backup.yml` loses its weekly schedule and its 15 October deferral (no red build about an answered question); its manual, destination-guarded run is kept as the only off-platform copy route (`BE-W143` still applies to it) |
| `BE-W180` | backend | live tracking had a design, a draft notice and a client-side `trackingState`, and no table or RPC. `20261013000100_live_tracking`: `location_pings` (written only by `record_location_ping`, which re-checks the company switch `live_tracking_enabled` (org-scoped, OFF by default), an acceptance of the CURRENT notice, working hours at both the device time and arrival, device-clock bounds (+120 s / -10 min), accuracy and interval, and answers `{stored, reason}` with every refusal counted in `write_rejections`); `live_tracking_acceptances` (append-only, withdraw is a row, a new version needs re-acceptance); notice versions with four-eyes approval by trigger (the engineering draft ships labelled DRAFT and can never be approved); reads through `visible_user_ids()` with a restrictive tenant boundary; `live_tracking_overview`, `live_tracking_trail`, admin `set_live_tracking_enabled` (audited `app_thresholds` row, reason required). Tests `services/api/tests/live-tracking.spec.ts` |
| `BE-W181` | backend | live-tracking positions are deleted 90 days after the server received them: `purge_after` stamped by trigger, deletion allowed only of expired rows (statement-level trigger over the transition table), `purge_expired_location_pings` called by the existing hourly retention worker (`purge-expired-audio.mjs`, `retention.yml`), which now fails the run if that deletion fails |
| `FE-W71` | frontend | the field app's live tracker behind `EXPO_PUBLIC_LIVE_TRACKING` (off): a foreground-only `watchPositionAsync` watcher started and stopped by `trackingState` with the server's inputs (`my_live_tracking`), the notice screen (DRAFT labelled), accept / withdraw / start and stop for today from Me, a status line on Today and Me so tracking is never silent, and the transparency screen following the flag. Positions that fail to send are dropped, not queued (`src/tracking/live.ts`) |
| `FE-W72` | frontend | the console's `/tracking` page for a field manager or admin: each visible rep's latest position, time on the rep's clock, accuracy and age, today's positions as a list, an "Open in Google Maps" link per position (no key, no map rendering), and the admin's company switch with a required reason |
| `BE-W190` | backend | the rep's working day had no server record: "Day End" was a summary screen that wrote nothing, and the tracking shell's `dayOpen` had nothing to read. `20261013000300_work_day_sync_kind` + `20261013000310_work_days`: `work_days` (one per rep per territory-date, zone by `day_zone_unchecked`), opened by the first check-in (BEFORE INSERT trigger on `check_ins`) or `open_work_day`, ended by `close_work_day` (server `closed_at`, phone instant beside it, optional note, server snapshot of visits/mileage/samples; idempotent; refused 45016 while a visit is checked in); an ended day refuses check-ins 45015 on every path; `reopen_work_day` by the rep's field manager or an admin, with a reason, the undone close kept in append-only `work_day_reopenings`; a `work_day` sync kind through `sync_push`, and the row on `sync_pull`. Tests `services/api/tests/work-days.spec.ts` |
| `BE-W191` | backend | managers could not see whether a rep's day had started or ended. `team_work_days(p_on)` (field manager: team; admin: company; every active rep, "not started" included) and the console page `/days` ("The team's day"): each rep's status, server times in the day's own zone, the snapshot, the closing note, and Reopen with a reason. Tests `apps/console/src/lib/team-days-text.test.ts`, `services/api/tests/work-days.spec.ts` |
| `FE-W80` | frontend | Day End's "End my day" is a real act (`BE-W190`): queued BEHIND anything still waiting (`enqueueFirst` + flush) and sent as a `work_day` close; offline the card says it is on the phone and waiting, sent says the server has it, the pull then shows the server's time; shut with its reason while a visit is checked in (as witnessed); a refusal shown with its remedy. `src/today/work-day.ts`: `workDayStatus` and `isDayOpen`, the selector for the live-tracking rule's `dayOpen`. Tests `src/today/work-day.test.ts`, `src/routes/day-end-close.test.tsx`, `packages/ui/src/DayEndScreen.test.tsx` |
| `BE-W200` | backend | live tracking (`BE-W180`) and the working day (`BE-W190`) were built side by side with two meanings of "the day is open"; ending the day did not end the sharing. `20261013000500_live_tracking_follows_work_day`: `record_location_ping` refuses `day_ended` (`45015`) once the rep's working day for their territory date is closed, and `my_live_tracking` reports `withinWorkingHours = false` for it, so a phone pauses on its next ask. A manager's reopen undoes it |
| `FE-W90` | frontend | "End my day" (`FE-W80`) stops the live tracker on the phone at once (`closeDay`), before the close is even sent; `day_ended` is a refusal the tracker treats as a stale picture (`BE-W200`) |
| `BE-W185` | backend | users and roles administered from the console instead of by hand (`DEPLOY-RUNBOOK.md` step 4). `20261013000200_console_user_admin`: `user_provisioning` (RLS forced, no policy, audited) records each account creation as started/completed/cancelled, scoped to the admin's company, so an auth account without a profile is listed and finishable, never silent; `admin_list_users` (audited read with reason), `admin_begin_user_creation` / `admin_finish_user_creation` / `admin_cancel_user_creation`, `admin_update_user` (role, territory and manager checked as one combination; reason; audited), `admin_set_user_active` (deactivate/reactivate, never delete), `admin_authorize_password_reset`. The runbook's five silent mistakes are named refusals: `admin_confirmation_mismatch`, `territory_level_for_rep`, `territory_not_in_organisation`, `rep_needs_manager` (with `manager_does_not_cover_territory`), `account_unconfirmed`. The admin's direct table write (`user_profiles_admin_all`) is NOT withdrawn yet. Tests `services/api/tests/console-admin.spec.ts` |
| `BE-W186` | backend | the `admin-accounts` Edge Function: creates a CONFIRMED sign-in account (temporary password shown once) between `admin_begin_user_creation` and `admin_finish_user_creation`, both called as the signed-in admin, and resets a password after `admin_authorize_password_reset`; an account made whose profile is refused answers `incomplete` and stays listed. The secret key is still READ once, in `_shared/practice-writer.ts`, which gains a second narrow export `accountAdminFromEnv` (GoTrue `createUser` and `updateUserById` only; key `account_admin`, else `default`); `check-service-role-reads.mjs` now pins both exports and those two operations. Tests `admin-accounts-handler.spec.ts`, `service-role-reads.spec.ts` |
| `BE-W187` | backend | territories and working hours administered from the console. `20261013000210_console_territory_admin`: `territory_tree` (admin: the company; field manager: own subtree, read-only), `admin_create_territory` (National -> Region -> Area/Territory by depth, `territory_too_deep`; codes upper-cased and unique across every company case-insensitively; no `EXAMPLE-`; nothing beneath a territory a rep sits on), `admin_rename_territory`, `admin_set_territory_hours` / `admin_clear_territory_hours`. No delete: deleting even an empty territory is refused by the append-only `app_thresholds` cascade (measured, 23001). Tests `console-admin.spec.ts` |
| `BE-W188` | backend | `search_audit_log` (`20261013000220`): the audit log filtered by actor, table, action and date range, keyset-paged, with actor names; admin-only by `effective_role()`, refused through `refuse_read`, reason required and the read audited, company-scoped through the actor's profile; `list_audit_log` unchanged. Tests `console-admin.spec.ts` |
| `BE-W189` | backend | `retention_overview` (`20261013000230`): the retention period, the worker's thresholds, its last runs (outcome, and per run only THIS company's destroyed objects, never the whole-system counts MR-46 B3 withdrew), the company's live/overdue/destroyed recordings and voice notes, and the append-only tables read from the `reject_mutation` triggers. Admin-only, reason required, audited, read-only; no manual purge. Tests `console-admin.spec.ts` |
| `FE-W75` | frontend | console `/users` (Users & roles): the company's people with email, role, territory, manager, active and confirmed, warnings for an unconfirmed account and a rep with no manager; create a user through `admin-accounts` (territory and manager PICKED, a rep offered only bottom-of-branch territories, the admin role only with the email typed again, temporary password shown once); "started, not finished" creations with Finish and Cancel; change role/territory/manager/name and deactivate/reactivate with a reason; reset a password (suggested after deactivation); a prompt for a second admin. Tests `apps/console/src/lib/admin-screens.test.tsx`, `admin-text.test.ts`, `e2e/admin.spec.ts` |
| `FE-W76` | frontend | console `/territories`: the tree in reading order with level, code, users, reps, doctors and the hours that apply and where they come from; an admin adds a National, or a Region/Area beneath its parent, renames, sets or clears a territory's own hours; a field manager sees their subtree read-only. Tests `admin-screens.test.tsx`, `admin-text.test.ts`, `e2e/admin.spec.ts` |
| `FE-W77` | frontend | console `/audit`: the audit log, server-rendered from URL filters (who, table, action, India-time date range, refused reads), paged by the server's cursor, a refusal shown as a refusal. Filter parsing in `src/lib/audit-filters.ts`. Tests `admin-text.test.ts`, `e2e/admin.spec.ts` |
| `FE-W78` | frontend | console `/retention`: read-only retention and purge status from `retention_overview` — what is kept and how long, the company's audio figures, the worker's runs and thresholds, alerts for a stall, overdue audio, a failed or never-run worker; no purge button. Tests `admin-text.test.ts`, `e2e/admin.spec.ts` |
| `FE-W79` | frontend | the console sidebar's "Coming later" section removed: Users & roles, Territories, Audit log and Retention & purge are links under "Administration". Test `e2e/admin.spec.ts` |
| `BE-W202` | backend | admins no longer write `user_profiles`, `territories` or `territory_shift_windows` directly through PostgREST: `20261013000700_close_admin_direct_writes` turns each `*_admin_all` (FOR ALL) into `*_admin_select` with the same expression and revokes INSERT/UPDATE/DELETE from `authenticated`, so every change goes through the audited console RPCs (`BE-W185`, `BE-W187`). Owner/service-role paths (migrations, loaders, the runbook SQL editor) are unaffected. Tests in `console-admin.spec.ts` |
| `BE-W201` | backend | an admin screen could not show the company's live-tracking notice versions: `propose_live_tracking_notice` / `approve_live_tracking_notice` existed (`BE-W180`) but no read said which version is in force, which wait for a second admin, or who wrote each. `20261013000600_live_tracking_notice_list`: `live_tracking_notices()` (admin only, refused `42501`; SECURITY DEFINER, company-scoped through `lms_caller`) answers the notice in force by `current_live_tracking_notice` (the engineering draft, `isDraft`, when none is approved) and every company version newest first with author, `authoredByYou`, approver, attestation and `waiting` / `in_force` / `superseded`. Core `LIVE_TRACKING_RPC.notices`, `LiveTrackingNoticesSchema`. Tests `services/api/tests/live-tracking-notice-list.spec.ts`, `packages/core/src/field/live-tracking.test.ts` |
| `FE-W91` | frontend | console `/tracking/notice` (Live location notice, under Governance; linked from `/tracking` for an admin): the notice in force (the engineering draft labelled as such, or the company's approved version), the company's versions newest first with status, author and approver, a form to load a new version (label + full text, empty, with a link to `docs/operator/live-tracking-notice-DRAFT.md`, a warning for a leftover `[[ BLANK ]]`), and Approve with what was checked for a DIFFERENT admin — the author is told it waits for a second admin and has no button; the page says approving makes every rep accept again; refusals in plain words with their remedy (`BE-W201`). Tests `apps/console/src/lib/tracking-notice-text.test.ts`, `tracking-notice.test.tsx`, `e2e/tracking-notice.spec.ts` |
| `BE-W195` | backend | push notifications, database half. `20261013000400_push_notifications`: `device_push_tokens` (a phone's FCM token owned by the signed-in person; RLS forced, own rows only, tenant boundary; never deleted, retired with a reason; audited), `register_push_token` / `unregister_push_token` (a token live for someone else is retired `replaced`; at most five live per person), `notification_outbox` (append-only apart from delivery columns; no client insert), `enqueue_notification` (no client may call it), `push_claim_batch` / `push_record_results` (service_role only; 24 h expiry, `no_device`, invalid tokens retired), `push_sender_authorise` (admin, audited). `20261013000410_push_notification_events`: triggers on a manager's plan version (deferred to commit, coalesced per day), `work_day_reopenings`, `course_assignments`, `analysis_overrides`; fixed text, counts and dates only. Tests `services/api/tests/push-notifications.spec.ts` |
| `BE-W196` | backend | the `push-sender` Edge Function: drains `notification_outbox` through FCM HTTP v1 with an OAuth token minted from the `FCM_SERVICE_ACCOUNT` secret (chosen over Expo's push service so the key stays in one place); "not configured" claims nothing; invalid tokens retired; run by the schedule secret `PUSH_SENDER_CRON_SECRET` (`.github/workflows/push-sender.yml`, gated by the `PUSH_ENABLED` variable) or by an admin. The secret key is still READ once: `_shared/practice-writer.ts` gains a third narrow export `pushOutboxFromEnv` (the two outbox RPCs only), pinned by `check-service-role-reads.mjs`. Tests `push-sender-handler.spec.ts`, `service-role-reads.spec.ts` |
| `BE-W197` | backend | the build refuses a key-gated integration switched on without its input: `EXPO_PUBLIC_MAPS=true` needs `GOOGLE_MAPS_ANDROID_API_KEY`, `EXPO_PUBLIC_PUSH=true` needs `GOOGLE_SERVICES_JSON` naming a file -- in `release-build-checks.mjs` (production, and `--integrations-only` for `build-demo-apk.ps1`) and in `plugins/maps-push.cjs` at config time. Tests `apps/field/src/release-build-checks.test.ts`, `src/maps-push.test.ts` |
| `FE-W85` | frontend | field app maps behind `EXPO_PUBLIC_MAPS` (with `react-native-maps`): `/map` shows the rep's doctors' clinics, `/map?show=today` today's stops, each with its geofence; a pin opens the visit or the doctor; a clinic with no coordinates is listed under "No location on file", never placed. Reached from the doctors list and the beat plan; off, no map path renders and `/map` goes to Today. The key reaches the manifest only through `plugins/maps-push.cjs`. Tests `src/maps/places.test.ts`, `src/maps-push.test.ts` |
| `FE-W86` | frontend | field app push behind `EXPO_PUBLIC_PUSH` (with `expo-notifications`): after sign-in the FCM token is registered (`register_push_token`) if the rep allowed notifications at first run -- nothing new is asked; re-tried when the app returns to screen; retired before sign-out (bounded, never blocks sign-out); a tap opens only the four kinds' screens, else Today. `RECEIVE_BOOT_COMPLETED` blocked. Tests `src/push/registration.test.ts` |
| `FE-W87` | frontend | console `/tracking`: the chosen rep's newest position in a Google Maps Embed frame when `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY` is set (no new dependency); unset, unchanged, and the "Open in Google Maps" links stay. Tests `apps/console/src/lib/tracking-text.test.ts` |
| `BE-W203` | backend | `pnpm ai:live` follows `AI_PROVIDER` like the gateway: `tests/live-credential.ts` `liveProviderGate` — `openai` probes OpenAI (a free GET of each `OPENAI_MODEL` id, then one 20-token completion through the gateway's own adapter, so 401 bad key / 429 no quota / 404 model are each NAMED), `bedrock` keeps W1-V's gate; a key OpenAI refuses is REFUSED (a red first test), never a skip; no reason ever carries a value from the `.env`. `ai-live.spec.ts` asserts `model_provider` = the configured vendor and `model_name` = `OPENAI_MODEL[GATEWAY_MODEL[feature]]` (or its dated snapshot), and proves `ai-gateway` is served by its own `28000`; `bedrock-live.spec.ts` skips under `openai`, saying why. Tests `services/api/tests/live-gate.spec.ts` |
| `BE-W204` | backend | `services/api/supabase/functions/.env.example`: `AI_PROVIDER=openai`, an `OPENAI_API_KEY` placeholder, the Bedrock alternative commented, the "editor, never `echo >>`" warning; the real `.env` stays ignored (`.gitignore` `.env`, re-included `!.env.example`). The placeholder is recognised by the live gate and by `pnpm key-day` |
| `BE-W205` | backend | `pnpm key-day` (`services/api/scripts/key-day.mjs`): one local command that refuses any non-local target (`target-guard.mjs`, remote opt-in ignored), checks the stack is up and every migration on disk is applied, reports the functions `.env` without a value, makes (or re-uses, `--fresh` for new) a `TEST Key-day` company — two admins, a manager, two reps, doctors, working hours, today's plan — approves the five draft instruction sets and personas/scenarios S1–S5 by four eyes (S6 held, `D-15`), loads/approves/publishes/assigns TEST content (`key-day-content/`) through the real loaders, turns the AI features and live tracking on and approves a TEST notice, and prints accounts and next commands. State in git-ignored `services/api/.key-day/`. Tests `services/api/tests/key-day.spec.ts` |
| `BE-W206` | backend | `docs/KEY-DAY.md`, the one page for key day (local, then production later); linked from `docs/START-HERE.md` §5, an "OpenAI" subsection in `docs/HANDOVER.md`'s model access, and a pointer at the top of `docs/ai-platform/DAY-ONE.md` |
| `BE-W207` | backend | OPEN — OpenAI's deprecations page (entry dated 2026-10-14) shuts down `gpt-4.1` and `gpt-4.1-mini` — both `OPENAI_MODEL` ids — on 14 January 2027. Before then the operator picks their successor and engineering changes `OPENAI_MODEL` (`packages/core/src/field/gateway/prompt-contract.ts`) after checking it accepts what the adapter sends (`temperature`, `max_completion_tokens`, `response_format: json_object`), then reruns `pnpm ai:live` |
| `FE-W92` | frontend | `build-demo-apk.ps1 -AllFeatures`: for that build only, `EXPO_PUBLIC_LEARNING`, `_LESSON_TUTOR`, `_ASSISTANT`, `_PRODUCT_QA`, `_PRACTICE`, `_LIVE_TRACKING` = `true`; `_MAPS` / `_PUSH` only when their inputs are present (`BE-W197`); the four `EXPO_PUBLIC_APP_*` local defaults when unset; recording and coaching stay refused (`D-15`); not combinable with `-CoachingCheck`; the APK is named `-all-features` |
| `FE-W100` | frontend | depth and motion tokens: `palette.shadow` (the design's `rgba(20,21,15,…)` ink), `tokens.elevation` (flat · hairline · card · raised · floating · sheet · dock · accent — the design files' own layered `box-shadow`s, each colour a palette colour plus alpha via `withAlpha`, with an Android `elevation` fallback for API < 28), `tokens.motion` (every duration under 400ms), `tokens.overlay.scrim`, `target.tabBar`. Tests `packages/ui-tokens/src/tokens.test.ts` |
| `FE-W101` | frontend | premium pass, shared components: depth through `elevationStyle` only (cards, hero, rows, toast, sheet, pinned footer, the primary's accent glow; no shadow literal left in `packages/ui`), arrival motion on the native driver (`FadeIn`, toast entrance, sheet rise over a fading scrim) obeying "Remove animations" through `ReduceMotionContext` (the hook moved from `apps/field/src/reduce-motion.ts`), skeleton placeholders beside — never instead of — the loading line, `EmptyState`, `TabBarIcon` (B1's active pill), `ProgressSegments`, paper behind every stack transition. §05 kept: a press darkens the fill and never scales. Tests `packages/ui/src/depth-and-motion.test.tsx` |
| `FE-W102` | frontend | premium pass, screens: Today (B1 hero at display size, progress strip `ProgressSegments`, placeholders while the first plan loads, staggered arrival, "Nothing planned" / "That's everyone" as `EmptyState`s), Day End (summary settles in, confirmation first), sign-in (brand line given a splash's room and an accent rule; the one primary pinned in the footer), beat plan and doctors (placeholders and `EmptyState`), tab bar (B1's active pill, room for the label, upward shadow). No copy changed |
| `FE-W120` | frontend | console design system: `apps/console/src/lib/theme-css.ts` is the one stylesheet, generated from `@fieldforce/ui-tokens` (every colour a `--ff-*` custom property built from `tokens.color`; derived values are only translucent tokens for shadows and rings, never text) — cards, notes with a glyph per tone, pills, buttons (primary/secondary/danger/quiet, disabled on the wash), fields with an accent focus ring, tables (sticky header, hover rows, right-aligned tabular numbers), reduced motion. `ui.tsx` primitives now render by class (`Page`, `PageHeader`, `Columns`, `Stat`/`Stats` added); element types unchanged (`Card` is still a `<section>`) |
| `FE-W121` | frontend | console shell: sticky sidebar with a glyph mark (no wordmark — `docs/brand-identifier-decision.md`), a glyph per entry (`lib/icons.tsx`, inline SVG, `aria-hidden`), the current page lifted onto a card, the signed-in address with Sign out at the foot; a sticky top bar with the breadcrumb from the sidebar's own labels (`lib/top-bar.tsx`); under 1100px the sidebar folds to a rail with the words kept in the markup |
| `FE-W122` | frontend | console type and sign-in: DM Sans through `next/font/google` in the root layout (`--ff-font-sans`); Cormorant Garamond loaded only by `app/sign-in/layout.tsx`, for the brand line "Relief at the root." (the field app's), on a two-panel sign-in that stacks on a tablet |
| `FE-W123` | frontend | console page pass: every page and client panel drops its own inline field, table and header styles for the shared classes — page frame and header, filters, field groups, numbered route stops on `/planning`, stat tiles on `/retention` and `/admin`, every table on a card with numeric columns right-aligned. Copy, routes, reads and writes unchanged |
| `FE-W124` | frontend | console loading states: `lib/page-skeleton.tsx` (shapes only — no figure, no row, one `role="status"`), as `loading.tsx` for each server-rendered route segment |
| `FE-W125` | frontend | console day pickers (`/days`, `/planning`, `/planning/access`) defaulted to the UTC date, so from midnight to 05:30 IST a manager was shown yesterday; `lib/india-date.ts` `indiaToday()` gives India's date (an explicit `?date=` still wins). Found on the 14 October screenshot pass. Test `lib/india-date.test.ts` |
| `FE-W126` | frontend | the Me tab opened on the live-location status above its "Settings" title; `SettingsScreen` gains a `lead` slot under the title, still before every group, and Me passes the status there (`FE-W71`'s "never silent" kept). Found on the 14 October screenshot pass |
