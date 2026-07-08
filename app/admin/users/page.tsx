import { listUsersAdmin } from "@/services/admin-service";

export default async function AdminUsersPage() {
  const { items, total } = await listUsersAdmin();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-zinc-100">Users ({total})</h1>
      <table className="w-full text-left text-sm text-zinc-300">
        <thead className="text-xs uppercase text-zinc-500">
          <tr>
            <th className="py-2">Email</th>
            <th className="py-2">Name</th>
            <th className="py-2">Role</th>
            <th className="py-2">Joined</th>
          </tr>
        </thead>
        <tbody>
          {items.map((u) => (
            <tr key={u.id} className="border-t border-zinc-800">
              <td className="py-2">{u.email}</td>
              <td className="py-2">{u.name ?? "—"}</td>
              <td className="py-2">{u.role}</td>
              <td className="py-2">{u.createdAt.toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
