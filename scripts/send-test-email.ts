/**
 * Send one plain test email to check the SendGrid setup.
 *
 *   railway run --service ai-topic-explorer npm run email:test
 *
 * Optional: TEST_EMAIL_TO overrides the recipient.
 */
import { flush, initErrorReporter } from "@above-public-affairs/error-reporter";
import { sendEmail } from "../lib/email/send.ts";

const to = process.env.TEST_EMAIL_TO?.trim() || "joshua@abovepublicaffairs.com";
const stamp = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
const subject = `AI Topic Explorer: test email (${stamp})`;

await initErrorReporter({ project: "ai-topic-explorer", service: "send-test-email" });

try {
  const result = await sendEmail(
    {
      to,
      subject,
      text: [
        "This is a test email from AI Topic Explorer.",
        "",
        "If it arrived, the tool can send alerts and the monthly report. No action needed.",
      ].join("\n"),
    },
    { kind: "test" },
  );
  console.log(`Sent "${subject}"`);
  console.log(`  from: ${process.env.SENDGRID_FROM}`);
  console.log(`  at:   ${result.sentAt.toISOString()}`);
  console.log(`  SendGrid message id: ${result.messageId ?? "(none returned)"}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await flush(5_000);
}
