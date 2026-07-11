// Pre-seed the learned answer cache (kfc_answer_cache) with predicted common
// questions so they answer in ~1ms on the very first ask. Every seed is pushed
// through the SAME runtime gates a live lookup uses, so a seed that could
// never actually hit (guarded, or already covered by the curated FAQ which
// runs first) fails the script instead of silently rotting in the table.
//
// Entries carry CATALOG_VERSION + a fresh created_at and expire after 24h like
// any learned answer — RE-RUN THIS RIGHT BEFORE THE DEMO:
//   npx tsx db/seed-answer-cache.ts
//
// Answers follow the library's NEVER-WRONG rule: menu facts only where the
// item is stable in menu.json (same catalog version stamp protects them), no
// exact prices, everything else is a steering answer back into the agent.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Load .env.local ourselves so the script runs with a bare `npx tsx`.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match && !(match[1] in process.env)) process.env[match[1]] = match[2];
}

const { matchFaq, matchOrderOpener, isEvergreenQuestion, normalize } = await import("../lib/faq-cache");
const { getAnswerCacheStore } = await import("../lib/answer-cache");
const { CATALOG_VERSION } = await import("../lib/menu");

const SEEDS: Array<{ q: string; a: string }> = [
  // ── menu facts (stable items in menu.json, catalog-version-stamped) ────────
  {
    q: "có bán cơm không",
    a: "Dạ có ạ! KFC có cơm gà rán, cơm gà quay phi-lê và cơm gà popcorn, ăn trưa rất hợp. Anh/chị muốn em gợi ý phần cơm nào không?",
  },
  {
    q: "có gà quay không",
    a: "Dạ có Gà Quay Phi-lê ạ, thơm mềm và ít dầu mỡ hơn gà rán. Anh/chị muốn thử một phần không ạ?",
  },
  {
    q: "có súp không",
    a: "Dạ có súp rong biển ạ, nóng hổi ăn kèm gà rán là hết ý! Anh/chị muốn thêm một phần không ạ?",
  },
  {
    q: "có mì ý không",
    a: "Dạ có Mì Ý xúc xích ạ, ăn kèm gà tenders rất hợp. Anh/chị muốn em xem combo mì ý cho mình không?",
  },
  {
    q: "gà không xương có không",
    a: "Dạ có ạ! Gà Popcorn và Gà Tenders đều không xương, ăn rất tiện. Anh/chị muốn thử món nào ạ?",
  },
  {
    q: "có món gì mới không",
    a: "Dạ đang có Gà Rán Tiêu Chanh và Gà Sốt Tỏi mới ra mắt ạ! Anh/chị muốn thử vị mới này không?",
  },
  {
    q: "nước uống có những gì",
    a: "Dạ có Pepsi, 7Up, Lipton và Pepsi Zero ạ. Anh/chị muốn ly nào để em thêm vào đơn nhé?",
  },
  {
    q: "gà cay nhất là món nào",
    a: "Dạ cay nhất là Gà Hot & Spicy ạ, cay đậm đà nhưng không quá gắt. Anh/chị thử một miếng nhé?",
  },
  {
    q: "khoai tây chiên có mấy cỡ",
    a: "Dạ khoai tây chiên có cỡ vừa và cỡ lớn ạ, còn có vị lắc phô mai với bơ tỏi nữa. Anh/chị lấy loại nào để em thêm nhé?",
  },
  // ── sizing / reco steering (no live data claimed) ───────────────────────────
  {
    q: "một mình ăn gì cho đủ",
    a: "Dạ một mình thì combo 1 người gồm gà rán, khoai tây và nước là vừa đẹp ạ. Anh/chị muốn em gợi ý combo cụ thể không?",
  },
  {
    q: "hai người nên ăn combo nào",
    a: "Dạ hai người thì Combo Group 2 hoặc Couple's Bucket là vừa đẹp ạ. Anh/chị muốn em xem chi tiết và chốt giúp không?",
  },
  {
    q: "combo nào đáng tiền nhất",
    a: "Dạ để em tính combo hời nhất cho mình nhé — anh/chị định ăn mấy người và thích gà rán hay burger hơn ạ?",
  },
  {
    q: "đặt trước được không",
    a: "Dạ được ạ! Anh/chị cứ nói món và giờ muốn nhận, em lên đơn sẵn giúp mình nhé.",
  },
  {
    q: "mua mang về được không",
    a: "Dạ được ạ, anh/chị đặt trước với em rồi ghé quầy lấy mang về, khỏi chờ lâu nhé!",
  },
  {
    q: "sáng có bán không",
    a: "Dạ KFC mở từ khoảng 9h sáng ạ, ghé ăn trưa sớm là đẹp luôn. Anh/chị muốn em chuẩn bị đơn trước không?",
  },
  {
    q: "gà giòn để lâu có sao không",
    a: "Dạ gà ngon nhất khi còn nóng giòn ạ, nên bên em chiên mới liên tục và giao nhanh. Anh/chị cứ ăn ngay khi nhận là chuẩn vị nhất!",
  },
  {
    q: "ăn kfc có mập không",
    a: "Dạ ăn vui miệng điều độ thì thoải mái ạ! Còn thông tin dinh dưỡng chi tiết anh/chị xem trên bao bì hoặc hỏi tại quầy nhé.",
  },
  // ── brand trivia (evergreen facts) ──────────────────────────────────────────
  {
    q: "kfc vào việt nam năm nào",
    a: "Dạ KFC đến Việt Nam từ năm 1997, cửa hàng đầu tiên ở TP.HCM ạ — gần 30 năm rồi đó ạ! 🐔",
  },
  {
    q: "ông già kfc là ai",
    a: "Dạ đó là Đại tá Harland Sanders, người sáng lập KFC với công thức 11 loại thảo mộc và gia vị bí mật ạ!",
  },
  {
    q: "kfc viết tắt của chữ gì",
    a: "Dạ KFC là Kentucky Fried Chicken — Gà Rán Kentucky ạ, theo tên bang Kentucky ở Mỹ nơi Đại tá Sanders bắt đầu đó ạ!",
  },
  {
    q: "công thức gà rán có gì đặc biệt",
    a: "Dạ gà KFC ướp theo công thức bí mật 11 loại thảo mộc và gia vị của Đại tá Sanders từ năm 1940 ạ — tới giờ vẫn là bí mật đó ạ!",
  },
  // ── menu facts, round 2 ─────────────────────────────────────────────────────
  {
    q: "có bánh trứng không",
    a: "Dạ có bánh trứng nướng ạ — món tráng miệng được yêu thích nhất bên em, mua lẻ hoặc set 4 cái đều được. Anh/chị thêm vào đơn không ạ?",
  },
  {
    q: "có burger tôm không",
    a: "Dạ có Burger Tôm ạ, tôm chiên giòn sốt đặc biệt, không cay. Anh/chị muốn ăn lẻ hay combo kèm khoai và nước ạ?",
  },
  {
    q: "có salad không",
    a: "Dạ có salad bắp cải trộn, salad mè nướng và salad popcorn ạ — ăn kèm gà rán đỡ ngán lắm. Anh/chị lấy loại nào ạ?",
  },
  {
    q: "có khoai tây nghiền không",
    a: "Dạ có khoai tây nghiền sốt ạ, mềm mịn thơm béo, có nhiều cỡ. Anh/chị thêm một phần nhé?",
  },
  {
    q: "cơm gà có mấy loại",
    a: "Dạ có cơm gà rán, cơm gà quay phi-lê, cơm gà popcorn Nanban, và cơm gà vị mới tiêu chanh với sốt tỏi ạ. Anh/chị chọn loại nào ạ?",
  },
  {
    q: "tráng miệng có gì",
    a: "Dạ tráng miệng có bánh trứng nướng ạ — nóng thơm, ngọt vừa. Anh/chị lấy một cái hay set 4 cái ạ?",
  },
  {
    q: "burger nào không cay",
    a: "Dạ Burger Tôm và Burger Gà Quay không cay ạ, còn Zinger thì cay nhẹ. Anh/chị chọn cái nào để em thêm nhé?",
  },
  {
    q: "bucket là gì",
    a: "Dạ Bucket là xô gà cho nhóm đông ạ — từ xô 5 miếng gà giòn tới xô 12 tenders, càng đông càng lời. Anh/chị ăn mấy người để em gợi ý cỡ xô nhé?",
  },
  {
    q: "tenders là gì",
    a: "Dạ Tenders là gà thăn phi-lê chiên giòn, không xương ạ — ăn gọn, chấm sốt rất hợp. Anh/chị thử một phần nhé?",
  },
  {
    q: "zinger là gì",
    a: "Dạ Zinger là burger gà giòn cay trứ danh của KFC ạ — miếng gà phi-lê chiên giòn, cay nhẹ đậm đà. Anh/chị thử một cái nhé?",
  },
  {
    q: "phô mai viên là gì",
    a: "Dạ là viên phô mai dai chiên giòn ạ, món ăn vặt được giới trẻ mê lắm — có phần 4 viên và 6 viên. Anh/chị thử không ạ?",
  },
  // ── sizing / logistics, round 2 ─────────────────────────────────────────────
  {
    q: "ba người ăn combo nào",
    a: "Dạ ba người thì Combo Group 3 là vừa đẹp ạ — đủ gà, popcorn và nước cho cả nhóm. Anh/chị muốn em xem chi tiết không?",
  },
  {
    q: "bốn người ăn gì cho đủ",
    a: "Dạ nhóm bốn người thì Party Bucket hoặc Big Combo là no nê ạ. Anh/chị muốn em so hai phương án xem cái nào lợi hơn không?",
  },
  {
    q: "công ty đặt số lượng lớn được không",
    a: "Dạ được ạ! Đơn số lượng lớn cho văn phòng, tiệc công ty bên em nhận thường xuyên. Anh/chị cho em số phần và giờ nhận, em lên đơn liền nhé.",
  },
  {
    q: "khuya còn bán không",
    a: "Dạ đa số cửa hàng mở tới 22h ạ. Anh/chị đặt trước giờ đó là bên em phục vụ được nhé!",
  },
  {
    q: "ship cho người khác được không",
    a: "Dạ được ạ! Anh/chị đặt món rồi gửi địa chỉ và số điện thoại người nhận, bên em giao tận nơi cho người thân mình nhé.",
  },
  {
    q: "trả tiền khi nhận hàng được không",
    a: "Dạ được ạ, anh/chị chọn thanh toán khi nhận hàng (COD) thoải mái — tiền mặt hay quẹt thẻ lúc nhận đều được nhé!",
  },
  {
    q: "đang ăn kiêng thì chọn gì",
    a: "Dạ ăn nhẹ thì gà quay phi-lê với salad bắp cải hoặc súp rong biển là êm nhất ạ. Anh/chị muốn em ghép một phần gọn nhẹ không?",
  },
  {
    q: "không ăn được cay thì chọn gì",
    a: "Dạ không cay thì gà rán truyền thống, Burger Tôm hoặc gà quay phi-lê đều êm ạ. Anh/chị chọn món nào để em thêm nhé?",
  },
  // ── trivia & personality, round 2 ───────────────────────────────────────────
  {
    q: "kfc của nước nào",
    a: "Dạ KFC đến từ Mỹ ạ — ra đời ở bang Kentucky, giờ có mặt ở hơn 145 quốc gia rồi đó ạ! 🌎",
  },
  {
    q: "logo kfc là ai",
    a: "Dạ gương mặt trên logo là Đại tá Harland Sanders, người sáng lập KFC đó ạ — bộ vest trắng với nơ đen huyền thoại!",
  },
  {
    q: "kfc có bao nhiêu cửa hàng ở việt nam",
    a: "Dạ KFC có hàng trăm cửa hàng khắp Việt Nam ạ, từ thành phố lớn tới nhiều tỉnh thành. Anh/chị ở đâu cũng dễ tìm được một tiệm gần mình đó ạ!",
  },
  {
    q: "đói quá",
    a: "Dạ để em cứu đói liền ạ! 🍗 Anh/chị thích gà rán, burger hay cơm để em gợi ý nhanh phần ngon nhất nhé?",
  },
  {
    q: "thèm gà rán quá",
    a: "Dạ chuẩn bài rồi ạ! Gà Rán Giòn Truyền Thống nóng hổi đang chờ anh/chị đây. Mình ăn mấy miếng để em lên đơn nhé? 🍗",
  },
  {
    q: "ăn gì bây giờ",
    a: "Dạ để em gợi ý nhé — anh/chị đang thèm mặn đậm đà, cay cay, hay thanh nhẹ ạ? Nói khẩu vị là em chọn trúng liền!",
  },
  {
    q: "gợi ý giúp mình món ngon",
    a: "Dạ ngay đây ạ! Anh/chị cho em biết ăn mấy người và khẩu vị (cay/không cay), em ghép phần ngon và lợi nhất liền nhé!",
  },
];

const store = getAnswerCacheStore();
let seeded = 0;
const problems: string[] = [];

for (const { q, a } of SEEDS) {
  // Same gates as the live lookup path, in the live order: curated FAQ and the
  // opener clarifier run FIRST, so a seed they already answer is unreachable.
  if (!isEvergreenQuestion(q)) {
    problems.push(`GUARDED (would never hit): "${q}"`);
    continue;
  }
  const curated = matchFaq(q) ?? (await matchOrderOpener(q));
  if (curated) {
    problems.push(`SHADOWED by curated "${curated.id}" (would never hit): "${q}"`);
    continue;
  }
  await store.put({
    key: normalize(q),
    say: a,
    hits: 0,
    createdAt: new Date().toISOString(),
    catalogVersion: CATALOG_VERSION,
  });
  seeded += 1;
  console.log(`seeded: "${q}"`);
}

console.log(`\n${seeded}/${SEEDS.length} seeded (catalog ${CATALOG_VERSION}, TTL 24h — re-run before the demo).`);
if (problems.length) {
  console.error(`\nNOT seeded:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
