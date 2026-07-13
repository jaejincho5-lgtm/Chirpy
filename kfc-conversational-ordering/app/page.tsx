import Link from "next/link";
import { KfcMark } from "./demo-shared";

// Demo launcher: the customer phone and the director console are separate
// surfaces so the phone stays believable on stage. Open both, side by side or
// on two screens (same browser — they sync over a BroadcastChannel).

export default function Launcher() {
  return (
    <main className="launcher">
      <div className="launcher__brand">
        <div className="brand-mark" aria-hidden>
          <KfcMark />
        </div>
        <div>
          <b>Chirpy</b>
          <small>Order by chat, with taste memory · KFC Vietnam · AABW 2026</small>
        </div>
      </div>

      <div className="launcher__cards">
        <Link href="/user" className="launcher__card">
          <span className="launcher__tag">/user</span>
          <b>Customer phone</b>
          <p>Messenger-style customer chat. Open it in a narrow phone-sized window.</p>
        </Link>
        <Link href="/backend" className="launcher__card launcher__card--dark">
          <span className="launcher__tag">/backend</span>
          <b>Demo console</b>
          <p>Script, persona, weather, out-of-stock scenario, conversations, orders, and agent tool calls. Put this screen on the projector.</p>
        </Link>
        <Link href="/voice" className="launcher__card">
          <span className="launcher__tag">/voice</span>
          <b>Talk to the KFC virtual ambassador 🎤</b>
          <p>A 3D character listens, replies, and lip-syncs. It uses the same agent and tools underneath.</p>
        </Link>
      </div>

      <p className="launcher__note">
        Open both in the same browser and they sync live. The real Messenger webhook runs in parallel
        via <code>/api/webhook/messenger</code>.
      </p>
    </main>
  );
}
