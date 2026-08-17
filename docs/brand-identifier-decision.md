# Decision brief — the project name in permanent identifiers

**Written 17 August 2026. Open item O2.** For whoever owns the trademark and brand
question. Not an engineering decision.

**The ask:** a ruling on whether the name "Elmiron" may appear in the Android package
ID and the workspace namespace, before the first Play Store upload. Everything else
in this brief exists to put a cost on that ruling.

---

## 1. Why this is not a naming preference

**ELMIRON® is a third party's registered trademark.** The FDA prescribing
information for the product carries the notice that ELMIRON® is a registered
trademark of **IVAX Research, LLC**, and the product is associated with Janssen
Pharmaceuticals. It is pentosan polysulfate sodium, prescribed for interstitial
cystitis.

That makes the question different from an internal codename. `com.praversetech.elmironmr`
on the Play Store is a **permanent, public identifier, published under Praverse's
developer account, containing another company's pharmaceutical trademark.** Whether
that is a problem is a legal question, not an engineering one — but it is a question
somebody has to answer before publication rather than after.

**On "Elmiron does not exist in India under that name" — partly contradicted, worth
checking.** Public sources indicate pentosan polysulfate is sold in India under
*other* brand names — Comfora, Pentossan-100, Cystopen, For-IC — which supports the
premise. But at least one Indian trade listing advertises an "Elmiron" branded
tablet. The sources disagree and none of them is authoritative for trademark status
in India.

*Confidence: high that ELMIRON® is a registered mark held by a third party; low on
its Indian registration and marketing status. **Neither this document nor engineering
can settle the second — it needs a trademark search or counsel.***

Sources: [FDA prescribing information](https://www.accessdata.fda.gov/drugsatfda_docs/label/2008/020193s009lbl.pdf) ·
[Pentosan polysulfate — Wikipedia](https://en.wikipedia.org/wiki/Pentosan_polysulfate) ·
[Medindia drug information](https://www.medindia.net/doctors/drug_information/pentosan_polysulfate_sodium.htm)

### The three questions underneath, restated

1. **Which brand** is this app for — and is that brand ours to use?
2. **Which molecule** does it actually promote? The app is a field-force tool; the
   brand list drives the hotword list for transcription and the sample catalogue.
3. **Which legal entity** is the data controller and the Play Console publisher? This
   overlaps open item O1 and blocked-list items 2.1–2.3.

Only the first is answered by this brief. It is the one with a deadline attached.

---

## 2. Where the name is embedded, by reversibility

189 occurrences across 70 tracked files. **The count is misleading — almost all of it
is free to change.** What matters is the short list that is not.

| Identifier | Where | Cost to change |
| --- | --- | --- |
| `com.praversetech.elmironmr` | `apps/field/app.json` → `android.package` | **Permanent after first Play upload.** A different ID is a different app: new listing, zero installs, zero reviews, no upgrade path for anyone who installed the first one. Google does not rename a package. |
| `elmironmr` URL scheme | `app.json` → `scheme`, and `APP_DEEP_LINK_SCHEME` in `.env` / `.env.example` | Permanent once any auth callback, invite link or QR code is in the wild. Free today — nothing has shipped. |
| `@elmiron/*` — six packages | `packages/{core,ui,ui-tokens}`, `apps/{field,console}`, `services/{api,mock}` | Free today: a rename touches every import in the monorepo but is mechanical and CI-verifiable. Gets worse when the patient app inherits the namespace, and worse again once `packages/core` has an external consumer. |
| Repository name, remote URLs, three CI workflows | `.github/workflows/*`, git remote | Cheap now. GitHub redirects renamed repos, so this is the least of it. |
| ~180 mentions in docs, comments, test fixtures | Everywhere else | Free. Mechanical. Ignore it in the decision. |

**The whole decision is really about row 1 and row 2.** Rows 3–5 are cleanup that
follows whatever is decided.

---

## 3. The cost curve

| Decide by | Cost of choosing a different name |
| --- | --- |
| **Now**, before FE-W8 | A search-and-replace, one CI run, and an afternoon. No user impact — nothing is published, no deep link exists, no install base. |
| After the first **internal TestFlight-equivalent / closed test** upload | Package ID is now claimed on Play. Changing it means a second listing and re-inviting testers. Recoverable, irritating. |
| After **pilot** with 100 MRs | Every pilot device must uninstall and reinstall. Their queued offline work does not survive an uninstall unless it has already synced. **This is the point where the decision starts costing an MR their day's work.** |
| After **public release** | Not recoverable. Two listings forever, or abandon the install base. |

The pilot row is the one to notice. It converts a branding question into a
data-loss question, because the offline queue lives in app-private storage.

---

## 4. Options

### A. Keep `elmironmr` — requires a written clearance

Viable **only** if counsel confirms the mark is either ours, licensed to us, or
unregistered in India for this class of goods. Software is Nice class 9/42, not
class 5 (pharmaceuticals), which is a real distinction and may well come back clean
— but "may well" is not a clearance.

*Cost if wrong:* a takedown of a published app, and renaming under exactly the
conditions in the last row of §3.

### B. Neutral identifier, keep the display name flexible — **recommended**

```
android.package   com.praversetech.fieldforce
scheme            praversefieldforce
workspace scope   @fieldforce/*
```

The **display name** in `app.json` stays a separate, freely-changeable string, so
whatever the client wants on the phone's home screen can change without touching the
permanent identifier. That separation is the actual win: it decouples the branding
decision from the irreversible one, and means O2 no longer blocks FE-W8.

*Cost:* one afternoon now, entirely mechanical, fully covered by CI.

### C. Client's identity throughout

If the client is publishing under their own Play Console account, the package ID
should be theirs from the start — `com.<client>.<something>` — and this decision
belongs to them, not us. **This cannot be settled without answering 2.1 first**
(whose Play Console account ships the app), which is why the two are one
conversation.

---

## 5. What is needed, from whom

| # | Needed | From | By |
| --- | --- | --- | --- |
| 1 | Trademark position on "Elmiron" for software in India — cleared, or not | Counsel / client legal | **Before FE-W8** |
| 2 | Whose Play Console account publishes | Client sponsor | Before FE-W8 |
| 3 | If option B: sign-off to rename | Reviewer | Any time before the first upload |

**Until all three land, `com.praversetech.elmironmr` remains a placeholder that
nobody has approved**, and it is recorded as FE-W8-blocking in
`.ai-collab/decisions.md`.

---

## 6. What engineering has already done about it

- The placeholder is flagged in `PROJECT-OVERVIEW.md` under FE-W1 as a value I chose
  from the GitHub organisation name without being told, and as permanent after
  publication.
- It is listed as FE-W8-blocking in `.ai-collab/decisions.md`, paired with the Play
  Console account question and the keystore custody question, because all three are
  the same conversation.
- Nothing has been published. No deep link exists in the wild. **Every option in §4
  is still open at its cheapest price.**

That is the entire reason this brief is worth reading now rather than in FE-W8.
