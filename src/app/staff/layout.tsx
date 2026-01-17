import { redirect } from "next/navigation";
import { isStaffMember } from "@/lib/isStaff";

export const dynamic = "force-dynamic";

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isStaff } = await isStaffMember();

  if (!isStaff) redirect("/");

  return <>{children}</>;
}

// Forces TS to treat this file as a module even if something upstream gets weird.
export {};