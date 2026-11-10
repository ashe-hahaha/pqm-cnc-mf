import { OpsDashboard } from "@/components/dashboard/OpsDashboard";
import { queryOpsDashboard } from "@/lib/queries/opsDashboard";

export default function DashboardPage() {
  const data = queryOpsDashboard();
  return <OpsDashboard data={data} />;
}
