import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/landing/legal-page";
import { GITHUB_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What a8 stores, which Google data it reads and why, who it shares data with, and how to delete it.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="October 26, 2026">
      <p>
        This policy covers the hosted a8 service. If you run a8 on your own
        server, your data stays with you and the services you set up, and this
        policy doesn&apos;t apply.
      </p>

      <h2>What a8 stores</h2>
      <ul>
        <li>
          <strong>Your account.</strong> Your name and email. If you sign up
          with a password, a8 stores a hash of it, never the password itself.
          If you sign in with Google, a8 gets your name, email and profile
          picture from Google.
        </li>
        <li>
          <strong>Your chats.</strong> Your messages, the replies, files you
          attach, thread titles, scheduled prompts and links you share.
        </li>
        <li>
          <strong>Your connections.</strong> The sign-in tokens for each app you
          connect, encrypted. a8 never sends them to your browser or to an AI
          model.
        </li>
        <li>
          <strong>Billing and usage.</strong> Your plan, your credit balance and
          how many credits each reply used. Polar handles payment, so a8 never
          sees your card.
        </li>
      </ul>

      <h2>Google data</h2>
      <p>
        a8 reads your Google data only after you connect an app on the
        Connectors page, and only to do what you ask in a chat:
      </p>
      <ul>
        <li>
          <strong>Gmail.</strong> a8 reads and searches your email to answer
          questions about it, and writes drafts. It can&apos;t send email.
        </li>
        <li>
          <strong>Google Calendar.</strong> a8 reads your calendars and events,
          and creates or changes events.
        </li>
        <li>
          <strong>Google Drive, Docs, Sheets and Slides.</strong> a8 reads your
          files, and creates or edits documents, spreadsheets and
          presentations.
        </li>
      </ul>
      <p>
        a8 doesn&apos;t create, change or delete anything in your apps until you
        tap Approve. What a8 reads goes to the AI model you picked so it can
        write the reply, and is saved in that chat so you can see it later.
      </p>
      <p>
        a8 doesn&apos;t sell Google data, use it for ads, or use it to train or
        improve AI models. People at a8 don&apos;t read it unless you ask them
        to, a security issue requires it, or the law does.
      </p>
      <p>
        a8&apos;s use and transfer of information received from Google APIs
        adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2>Who a8 shares data with</h2>
      <p>
        a8 sends data to the services below, only to run a8. None of them may
        use it for anything else.
      </p>
      <ul>
        <li>
          <strong>Convex</strong> stores the database and your files.
        </li>
        <li>
          <strong>Vercel AI Gateway</strong> passes your messages, and what a8
          read from your apps, to the provider of the model you picked, like
          Anthropic, OpenAI or Google.
        </li>
        <li>
          <strong>Tavily</strong> gets the query when a reply searches the web.
        </li>
        <li>
          <strong>Deepgram</strong> gets your voice while you dictate. a8 asks
          Deepgram not to train on it, and a8 doesn&apos;t store the audio.
        </li>
        <li>
          <strong>Resend</strong> sends account emails, like verification and
          password reset links. If you turn on email for a scheduled prompt,
          Resend also sends you its replies, which can include what a8 read from
          your apps.
        </li>
        <li>
          <strong>Polar</strong> takes payments and manages subscriptions.
        </li>
      </ul>

      <h2>How long a8 keeps data</h2>
      <p>
        a8 keeps your chats and files until you delete them or your account. A
        temporary chat is deleted about a day after its last message. A file you
        upload but never send is deleted within a day. a8 keeps a copy of each
        email it sends you for about a day, then deletes it. Disconnecting an
        app deletes its tokens from a8. You can also remove a8&apos;s access in
        your{" "}
        <a href="https://myaccount.google.com/permissions">Google Account</a>.
      </p>

      <h2>Deleting your data</h2>
      <p>
        Delete a chat from the sidebar to delete its messages. Its files are
        deleted within a day. To delete everything, go to{" "}
        <Link href="/settings/account">Settings, then Account</Link> and delete
        your account. That removes your account, chats, scheduled prompts,
        files, connections and tokens, and cancels your subscription. a8
        can&apos;t undo it. a8 deletes its copies of emails it sent you about a
        day after sending them. If you ever started a checkout, a8 also asks
        Polar to delete your customer profile and anonymize your name and
        email. Polar keeps its records of past payments.
      </p>

      <h2>Changes</h2>
      <p>
        If this policy changes, a8 updates the date at the top. For a change
        that affects how a8 uses your data, a8 emails you first.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy? Open an issue on{" "}
        <a href={GITHUB_URL}>GitHub</a>.
      </p>
    </LegalPage>
  );
}
