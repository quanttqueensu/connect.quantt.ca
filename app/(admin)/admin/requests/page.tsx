import { redirect } from "next/navigation";

/** Join requests moved to the top of Companies. Old links land here. */
export default function RequestsPage() {
  redirect("/admin/companies");
}
