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
| `BE-C71` | backend | `BE-W146` deferred with a trigger: fixed before production AI traffic or before anything reads `ai_requests` model, token or status fields — written into the key-day checklist (W2-A B) |
| `BE-C72` | backend | `BE-C70`'s check reduces ACCIDENTAL use and changes nothing about capability; rule 6 added (function code may not name `SUPABASE_SECRET_KEYS`, `SUPABASE_SECRET_KEY` or `SUPABASE_DB_URL`); no narrower key exists on the hosted platform as documented; move the writer off the legacy key before end of 2026 (W2-B E) |
