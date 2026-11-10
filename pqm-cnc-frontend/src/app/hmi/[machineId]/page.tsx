import Link from "next/link";
import { notFound } from "next/navigation";
import { MachineQualityView } from "@/components/hmi/MachineQualityView";
import { queryLiveInferenceForMachine } from "@/lib/queries/inference";
import { assets } from "@/seed/plant";

export default async function HmiMachinePage({
  params,
}: {
  params: Promise<{ machineId: string }>;
}) {
  const { machineId } = await params;
  const machine = assets.find(
    (a) => a.id === machineId && a.level === "machine",
  );
  const prediction = queryLiveInferenceForMachine(machineId);

  if (!machine || !prediction) notFound();

  return (
    <div className="space-y-4">
      <Link
        href="/hmi"
        className="text-xs text-muted transition-colors hover:text-accent"
      >
        ← All machines
      </Link>
      <MachineQualityView
        machineCode={machine.code}
        machineName={machine.name}
        prediction={prediction}
      />
    </div>
  );
}
