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
          <small>Đặt món qua chat, nhớ khẩu vị của bạn · KFC Việt Nam · AABW 2026</small>
        </div>
      </div>

      <div className="launcher__cards">
        <Link href="/user" className="launcher__card">
          <span className="launcher__tag">/user</span>
          <b>Điện thoại của khách</b>
          <p>Chat Messenger mock, thứ duy nhất khách (và khán giả gần) nhìn thấy. Mở cửa sổ hẹp cỡ điện thoại.</p>
        </Link>
        <Link href="/backend" className="launcher__card launcher__card--dark">
          <span className="launcher__tag">/backend</span>
          <b>Bàn điều khiển demo</b>
          <p>Kịch bản, persona, thời tiết, kịch bản hết hàng + hội thoại, đơn hàng và tool call của agent, chiếu màn hình này.</p>
        </Link>
        <Link href="/voice" className="launcher__card">
          <span className="launcher__tag">/voice</span>
          <b>Nói chuyện với Đại sứ ảo KFC 🎤</b>
          <p>Nhân vật 3D nói tiếng Việt, khách nói, Đại sứ đáp lời và nhép miệng. Cùng một agent, cùng bộ tool bên dưới.</p>
        </Link>
      </div>

      <p className="launcher__note">
        Mở cả hai trong cùng một trình duyệt, chúng tự đồng bộ trực tiếp. Kênh thật (Messenger webhook) chạy song song
        qua <code>/api/webhook/messenger</code>.
      </p>
    </main>
  );
}
