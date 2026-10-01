"use client";

import dynamic from "next/dynamic";

// The editor reads the saved flow from localStorage on first render, so it
// only renders in the browser.
export const ClientFlowEditor = dynamic(
  () => import("./FlowEditor").then((m) => m.FlowEditor),
  { ssr: false },
);
