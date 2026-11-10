import { redirect } from "next/navigation";

/** Alumni moved onto People → Alumni. Old links land here. */
export default function AdminAlumniPage() {
  redirect("/admin/people?tab=alumni");
}
