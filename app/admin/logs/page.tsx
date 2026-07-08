import { listAuditLogsAdmin } from "@/services/admin-service";

export default async function AdminLogsPage() {
  const { items, total } = await listAuditLogsAdmin();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-zinc-100">Audit Logs ({total})</h1>
      <div className="flex flex-col divide-y divide-zinc-800 rounded-lg border border-zinc-800">
        {items.map((log) => (
          <div key={log.id} className="flex justify-between px-4 py-2 text-sm text-zinc-300">
            <span>{log.action}</span>
            <span className="text-zinc-500">{log.user?.email ?? "system"}</span>
            <span className="text-zinc-500">{log.createdAt.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
