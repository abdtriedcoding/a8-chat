import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/landing/legal-page";
import { GITHUB_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using the hosted a8 service.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="October 23, 2026">
      <p>
        These terms cover the hosted a8 service. By creating an account you
        agree to them and to the <Link href="/privacy">Privacy Policy</Link>.
        The a8 source code on <a href={GITHUB_URL}>GitHub</a> is licensed
        separately under AGPL-3.0, and you can run it on your own server under
        that license instead.
      </p>

      <h2>Your account</h2>
      <p>
        Give a real email address and keep your password to yourself. You are
        responsible for what happens in your account. You must be at least 13,
        or the minimum age to use online services where you live, if that is
        higher.
      </p>

      <h2>Using a8</h2>
      <p>Don&apos;t use a8 to:</p>
      <ul>
        <li>break the law or anyone&apos;s rights,</li>
        <li>send spam or harass people,</li>
        <li>reach accounts or data you aren&apos;t allowed to,</li>
        <li>
          attack, overload or get around the limits of a8 or the services it
          connects to.
        </li>
      </ul>
      <p>
        You also have to follow the terms of each AI model provider and of each
        app you connect.
      </p>

      <h2>AI replies and actions</h2>
      <p>
        AI models make mistakes. Check a reply before you rely on it. a8 asks
        for your approval before it creates, changes or deletes anything in
        your apps, and you are responsible for the actions you approve. If you
        turn on auto-approve for a chat, a8 runs those actions without asking.
      </p>

      <h2>Your content</h2>
      <p>
        You own what you put into a8 and what it writes for you. You give a8
        permission to store and process it only to run the service, as the
        Privacy Policy describes. If you share a chat, anyone with the link can
        read it until you stop sharing.
      </p>

      <h2>Plans and payment</h2>
      <p>
        The Free plan costs nothing. Paid plans renew each billing period until
        you cancel, and Polar processes the payments. Credits pay for model
        usage, and a8 may limit how many you can use in a day. You can cancel
        any time in <Link href="/settings/billing">Settings, then Billing</Link>
        , and your plan stays active until the end of the period you paid for.
      </p>

      <h2>Ending your account</h2>
      <p>
        You can delete your account any time in{" "}
        <Link href="/settings/account">Settings, then Account</Link>. a8 may
        suspend or close an account that breaks these terms.
      </p>

      <h2>No warranty</h2>
      <p>
        a8 is provided &quot;as is&quot;, without warranties of any kind. a8
        doesn&apos;t promise the service will be available all the time or free
        of errors.
      </p>

      <h2>Limit of liability</h2>
      <p>
        To the extent the law allows, a8 isn&apos;t liable for indirect or
        consequential losses, or for lost data, profits or revenue. a8&apos;s
        total liability is limited to what you paid a8 in the 12 months before
        the claim.
      </p>

      <h2>Changes</h2>
      <p>
        If these terms change, a8 updates the date at the top. For a change
        that matters, a8 emails you first. Using a8 after that means you accept
        the new terms.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms? Open an issue on{" "}
        <a href={GITHUB_URL}>GitHub</a>.
      </p>
    </LegalPage>
  );
}
