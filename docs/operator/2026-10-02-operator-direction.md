# Operator direction, 2 October 2026 — verbatim

**Recorded W1-U3 from the text reproduced under "OPERATOR MESSAGE — VERBATIM" in the W1-U2 brief.**
This file is the source; every decision that cites items 1–17 cites THIS text, not a summary of it.
Where a summary and this text differ, this text wins.

---

Dev + Maanav,

Please proceed with the below final direction.

1. DEMO / BUILD MACHINE
Dev's laptop is currently not available.

Dev should remotely access and use my PC for:
- Building the Android app
- Running the emulator
- Generating the latest demo build/APK
- Final screen testing

My PC will therefore be treated as the temporary build/demo machine.

Please make sure no personal credentials or unnecessary development secrets remain stored locally after the work is completed.

2. DEMO DEVICE
For tomorrow's demo, use the Android emulator on my PC as the primary demonstration environment.

This avoids:
- Real GPS/off-site check-in confusion
- Device-specific battery/background restrictions
- Last-minute physical-device issues

A physical phone can be tested separately after the demo build is stable.

3. AWS / AI KEY
I am providing the required AWS / Bedrock credentials privately.

Maanav, once received:
- Configure them only as Supabase Edge Function secrets
- Do not commit any credentials to GitHub
- Do not put them in source code
- Do not send them in the group

Immediately replace the placeholder AI provider with the real Bedrock provider.

4. AI FEATURES TO ACTIVATE AND TEST
Once AWS is connected, test these end-to-end:

- Product Q&A
- Chatbot
- LMS Tutor
- AI Doctor simulation
- AI Analysis / Coaching

For every test confirm:
- Correct model used
- Response received successfully
- Response quality
- Response latency
- Token usage
- Audit record created
- No patient-identifiable data sent unnecessarily

5. WHETHER TO SHOW AI IN THE DEMO
Earlier the recommendation was not to show AI because only placeholder responses existed.

That decision now changes conditionally.

IF the AWS integration is completed AND fully tested before the demo:
-> Show AI Doctor, Product Q&A and AI Analysis.

IF there is any instability:
-> Keep AI hidden and show only the tested core MR workflow.

Do not show partially working AI.

6. DEMO BUILD CHECK
Before the demo, install/run the exact final build and verify:

- Login
- Dashboard
- Day plan
- Doctor visit
- Check-in
- Consent
- Sample entry
- Call report
- Day End
- Mileage
- Chatbot
- LMS
- AI Doctor
- AI Analysis

Also verify that no old/sample/vendor-specific Coaching content is visible.

7. FRONTEND / BACKEND MERGES
Maanav:
Please merge the backend work once all checks pass.

Dev:
Please merge the completed app work once Day End, Mileage and current integrations pass testing.

Do not leave finished work sitting only in open PRs before the demo.

8. PRODUCTION
I approve proceeding with the paid hosting plan and the production deployment once Maanav confirms the pre-flight is clean.

Use the fixed deployment sequence:
1. Pre-flight
2. Working hours
3. Database migrations
4. Reference data
5. Smoke test

Do not change the order.

9. TEMPORARY WORKING HOURS
For UAT/demo use:

Monday-Saturday
09:00-18:00
Local territory time

This remains a temporary configurable value and is not the final business policy.

10. WHO PLANS THE MR'S DAY
Final decision:

THE MANAGER WILL PLAN THE MR'S DAY.

The manager should be able to:
- Select an MR
- Select doctors/clinics
- Create weekly/daily visit plans
- Assign visits
- Modify/reschedule visits
- Review completion

The MR should execute the assigned plan.

The MR may request/add an unplanned visit where allowed, but the normal planned workflow should originate from the manager.

Please design the permissions and screens accordingly.

11. ADMIN ROLE
Admin should manage:
- Masters
- Users
- Territories
- Products/content
- System configuration

Admin should not be responsible for manually planning every MR's day.

12. SECOND ADMIN
I will provide the second admin name/email.

Please create it immediately once received and test:
- Admin A drafts
- Admin B approves
- Self-approval fails

13. REGISTERED LEGAL NAME
I will provide this separately.

Do not invent it.

14. SAMPLE CAP
Keep it configurable.
Do not invent the UCPMP value.

I will provide:
- Number
- Counting basis
- Whether promotional inputs are included

15. SETTINGS PER COMPANY
This has already been decided:
Settings belong to EACH COMPANY.

Do not keep this as an open question.

16. 4 OCT TARGET
The priority remains a demonstrable MR Field App containing:

- Core MR workflow
- Day planning/execution
- Real backend
- Day End
- Mileage
- LMS
- Product Q&A
- Chatbot
- AI Doctor
- AI Analysis / Coaching

Maps / notifications / voice / live tracking should not destabilise the core demo if they are not ready.

17. STATUS UPDATE
After AWS integration and today's build, please send only:

MODULE | STATUS | OWNER | BLOCKER | ETA

Use:
DONE
IN PROGRESS
BLOCKED
POST-4-OCT
