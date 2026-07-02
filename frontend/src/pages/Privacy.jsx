// Privacy Policy stub page. Public route. Matches the visual style of Terms.jsx.
import React from "react";
import { Link } from "react-router-dom";
import Footer from "@/components/Footer";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-[#F4F4F5] flex flex-col" data-testid="privacy-page">
      <header className="bg-white border-b border-[#E4E4E7]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="font-heading text-base text-[#09090B]">
            Pro-Quote Estimating Tool
          </Link>
          <Link to="/" className="text-xs uppercase tracking-wider text-[#52525B] hover:text-[#09090B]">
            ← Back
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-[#71717A] mb-1">Legal</div>
        <h1 className="font-heading text-4xl text-[#09090B] mb-2">Privacy Policy</h1>
        <p className="text-xs text-[#71717A] mb-8">
          Last updated: {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </p>

        <div className="prose prose-sm text-[#52525B] space-y-6 leading-relaxed">
          <section>
            <h2 className="font-heading text-xl text-[#09090B] mb-2">What we collect</h2>
            <p>When you use Pro-Quote Estimating Tool, we collect:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li><strong>Account info</strong> — your name, email address, role, company name, and any company logo or branding you upload.</li>
              <li><strong>Estimate data</strong> — customer names, addresses, line items, pricing, photos, scope notes, and quote history.</li>
              <li><strong>Usage data</strong> — login timestamps, device type, and basic interaction logs for debugging.</li>
              <li><strong>Email delivery data</strong> — when quotes are sent, opened, accepted, or replied to (via Resend).</li>
              <li><strong>HOVER report uploads</strong> — the PDF text is sent to Anthropic (Claude) for measurement extraction, then immediately discarded; we do not retain raw HOVER PDFs after parsing.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-xl text-[#09090B] mb-2">How we use it</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>To operate the Service — show your estimates, send quote emails, calculate totals.</li>
              <li>To improve the product — diagnose bugs, understand which features are used.</li>
              <li>To send required transactional emails (estimate acceptance notifications, password resets).</li>
              <li>To enforce these terms — prevent spam, abuse, or fraud.</li>
            </ul>
            <p className="mt-3">
              <strong>We do not sell your data.</strong> We do not share contractor or homeowner information with
              third-party advertisers or data brokers.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl text-[#09090B] mb-2">Who we share with</h2>
            <p>We use these processors strictly to deliver the Service:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li><strong>Resend</strong> — email delivery (quote emails sent to homeowners).</li>
              <li><strong>Anthropic</strong> — AI parsing of HOVER measurement PDFs (text only; raw PDFs are not retained).</li>
              <li><strong>MongoDB Atlas</strong> — encrypted database hosting.</li>
              <li><strong>Cloud infrastructure provider</strong> — application hosting.</li>
              <li><strong>Alside Supply</strong> (the Supplier) — aggregated pipeline analytics (number of estimates, win rate per contractor, sum of won dollars). The Supplier does NOT see individual customer names, addresses, or quote line items.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-xl text-[#09090B] mb-2">Cookies &amp; sessions</h2>
            <p>
              We use a single httpOnly authentication cookie (`JWT`) to keep you logged in. We do not use
              third-party tracking cookies, advertising pixels, or session-replay tools.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl text-[#09090B] mb-2">Your rights</h2>
            <p>You can:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li><strong>Access</strong> your data anytime via your account dashboard.</li>
              <li><strong>Export</strong> your estimates via the CSV download.</li>
              <li><strong>Delete</strong> individual estimates from the dashboard, or request full account deletion by emailing us.</li>
              <li><strong>Correct</strong> any inaccurate information via the account settings.</li>
            </ul>
            <p className="mt-3">
              California, Virginia, Colorado, and EU/UK residents have additional rights under CCPA / CDPA / CPA /
              GDPR. We honor verified requests within 30 days.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl text-[#09090B] mb-2">Security</h2>
            <p>
              Passwords are bcrypt-hashed. All traffic between your browser and our servers is TLS-encrypted.
              Sensitive API keys are stored as environment variables, never in the codebase. No system is 100%
              secure, but we take reasonable steps to protect your data.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl text-[#09090B] mb-2">Data retention</h2>
            <p>
              We retain estimate data as long as your account is active. When you close your account, we delete
              your data within 90 days, except where required to retain by law (e.g., for tax records).
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl text-[#09090B] mb-2">Changes</h2>
            <p>
              We may update this Privacy Policy from time to time. Material changes will be announced via email
              to account holders.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl text-[#09090B] mb-2">Contact</h2>
            <p>
              For privacy questions or data requests, email{" "}
              <a href="mailto:hhunt6677@yahoo.com" className="text-[#C2410C] hover:underline">
                hhunt6677@yahoo.com
              </a>.
            </p>
          </section>

          <p className="text-xs text-[#71717A] mt-10 pt-6 border-t border-[#E4E4E7]">
            This is a general-purpose template. Consult a licensed attorney to tailor it to your specific business
            and jurisdiction before relying on it as a binding agreement.
          </p>
        </div>
      </main>

      <Footer />
    </div>
  );
}
