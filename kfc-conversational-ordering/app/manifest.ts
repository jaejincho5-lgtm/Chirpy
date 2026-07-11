import type { MetadataRoute } from "next";

// F17 — lets /user install full-screen on a phone: no browser chrome on stage.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KFC VN — Đặt món qua chat",
    short_name: "KFC Chat",
    description: "Đặt món KFC Việt Nam qua hội thoại — Project Chirpy.",
    start_url: "/user",
    display: "standalone",
    background_color: "#f7f3ea",
    theme_color: "#E4002B",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
