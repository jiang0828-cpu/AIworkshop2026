"use client";
import type { ReactNode } from "react";
import RadarWorkspace from "./radar/Workspace";
import type { ModuleProps } from "./Shared";
export default function SituationModule({ props }: { props: ModuleProps; legacy: ReactNode }) {
  return <RadarWorkspace props={props} />;
}
