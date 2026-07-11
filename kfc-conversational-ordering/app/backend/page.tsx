"use client";

// /backend — the operator console, organized into Odoo-style modules. A flat
// app-switcher swaps the active module; every module stays MOUNTED (hidden via
// CSS) so the Director's live BroadcastChannel link and every module's polling
// never reset when the operator tabs around.

import { useState, type ReactNode } from "react";
import { KfcMark } from "../demo-shared";
import { DirectorModule } from "./modules/director";
import { OrdersModule } from "./modules/orders";
import { CustomersModule } from "./modules/customers";
import { ReengageModule } from "./modules/reengage";
import { VouchersModule } from "./modules/vouchers";
import { PromotionsModule } from "./modules/promotions";
import { StockModule } from "./modules/stock";
import { AgentOpsModule } from "./modules/agent-ops";
import { InboxModule } from "./modules/inbox";

type ModuleKey =
  | "director"
  | "orders"
  | "inbox"
  | "customers"
  | "reengage"
  | "vouchers"
  | "promotions"
  | "stock"
  | "agent";

const MODULES: Array<{ key: ModuleKey; label: string }> = [
  { key: "director", label: "Đạo diễn" },
  { key: "orders", label: "Đơn hàng" },
  { key: "inbox", label: "Hộp thư" },
  { key: "customers", label: "Khách hàng" },
  { key: "reengage", label: "Nhắc đơn thông minh" },
  { key: "vouchers", label: "Voucher" },
  { key: "promotions", label: "Khuyến mãi" },
  { key: "stock", label: "Kho" },
  { key: "agent", label: "Agent" },
];

// One consistent single-stroke icon set (currentColor, so active/inactive tint
// is free) replacing the eight mismatched emoji.
function ModuleIcon({ name }: { name: ModuleKey }) {
  const paths: Record<ModuleKey, ReactNode> = {
    director: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18M10 13l4 2.5-4 2.5z" />
      </>
    ),
    orders: (
      <>
        <path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z" />
        <path d="M9 8h6M9 12h6" />
      </>
    ),
    inbox: (
      <>
        <path d="M4 5h16v11H9l-5 4z" />
        <path d="M8.5 9h7M8.5 12h4.5" />
      </>
    ),
    customers: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.7M17 20a5.5 5.5 0 0 0-2-4.3" />
      </>
    ),
    reengage: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7.5V12l3 2" />
      </>
    ),
    vouchers: (
      <>
        <path d="M3 8a2 2 0 0 1 2-2h9l7 6-7 6H5a2 2 0 0 1-2-2z" />
        <circle cx="8" cy="12" r="1.2" />
      </>
    ),
    promotions: (
      <>
        <path d="M4 10v4l10 4V6zM4 10H3v4h1M14 8a4 4 0 0 1 0 8" />
      </>
    ),
    stock: (
      <>
        <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
        <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
      </>
    ),
    agent: (
      <>
        <rect x="5" y="8" width="14" height="11" rx="2" />
        <path d="M12 8V4M9 13h.01M15 13h.01M9 8h6" />
      </>
    ),
  };
  return (
    <svg
      className="module-tab__icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths[name]}
    </svg>
  );
}

export default function BackendConsole() {
  const [active, setActive] = useState<ModuleKey>("director");

  return (
    <main className="stage">
      <header className="topbar">
        <div className="topbar__brand">
          <div className="brand-mark" aria-hidden>
            <KfcMark />
          </div>
          <div>
            <b>Chirpy · Backend</b>
            <small>Bàn điều khiển vận hành, mô-đun hóa</small>
          </div>
        </div>
        <nav className="module-nav">
          {MODULES.map((module) => (
            <button
              key={module.key}
              type="button"
              className={`module-tab ${active === module.key ? "is-active" : ""}`}
              onClick={() => setActive(module.key)}
              aria-pressed={active === module.key}
            >
              <ModuleIcon name={module.key} />
              {module.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Every module stays mounted; only the active one is shown. This keeps
          the Director's bus subscription and all polling alive across tabs. */}
      <div hidden={active !== "director"}>
        <DirectorModule />
      </div>
      <div hidden={active !== "orders"}>
        <OrdersModule />
      </div>
      <div hidden={active !== "inbox"}>
        <InboxModule />
      </div>
      <div hidden={active !== "customers"}>
        <CustomersModule />
      </div>
      <div hidden={active !== "reengage"}>
        <ReengageModule />
      </div>
      <div hidden={active !== "vouchers"}>
        <VouchersModule />
      </div>
      <div hidden={active !== "promotions"}>
        <PromotionsModule />
      </div>
      <div hidden={active !== "stock"}>
        <StockModule />
      </div>
      <div hidden={active !== "agent"}>
        <AgentOpsModule />
      </div>
    </main>
  );
}
