// /decisions — decision-matrix visualization: how the suggestion engine decides
// across customer profiles × contexts. Every cell is a REAL suggestAddons()
// output computed server-side at request time — deterministic, zero LLM calls.
// Same cart in every context column, so differences are pure persona × context.

import { deriveProfileFromRecords, type TasteProfile } from "@/lib/profile";
import type { CompletedOrderRecord, SuggestionEvent } from "@/lib/history-store";
import { suggestAddons } from "@/lib/reco/suggest";
import { getCatalogEntry } from "@/lib/menu";
import type { OrderContext } from "@/lib/reco/context";

export const metadata = { title: "COLONEL · Ma trận quyết định" };

// Fixed identity→color assignment (validated 6-slot categorical palette; light
// mode; contrast WARN on slots 2–3 is relieved by visible labels everywhere).
const SERIES: Record<string, string> = {
  "seaweed-soup": "#2a78d6",
  "pepsi-medium": "#1baf7a",
  "egg-tart": "#eda100",
  "fries-regular": "#008300",
  "lipton-medium": "#4a3aa7",
  "tenders-3pc": "#e34948",
};
const OTHER_COLOR = "#52514e";

type Persona = { key: string; label: string; hint: string; profile: TasteProfile | null };

function makeOrder(
  customerId: string,
  seq: number,
  isoDate: string,
  context: OrderContext,
  lines: CompletedOrderRecord["lines"],
): CompletedOrderRecord {
  const totalVnd = lines.reduce(
    (sum, line) => sum + (getCatalogEntry(line.catalogId)?.priceVnd ?? 0) * line.quantity,
    0,
  );
  return { customerId, orderId: `viz-${customerId}-${seq}`, placedAt: isoDate, context, lines, totalVnd };
}

function line(catalogId: string, quantity = 1, optionIds: string[] = []) {
  return { catalogId, quantity, optionIds };
}

function buildPersonas(): Persona[] {
  const zingerFan: CompletedOrderRecord[] = [1, 2, 3, 4].map((seq) =>
    makeOrder("viz_linh", seq, `2026-06-0${seq}T05:00:00.000Z`, { weather: "clear", hour: 12 }, [
      line("zinger-burger", 1, ["spice-spicy"]),
      line("pepsi-medium"),
    ]),
  );
  const familyOrders: CompletedOrderRecord[] = [1, 2, 3].map((seq) =>
    makeOrder("viz_mom", seq, `2026-06-1${seq}T12:00:00.000Z`, { weather: "clear", hour: 19 }, [
      line("combo-family-4"),
      line("lipton-medium", 2),
      line("egg-tart", 2),
    ]),
  );
  const soupDecliner = zingerFan.map((order) => ({ ...order, customerId: "viz_nosoup" }));
  const declines: SuggestionEvent[] = [
    { customerId: "viz_nosoup", catalogId: "seaweed-soup", action: "declined", at: "2026-06-05T05:00:00.000Z" },
    { customerId: "viz_nosoup", catalogId: "seaweed-soup", action: "declined", at: "2026-06-06T05:00:00.000Z" },
  ];

  return [
    { key: "guest", label: "Khách mới", hint: "chưa có lịch sử — chạy theo mặc định quần thể", profile: null },
    {
      key: "linh",
      label: "Linh — nghiện Zinger",
      hint: "4 đơn zinger cay + pepsi",
      profile: deriveProfileFromRecords(zingerFan, [], "viz_linh"),
    },
    {
      key: "mom",
      label: "Mẹ Linh — đơn gia đình",
      hint: "3 đơn combo 4 người, buổi tối",
      profile: deriveProfileFromRecords(familyOrders, [], "viz_mom"),
    },
    {
      key: "nosoup",
      label: "Khách đã chê súp ×2",
      hint: "như Linh, nhưng từ chối corn soup 2 lần",
      profile: deriveProfileFromRecords(soupDecliner, declines, "viz_nosoup"),
    },
  ];
}

const BASE_CART = [{ catalogId: "zinger-burger", quantity: 1 }];
const COMPLETE_CART = [
  { catalogId: "combo-zinger", quantity: 1 },
  { catalogId: "fries-regular", quantity: 1 },
  { catalogId: "pepsi-medium", quantity: 1 },
];

const SCENARIOS: { label: string; hint: string; context: OrderContext; cart: typeof BASE_CART }[] = [
  { label: "Trưa nắng", hint: "12h · clear", context: { weather: "clear", hour: 12 }, cart: BASE_CART },
  { label: "Trưa mưa", hint: "12h · rainy", context: { weather: "rainy", hour: 12 }, cart: BASE_CART },
  { label: "Tối nắng", hint: "19h · clear", context: { weather: "clear", hour: 19 }, cart: BASE_CART },
  { label: "Tối mưa", hint: "19h · rainy", context: { weather: "rainy", hour: 19 }, cart: BASE_CART },
  { label: "Giỏ đã đủ combo", hint: "burger + khoai + nước", context: { weather: "clear", hour: 12 }, cart: COMPLETE_CART },
];

export default function DecisionsPage() {
  const personas = buildPersonas();

  const rows = personas.map((persona) => ({
    persona,
    cells: SCENARIOS.map((scenario) => {
      const result = suggestAddons(scenario.cart, scenario.context, persona.profile);
      const item = result.suggestion ? getCatalogEntry(result.suggestion.catalogId) : null;
      return {
        decision: result.decision,
        catalogId: result.suggestion?.catalogId ?? null,
        name: item?.name ?? null,
        priceVnd: item?.priceVnd ?? null,
        reason: result.suggestion?.reason ?? null,
        score: result.suggestion?.score ?? null,
      };
    }),
  }));

  const legendItems = Array.from(
    new Set(rows.flatMap((row) => row.cells.map((cell) => cell.catalogId)).filter(Boolean) as string[]),
  ).sort((a, b) => Object.keys(SERIES).indexOf(a) - Object.keys(SERIES).indexOf(b));

  return (
    <main className="decisions">
      <header className="decisions__head">
        <h1>Ma trận quyết định — gợi ý bán kèm</h1>
        <p>
          Cùng một giỏ hàng (1 Zinger burger), mỗi ô là output thật của <code>suggestAddons()</code> theo
          hồ sơ khách × bối cảnh — engine tất định, không gọi LLM. Cột cuối chứng minh kỷ luật im lặng khi giỏ đã đủ.
        </p>
      </header>

      <div className="decisions__legend" role="list">
        {legendItems.map((catalogId) => (
          <span className="decisions__legend-item" role="listitem" key={catalogId}>
            <i style={{ background: SERIES[catalogId] ?? OTHER_COLOR }} />
            {getCatalogEntry(catalogId)?.name ?? catalogId}
          </span>
        ))}
        <span className="decisions__legend-item">
          <i className="decisions__legend-silent" />
          im lặng (không gợi ý)
        </span>
      </div>

      <div className="decisions__scroll">
        <table className="decisions__table">
          <thead>
            <tr>
              <th scope="col">Hồ sơ khách</th>
              {SCENARIOS.map((scenario) => (
                <th scope="col" key={scenario.label}>
                  {scenario.label}
                  <small>{scenario.hint}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ persona, cells }) => (
              <tr key={persona.key}>
                <th scope="row">
                  {persona.label}
                  <small>{persona.hint}</small>
                </th>
                {cells.map((cell, index) => (
                  <td key={`${persona.key}-${index}`}>
                    {cell.decision === "suggest" && cell.name ? (
                      <div
                        className="decision-cell"
                        title={cell.reason ?? undefined}
                        style={{ borderLeftColor: SERIES[cell.catalogId ?? ""] ?? OTHER_COLOR }}
                      >
                        <b>
                          <i style={{ background: SERIES[cell.catalogId ?? ""] ?? OTHER_COLOR }} />
                          {cell.name}
                        </b>
                        {cell.priceVnd ? <small>{cell.priceVnd.toLocaleString("vi-VN")}₫</small> : null}
                        {typeof cell.score === "number" ? (
                          <span className="decision-cell__score">
                            <span
                              style={{
                                width: `${Math.min(100, Math.round(cell.score * 100))}%`,
                                background: SERIES[cell.catalogId ?? ""] ?? OTHER_COLOR,
                              }}
                            />
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <div className="decision-cell decision-cell--silent" title="Engine chọn im lặng">
                        im lặng
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="decisions__note">
        Đọc theo hàng: bộ nhớ đổi quyết định (Mẹ Linh nhận gợi ý tráng miệng gia đình; khách chê súp không bao giờ
        thấy súp nữa). Đọc theo cột: bối cảnh đổi quyết định (mưa → súp nóng). Thanh dưới mỗi ô = điểm tin cậy của engine.
      </p>
    </main>
  );
}
