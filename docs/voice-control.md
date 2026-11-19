# Voice control

Status: built on the `growth-b1` hold branch, **not live**. It is off until
`NEXT_PUBLIC_VOICE_CONTROL_ENABLED=true` at build time.

## What it does

A blue mic button sits in the bottom-right corner of the signed-in web app.
Tap it and speak, or type in the panel:

| Say                                               | Result                                 |
| ------------------------------------------------- | -------------------------------------- |
| "Open jobs", "Go to dispatch", "Show my invoices" | Opens that page                        |
| "Create a new job", "Add a new customer"          | Opens the New job or New customer form |
| "Show scheduled jobs", "Show completed jobs"      | Jobs list filtered by status           |
| "Find job AC repair"                              | Jobs list search                       |
| "Find customer John Smith"                        | Customers list search                  |
| "Go back"                                         | Previous page                          |
| "Help", "What can I say?"                         | Spoken help                            |

The app answers in text and with a spoken reply.

## How it works

- Speech to text: the browser's built-in Web Speech API (Chrome, Edge,
  Safari). Firefox has no voice input, so the panel offers a text box instead.
- Understanding: `apps/web/lib/voice/voice-parser.ts`, simple rules that run
  in the browser. There is no AI call and no cost.
- Safety: `apps/web/lib/voice/voice-commands.ts` builds every URL and checks
  the signed-in role. A technician cannot open office pages by voice.
- Privacy: Chrome and Edge send the audio to their own speech service
  (Google or Microsoft) to turn it into text. Safari may process it on the
  device. CrewFlow360 sends nothing extra. Tell clients this.

## Turning it on

- Local: `NEXT_PUBLIC_VOICE_CONTROL_ENABLED=true` in `apps/web/.env.local`.
- Production (only when the owner says go live): set the GitHub Actions
  variable `CREWFLOW_PRODUCTION_VOICE_CONTROL_ENABLED` to `true` and deploy
  `main`. Set it to `false` and deploy again to turn it off.

## Next steps (not built yet)

- More phrases, and Spanish voice commands.
- Voice actions that change data (for example "create a job for John Smith
  tomorrow at 3 PM"). These would use the existing AI with the approval
  queue and the monthly AI budget.
