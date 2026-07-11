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
  // ── menu facts, round 3 ─────────────────────────────────────────────────────
  {
    q: "kfc có những món gì",
    a: "Dạ đủ cả ạ: gà rán, gà quay, burger, cơm gà, mì ý, khoai tây, salad, súp, bánh trứng và nước ngọt. Anh/chị thèm nhóm nào để em kể chi tiết nhé?",
  },
  {
    q: "menu có gì",
    a: "Dạ menu có gà rán, gà quay, burger, cơm gà, mì ý, món ăn vặt, tráng miệng và nước ạ. Anh/chị muốn xem nhóm nào trước nhé?",
  },
  {
    q: "có gà sốt tỏi không",
    a: "Dạ có Gà Sốt Tỏi mới ra mắt ạ, đậm đà kiểu nước mắm tỏi rất bắt cơm. Anh/chị thử một miếng nhé?",
  },
  {
    q: "có gà tiêu chanh không",
    a: "Dạ có Gà Rán Tiêu Chanh mới ạ — vị tiêu đen chanh tươi lạ miệng lắm. Anh/chị muốn ăn lẻ hay kèm cơm ạ?",
  },
  {
    q: "gà tiêu chanh là món gì",
    a: "Dạ là gà rán phủ sốt tiêu đen và chanh tươi ạ — chua nhẹ, thơm tiêu, đang là vị mới hot nhất bên em. Anh/chị thử nhé?",
  },
  {
    q: "có pepsi không đường không",
    a: "Dạ có Pepsi Zero không đường ạ, đủ cỡ luôn. Anh/chị lấy ly nào để em thêm nhé?",
  },
  {
    q: "có trà không",
    a: "Dạ có trà Lipton ạ, mát lạnh đủ cỡ. Anh/chị thêm một ly nhé?",
  },
  {
    q: "có cơm thêm không",
    a: "Dạ có cơm thêm ạ, gọi kèm món mặn nào cũng được. Anh/chị lấy mấy phần cơm để em ghi nhé?",
  },
  {
    q: "burger gà yo là gì",
    a: "Dạ Burger Gà Yo là burger gà nhỏ gọn giá mềm ạ, có vị cay và không cay. Ăn lót dạ hay kèm combo đều hợp — anh/chị thử không ạ?",
  },
  {
    q: "mì ý có mấy loại",
    a: "Dạ có ba loại ạ: mì ý xúc xích, mì ý gà popcorn và mì ý gà rán. Anh/chị chọn loại nào để em thêm nhé?",
  },
  {
    q: "popcorn có mấy cỡ",
    a: "Dạ gà popcorn có cỡ vừa và cỡ lớn ạ, còn có vị lắc phô mai với bơ tỏi nữa. Anh/chị lấy cỡ nào ạ?",
  },
  {
    q: "bánh trứng có set không",
    a: "Dạ có ạ — mua lẻ một cái hoặc set 4 cái tiết kiệm hơn. Anh/chị lấy set cho cả nhà nhé?",
  },
  {
    q: "có xúc xích không",
    a: "Dạ xúc xích nằm trong món mì ý xúc xích ạ, thơm béo rất được lòng các bé. Anh/chị thử một phần không ạ?",
  },
  {
    q: "có món ăn vặt không",
    a: "Dạ nhiều lắm ạ: gà popcorn, phô mai viên, khoai tây chiên, khoai tây nghiền và bánh trứng. Anh/chị nhấm nháp món nào nhé?",
  },
  {
    q: "salad có mấy loại",
    a: "Dạ có ba loại ạ: salad bắp cải trộn, salad mè nướng và salad popcorn. Anh/chị lấy loại nào để em thêm nhé?",
  },
  {
    q: "súp rong biển là món gì",
    a: "Dạ là súp nóng nấu rong biển ạ — thanh nhẹ, ăn khai vị hay kèm cơm gà đều hợp. Anh/chị thêm một chén nhé?",
  },
  {
    q: "coleslaw là gì",
    a: "Dạ coleslaw là salad bắp cải trộn sốt kem mát giòn ạ — món kèm kinh điển của KFC, ăn với gà rán đỡ ngán lắm. Anh/chị thử nhé?",
  },
  {
    // NOT "nanban là gì" — that contains "ban la gi", an identity FAQ trigger.
    q: "nanban là món gì",
    a: "Dạ Nanban là cơm gà popcorn sốt chua ngọt kiểu Nhật ạ — vị lạ miệng mà giá rất mềm. Anh/chị thử một phần không ạ?",
  },
  {
    q: "khoai tây lắc phô mai là gì",
    a: "Dạ là khoai tây chiên lắc bột phô mai ạ, mặn ngọt beo béo — còn có vị bơ tỏi nữa. Anh/chị lấy loại nào nhé?",
  },
  {
    q: "gà rán và tenders khác gì nhau",
    a: "Dạ gà rán là miếng gà có xương da giòn, còn tenders là thăn gà phi-lê không xương ạ. Ăn gọn thì tenders, đã miệng thì gà rán — anh/chị chọn bên nào ạ?",
  },
  {
    q: "gà giòn với gà cay khác nhau chỗ nào",
    a: "Dạ gà giòn truyền thống vị nguyên bản không cay, còn Hot & Spicy tẩm ớt cay nhẹ đậm đà hơn ạ. Anh/chị đội nào — truyền thống hay cay? 😄",
  },
  {
    q: "phần nào nhiều gà nhất",
    a: "Dạ nhiều gà nhất là Cheers Combo với 12 miếng gà rán ạ — đúng chuẩn tiệc gà cho hội đông. Anh/chị chiến luôn không ạ? 🍗",
  },
  {
    q: "xô gà lớn nhất là gì",
    a: "Dạ xô đã nhất là Party Bucket ạ — 9 miếng gà kèm nước cho cả nhóm. Còn thèm nữa thì Cheers Combo 12 miếng luôn. Anh/chị chọn xô nào ạ?",
  },
  // ── reco / sizing, round 3 ──────────────────────────────────────────────────
  {
    q: "có phần ăn cho một người không",
    a: "Dạ có nguyên nhóm combo 1 người ạ — gà, khoai, nước đầy đủ mà giá gọn. Anh/chị thích gà rán, burger hay cơm để em chọn combo hợp nhé?",
  },
  {
    q: "combo gia đình có không",
    a: "Dạ có combo nhóm và xô gà cho gia đình ạ — từ 2 tới 5-6 người đều có cỡ vừa vặn. Nhà mình mấy người để em gợi ý đúng phần nhé?",
  },
  {
    q: "có combo cho cặp đôi không",
    a: "Dạ có Couple's Bucket và Combo Chill Couple cho hai người ạ — đủ gà, khoai, nước cho buổi hẹn. Anh/chị muốn em xem chi tiết không?",
  },
  {
    q: "hẹn hò nên chọn gì",
    a: "Dạ hẹn hò thì Couple's Bucket là chuẩn bài ạ — vừa ăn vừa tám, không lo thiếu. Anh/chị muốn em lên đơn cho buổi hẹn không? 😄",
  },
  {
    q: "mua về cho cả nhà thì chọn gì",
    a: "Dạ cả nhà thì xô gà Party Bucket hoặc Big Combo là vừa đẹp ạ. Nhà mình mấy người để em chọn cỡ cho chuẩn nhé?",
  },
  {
    q: "người già ăn món nào hợp",
    a: "Dạ ông bà thì gà quay phi-lê mềm, súp rong biển và cơm gà là dễ ăn nhất ạ. Anh/chị muốn em ghép một phần nhẹ nhàng không?",
  },
  {
    q: "bé không ăn cay được thì sao",
    a: "Dạ khỏi lo ạ! Gà rán truyền thống, tenders, mì ý xúc xích đều không cay, các bé mê lắm. Anh/chị lấy phần nào cho bé nhé?",
  },
  {
    q: "ăn nhẹ thì chọn món nào",
    a: "Dạ ăn nhẹ thì gà popcorn, phô mai viên hay bánh trứng là vừa xinh ạ. Anh/chị nhấm nháp món nào nhé?",
  },
  {
    q: "buồn miệng ăn gì",
    a: "Dạ buồn miệng thì gà popcorn lắc phô mai hoặc khoai tây lắc bơ tỏi là hết buồn liền ạ 😄 Em thêm một phần nhé?",
  },
  {
    q: "burger và cơm cái nào no hơn",
    a: "Dạ chắc bụng lâu thì cơm gà, gọn lẹ thì burger ạ. Đói cỡ nào rồi — để em chọn giúp luôn nhé? 😄",
  },
  {
    q: "trưa nay ăn gì",
    a: "Dạ trưa thì cơm gà rán hoặc combo 1 người là gọn đẹp ạ — có gà, khoai, nước đầy đủ. Anh/chị muốn em lên đơn ăn trưa không?",
  },
  {
    q: "tối nay ăn gì",
    a: "Dạ tối thì làm xô gà giòn chia cả nhà, hay combo burger cho gọn ạ? Anh/chị ăn mấy người để em gợi ý chuẩn nhé?",
  },
  {
    q: "khát nước quá",
    a: "Dạ giải khát liền ạ! Có Pepsi, 7Up, Lipton mát lạnh — anh/chị lấy ly nào, sẵn em gợi ý thêm miếng gà nhé? 😄",
  },
  {
    q: "giá cả thế nào",
    a: "Dạ từ món lẻ vài chục nghìn tới combo và xô gà cho nhóm ạ. Anh/chị cho em ngân sách và số người, em ghép phần lợi nhất liền nhé!",
  },
  // ── logistics / service, round 3 ────────────────────────────────────────────
  {
    q: "có giao buổi tối không",
    a: "Dạ có ạ, bên em giao tới khoảng 22h theo giờ cửa hàng. Anh/chị đặt sớm chút buổi tối là đẹp nhất nhé!",
  },
  {
    q: "giờ trưa có đông không",
    a: "Dạ trưa 11h30–13h là cao điểm ạ. Anh/chị đặt trước qua em là né được cảnh chờ, tới nơi có đồ liền nhé!",
  },
  {
    q: "đặt cho ngày mai được không",
    a: "Dạ anh/chị cứ nói món và giờ muốn nhận ngày mai, em ghi nhớ sẵn — tới lúc đó chỉ cần xác nhận là em lên đơn liền ạ!",
  },
  {
    q: "đổi địa chỉ giao được không",
    a: "Dạ được nếu đơn chưa đi ạ — anh/chị nhắn em địa chỉ mới càng sớm càng tốt, em cập nhật giúp mình nhé.",
  },
  {
    q: "giao trễ thì sao",
    a: "Dạ nếu đơn tới trễ hơn dự kiến, anh/chị nhắn em ngay nhé — em kiểm tra với cửa hàng và đội hỗ trợ xử lý cho mình ạ. 🙏",
  },
  {
    q: "đồ ăn có gói kỹ không",
    a: "Dạ đồ được đóng hộp kín trong túi giấy KFC ạ, gà giữ nóng, nước ly riêng chống đổ. Anh/chị yên tâm nhé!",
  },
  {
    q: "có muỗng nĩa kèm không",
    a: "Dạ có kèm dụng cụ ăn và khăn giấy ạ. Cần thêm bộ nào anh/chị cứ dặn em khi chốt đơn nhé!",
  },
  {
    q: "lấy thêm tương ớt được không",
    a: "Dạ được ạ! Anh/chị dặn em khi chốt đơn là bên em bỏ thêm tương ớt, tương cà cho mình nhé.",
  },
  {
    q: "có chỗ đậu xe không",
    a: "Dạ tuỳ chi nhánh ạ — nhiều cửa hàng có chỗ để xe máy, ô tô thì anh/chị xem chi nhánh lớn nhé. Hoặc đặt giao tận nơi khỏi lo đậu xe luôn ạ! 😄",
  },
  {
    q: "mang thú cưng vào được không",
    a: "Dạ chính sách thú cưng tuỳ chi nhánh ạ, anh/chị hỏi nhân viên cửa hàng trước khi ghé nhé. Hoặc đặt giao về nhà ăn cùng boss cũng ấm cúng ạ! 🐶",
  },
  {
    q: "có phòng sinh nhật riêng không",
    a: "Dạ một số chi nhánh lớn có khu vực tổ chức sinh nhật ạ. Anh/chị liên hệ cửa hàng gần mình để giữ chỗ, còn phần gà tiệc thì em lo được nhé! 🎂",
  },
  {
    q: "hóa đơn điện tử có không",
    a: "Dạ có ạ, KFC hỗ trợ hoá đơn điện tử — anh/chị để lại thông tin xuất hoá đơn khi nhận hàng hoặc tại quầy nhé!",
  },
  {
    q: "đồ chơi kèm phần ăn có không",
    a: "Dạ tuỳ chương trình từng đợt ạ — có đợt kèm quà cho bé. Anh/chị hỏi nhân viên tại quầy đợt này có quà gì nhé!",
  },
  // ── payment / promo, round 3 ────────────────────────────────────────────────
  {
    q: "chuyển khoản được không",
    a: "Dạ được ạ, thanh toán online có hỗ trợ chuyển khoản và ví điện tử. Anh/chị chọn cách trả lúc chốt đơn nhé!",
  },
  {
    q: "thẻ nào cũng quẹt được hả",
    a: "Dạ hầu hết thẻ ATM nội địa và thẻ quốc tế Visa/Master đều dùng được ạ. Anh/chị quẹt tại quầy hay trả khi nhận hàng đều ổn nhé!",
  },
  {
    q: "mua nhiều có bớt không",
    a: "Dạ đơn nhóm thì combo và xô gà đã là giá gộp tiết kiệm sẵn ạ, cộng thêm mã giảm giá nếu có nữa. Anh/chị nói số người, em ghép phương án lợi nhất nhé!",
  },
  {
    q: "sinh viên có khuyến mãi riêng không",
    a: "Dạ ưu đãi thay đổi theo đợt ạ. Ví tiền sinh viên thì em gợi ý combo tiết kiệm với món giá mềm là chuẩn nhất — em kê một phần 'ngon-bổ-rẻ' nhé?",
  },
  {
    q: "mã giảm giá dùng sao",
    a: "Dạ dễ lắm ạ — anh/chị đọc mã cho em lúc chốt đơn, em áp vào và báo ngay tiết kiệm được bao nhiêu nhé!",
  },
  // ── trivia & personality, round 3 ───────────────────────────────────────────
  {
    q: "gà rán kfc ra đời năm nào",
    a: "Dạ công thức gà rán của Đại tá Sanders có từ năm 1940, và nhà hàng nhượng quyền KFC đầu tiên mở năm 1952 ạ!",
  },
  {
    q: "đại tá sanders mở kfc năm bao nhiêu tuổi",
    a: "Dạ ông khởi nghiệp nhượng quyền KFC ở tuổi 62 đó ạ — không bao giờ là quá muộn để bắt đầu, đúng không anh/chị? 😄",
  },
  {
    q: "kfc có mặt ở bao nhiêu nước",
    a: "Dạ KFC có mặt ở hơn 145 quốc gia và vùng lãnh thổ ạ — đi đâu cũng gặp được ông Đại tá đó ạ! 🌎",
  },
  {
    q: "khẩu hiệu của kfc là gì",
    a: "Dạ là \"Finger Lickin' Good\" — Vị ngon trên từng ngón tay ạ! Ăn xong mút ngón tay là hiểu liền đó ạ 😄",
  },
  {
    q: "gà kfc chiên bằng gì",
    a: "Dạ gà được chiên bằng nồi áp suất theo chuẩn KFC toàn cầu ạ — bí quyết giúp da giòn rụm mà thịt bên trong vẫn mọng mềm đó ạ!",
  },
  {
    q: "tại sao gà kfc ngon vậy",
    a: "Dạ nhờ công thức 11 loại thảo mộc gia vị bí mật cộng với chiên áp suất chuẩn toàn cầu ạ — da giòn, thịt mọng, thơm khó cưỡng đó ạ! 🍗",
  },
  {
    q: "sao gọi là gà rán kentucky",
    a: "Dạ vì Đại tá Sanders bắt đầu bán gà ở bang Kentucky nước Mỹ ạ — tên bang thành tên thương hiệu luôn đó ạ!",
  },
  {
    q: "kfc khác gì lotteria",
    a: "Dạ em không dám chê bạn nào ạ 😄 Em chỉ biết gà KFC có công thức 11 gia vị độc quyền với chiên áp suất giòn rụm — anh/chị thử rồi tự chấm điểm nhé!",
  },
  {
    q: "em mấy tuổi",
    a: "Dạ em là gà AI nên tính tuổi bằng phiên bản ạ 🐔 Còn trẻ còn khoẻ, gọi món cho anh/chị nhanh như chớp luôn!",
  },
  {
    q: "em có ăn được gà không",
    a: "Dạ em xin phép không trả lời câu hỏi nhạy cảm này ạ 🐔😅 Nhưng em cam đoan gà bên em ngon — anh/chị ăn giúp phần của em luôn nhé!",
  },
  {
    q: "em người miền nào",
    a: "Dạ quê gốc em ở Kentucky nước Mỹ, nhưng em nói giọng Việt và rành menu Việt Nam lắm ạ 🐔 Anh/chị muốn ăn gì để em tư vấn nhé?",
  },
  {
    q: "nói chuyện được không",
    a: "Dạ được chứ ạ! Em vừa tám vừa gọi món được luôn. Mà tám về gà thì em là chuyên gia đó — anh/chị muốn hỏi gì nào? 😄",
  },
  {
    q: "kể chuyện cười đi",
    a: "Dạ nè: Con gà đi qua đường để làm gì ạ? — Để tới KFC bên kia đường cho nhanh đó ạ! 🐔😄 Giờ tới lượt anh/chị: ăn gì nào?",
  },
  {
    q: "hôm nay trời đẹp quá",
    a: "Dạ trời đẹp vậy làm bữa gà giòn là tròn vị luôn ạ! Anh/chị muốn em gợi ý phần nào hợp hôm nay không? 🍗",
  },
  {
    q: "cho hỏi có cơm gà không",
    a: "Dạ có ạ! Cơm gà rán, cơm gà quay phi-lê và cơm gà popcorn đều sẵn sàng. Anh/chị chọn loại nào để em thêm nhé?",
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
