// Deterministic Vietnam calendar notes for the agent's world line. No fetch —
// a lookup over fixed-date holidays plus paydays and weekend timing. Kept short
// because each note lands in a single prompt line, not marketing copy.

// Fixed solar-calendar dates (month-day → note). Tết Nguyên Đán / Trung thu are
// lunar; the 2026 solar dates are hard-coded for this year's demo.
const FIXED_DATES: Record<string, string> = {
  "01-01": "Hôm nay Tết Dương lịch.",
  "02-14": "Hôm nay Valentine — nhiều đơn cho hai người.",
  "02-16": "Tết Nguyên Đán — giao hàng có thể chậm hơn thường lệ.",
  "02-17": "Đang Tết Nguyên Đán — chúc mừng năm mới!",
  "02-18": "Đang Tết Nguyên Đán — chúc mừng năm mới!",
  "02-19": "Đang Tết Nguyên Đán — chúc mừng năm mới!",
  "03-08": "Hôm nay Quốc tế Phụ nữ 8/3.",
  "04-30": "Hôm nay lễ Giải phóng miền Nam 30/4.",
  "05-01": "Hôm nay Quốc tế Lao động 1/5.",
  "06-01": "Hôm nay Quốc tế Thiếu nhi — combo gia đình được ưa chuộng.",
  "09-02": "Hôm nay Quốc khánh 2/9.",
  "09-25": "Hôm nay Tết Trung thu.",
  "10-20": "Hôm nay Ngày Phụ nữ Việt Nam 20/10.",
  "12-24": "Đêm Giáng sinh — nhiều đơn tối nay.",
  "12-25": "Hôm nay Giáng sinh.",
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/**
 * One short Vietnamese note for today's date, or null. Priority: named holiday
 * > payday > weekend-evening. Accepts an injected Date for testability.
 */
export function getCalendarNote(date: Date): string | null {
  const key = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  if (FIXED_DATES[key]) return FIXED_DATES[key];

  const day = date.getDate();
  if (day === 1 || day === 15) return "Hôm nay ngày lương 🎉";

  const dow = date.getDay(); // 0 Sun … 6 Sat
  const hour = date.getHours();
  if (dow === 5 && hour >= 17) return "Tối thứ Sáu — khởi động cuối tuần.";
  if (dow === 6 || dow === 0) return "Cuối tuần — quây quần bạn bè, gia đình.";

  return null;
}
