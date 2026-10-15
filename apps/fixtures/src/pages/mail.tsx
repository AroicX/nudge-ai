export function MailFixture() {
  return (
    <main>
      <header>
        <p className="eyebrow">Nudge test mail</p>
        <h1>Inbox</h1>
      </header>
      <section aria-label="Messages" className="mail-list">
        <article data-received-at="2026-10-15T20:00:00.000Z">
          <p className="eyebrow">Netflix · 8:00 PM</p>
          <h2>Your verification code</h2>
          <p>Use verification code <strong>482913</strong>. It expires in 10 minutes.</p>
        </article>
        <article data-received-at="2026-10-14T09:00:00.000Z">
          <p className="eyebrow">Netflix · Yesterday</p>
          <h2>Your payment method expires soon</h2>
          <p>Update your payment method before October 30 to keep watching.</p>
        </article>
        <article>
          <p className="eyebrow">Shop · Monday</p>
          <h2>Order 778899 shipped</h2>
          <p>This unrelated number must not be treated as an OTP.</p>
        </article>
      </section>
    </main>
  );
}
