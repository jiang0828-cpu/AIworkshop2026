import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "AI 工作台", description: "定义自己，和 AI 更好地协作" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="zh-CN"><body>{children}</body></html>; }
